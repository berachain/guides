#!/usr/bin/env node

/**
 * Berachain Block Delay Analysis Script
 * 
 * This script analyzes how each validator's block proposals affect the timing
 * and participation in subsequent blocks. It measures delays and signature counts
 * in blocks that follow each proposer's blocks.
 * 
 * Key Features:
 * - Efficient single-pass block fetching (no re-querying)
 * - Millisecond-accurate timing analysis between consecutive blocks
 * - Signature count analysis for blocks following each proposer
 * - Statistical analysis: min, max, average, median for both timing and signatures
 * - Validator name lookup via database
 * 
 * Usage: node analyze-block-delays.js [--blocks N] [--network mainnet|bepolia]
 */

const { ValidatorNameDB, BlockFetcher, StatUtils, ProgressReporter, ConfigHelper } = require('./lib/shared-utils');
const Table = require('cli-table3');

// Strict missing count from raw signatures: BlockIDFlagAbsent (=1)
function computeMissingFromSignatures(signatures) {
    if (!Array.isArray(signatures)) {
        return { missingCount: 0, totalCount: 0, flagCounts: new Map() };
    }
    const flagCounts = new Map();
    let missingCount = 0;
    for (const sig of signatures) {
        const flag = sig?.block_id_flag;
        flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
        if (flag === 1) missingCount += 1;
    }
    return { missingCount, totalCount: signatures.length, flagCounts };
}

function pearsonCorrelation(x, y) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length === 0) {
        return null;
    }
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
}

async function analyzeBlockDelays(blockCount = ConfigHelper.getDefaultBlockCount(), chainName = 'mainnet') {
    // Initialize components with consolidated config
    const blockFetcher = new BlockFetcher(ConfigHelper.getBlockScannerUrl(chainName));
    const validatorDB = new ValidatorNameDB();
    
    ProgressReporter.logStep('Fetching current block height');
    const currentBlock = await blockFetcher.getCurrentBlock();
    if (!currentBlock) {
        ProgressReporter.logError('Failed to get current block height');
        process.exit(1);
    }
    
    const startBlock = currentBlock;
    const endBlock = startBlock - blockCount + 1;
    
    console.log(`📊 Current block: ${startBlock.toLocaleString()}`);
    console.log(`📊 Analyzing ${blockCount.toLocaleString()} blocks backwards from ${startBlock.toLocaleString()} to ${endBlock.toLocaleString()}`);
    console.log('=' .repeat(80));
    
    // Fetch all blocks efficiently
    ProgressReporter.logStep('Fetching blocks');
    const blocks = await blockFetcher.fetchBlockRange(startBlock, blockCount, (current, total, blockHeight) => {
        ProgressReporter.showProgress(current, total, blockHeight);
    });
    
    ProgressReporter.clearProgress();
    ProgressReporter.logSuccess(`Fetched ${blocks.length.toLocaleString()} blocks`);
    
    ProgressReporter.logStep('Analyzing proposer impact on subsequent blocks');
    
    // Map to store impact data for each proposer
    const proposerImpacts = new Map();
    
    // Analyze consecutive block pairs
    // Note: blocks are in reverse chronological order, so block[i+1] comes before block[i] chronologically
    const delaySamples = [];
    const missingSamples = [];
    const globalFlagCounts = new Map();
    for (let i = 0; i < blocks.length - 1; i++) {
        const nextBlock = blocks[i];      // This block comes after chronologically  
        const currentBlock = blocks[i + 1]; // This block comes before chronologically
        
        if (currentBlock.proposer === 'unknown' || !currentBlock.timestampMs || !nextBlock.timestampMs) {
            continue;
        }
        
        // Calculate delay between current block and next block
        const delayMs = nextBlock.timestampMs - currentBlock.timestampMs;
        const signatures = nextBlock?.raw?.last_commit?.signatures || [];
        const { missingCount, totalCount, flagCounts } = computeMissingFromSignatures(signatures);
        delaySamples.push(delayMs);
        missingSamples.push(missingCount);
        // accumulate global flag counts
        for (const [flag, cnt] of flagCounts.entries()) {
            globalFlagCounts.set(flag, (globalFlagCounts.get(flag) || 0) + cnt);
        }
        
        // Initialize proposer stats if not exists
        if (!proposerImpacts.has(currentBlock.proposer)) {
            proposerImpacts.set(currentBlock.proposer, {
                nextBlockDelays: [],
                nextBlockMissing: [],
                delayDetails: [], // Store delay with block number for min/max tracking
                missingDetails: []
            });
        }
        
        const stats = proposerImpacts.get(currentBlock.proposer);
        stats.nextBlockDelays.push(delayMs);
        stats.nextBlockMissing.push(missingCount);
        // Label delays by the source block (the proposer block), not the following block
        stats.delayDetails.push({ delay: delayMs, blockNumber: currentBlock.height });
        stats.missingDetails.push({
            missing: missingCount,
            total: totalCount,
            sourceBlock: currentBlock.height,
            nextBlock: nextBlock.height,
            delayMs
        });
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('🎯 PROPOSER IMPACT ANALYSIS COMPLETE');
    console.log('=' .repeat(80));
    
    // Correlate delay vs missing across all blocks
    const corr = pearsonCorrelation(delaySamples, missingSamples);
    // Build delay buckets (ms)
    const buckets = [
        { name: '<=1500ms', min: -Infinity, max: 1500, count: 0, sumDelay: 0, sumPart: 0 },
        { name: '1500-2000ms', min: 1500, max: 2000, count: 0, sumDelay: 0, sumPart: 0 },
        { name: '2000-2500ms', min: 2000, max: 2500, count: 0, sumDelay: 0, sumPart: 0 },
        { name: '>2500ms', min: 2500, max: Infinity, count: 0, sumDelay: 0, sumPart: 0 },
    ];
    for (let i = 0; i < delaySamples.length; i++) {
        const d = delaySamples[i];
        const m = missingSamples[i];
        const b = buckets.find(b => d > b.min && d <= b.max);
        if (b) { b.count++; b.sumDelay += d; b.sumPart += m; }
    }
    console.log('\n📉 DELAY VS MISSING (next block):');
    console.log(`Samples: ${delaySamples.length.toLocaleString()}`);
    if (corr !== null) {
        console.log(`Pearson correlation (delay, missing): ${corr.toFixed(3)} (positive ⇒ longer delays with more missing)`);
    }
    console.log('Bucket                  | Samples | Avg Delay | Avg Missing');
    console.log('------------------------|---------|-----------|-------------------');
    for (const b of buckets) {
        if (b.count === 0) continue;
        const avgD = Math.round(b.sumDelay / b.count);
        const avgP = (b.sumPart / b.count).toFixed(1);
        console.log(
            `${b.name.padEnd(24)} | ` +
            `${b.count.toString().padStart(7)} | ` +
            `${avgD.toString().padStart(9)} | ` +
            `${avgP.toString().padStart(19)}`
        );
    }

    // Show observed flag distribution for transparency
    if (globalFlagCounts.size > 0) {
        console.log('\n🔎 Observed block_id_flag distribution in next blocks:');
        const flags = Array.from(globalFlagCounts.entries()).sort((a, b) => a[0] - b[0]);
        for (const [flag, cnt] of flags) {
            console.log(`  flag ${flag}: ${cnt.toLocaleString()}`);
        }
    }

    // Calculate statistics for each proposer
    const proposerAnalysis = [];
    for (const [proposer, data] of proposerImpacts.entries()) {
        const delayStats = StatUtils.calculateStats(data.nextBlockDelays);
        const missingStats = StatUtils.calculateStats(data.nextBlockMissing);
        
        if (delayStats && missingStats && delayStats.count >= 3) { // Minimum 3 samples for meaningful stats
            // Find min/max delay details
            const minDelayDetail = data.delayDetails.reduce((min, curr) => curr.delay < min.delay ? curr : min);
            const maxDelayDetail = data.delayDetails.reduce((max, curr) => curr.delay > max.delay ? curr : max);
            
            // Find min/max missing details
            const minMissingDetail = data.missingDetails.reduce((min, curr) => curr.missing < min.missing ? curr : min);
            const maxMissingDetail = data.missingDetails.reduce((max, curr) => curr.missing > max.missing ? curr : max);
            
            proposerAnalysis.push({
                proposer,
                sampleCount: delayStats.count,
                delayStats,
                missingStats,
                minDelayDetail,
                maxDelayDetail,
                minMissingDetail,
                maxMissingDetail
            });
        }
    }
    
    // Merge timing and missing into one table, sorted by median delay ascending
    proposerAnalysis.sort((a, b) => (a.delayStats?.median ?? Infinity) - (b.delayStats?.median ?? Infinity));
    console.log('\n📈 PROPOSER DELAY AND MISSING-VOTE ANALYSIS (complete dataset):');
    const table = new Table({
        head: ['Proposer', 'Samples', 'Med Missing', 'Med Delay (ms)', 'StdDev Delay', 'Min Delay (Block#)', 'Max Delay (Block#)', 'Max Missing (src→next, delay)'],
        colWidths: [32, 8, 12, 16, 14, 23, 23, 34],
        wordWrap: true
    });
    for (const analysis of proposerAnalysis) {
        const proposerName = await validatorDB.getValidatorName(analysis.proposer);
        const proposerDisplay = proposerName || analysis.proposer;
        const minDelayDisplay = `${analysis.minDelayDetail.delay} (#${analysis.minDelayDetail.blockNumber})`;
        const maxDelayDisplay = `${analysis.maxDelayDetail.delay} (#${analysis.maxDelayDetail.blockNumber})`;
        // Find the max missing sample for this proposer and show source→next (delay)
        let maxMissRow = null;
        const data = proposerImpacts.get(analysis.proposer);
        if (data && Array.isArray(data.missingDetails) && data.missingDetails.length > 0) {
            maxMissRow = data.missingDetails.reduce((max, curr) => (curr.missing > (max?.missing ?? -1) ? curr : max), null);
        }
        const maxMissingDisplay = maxMissRow
            ? `${maxMissRow.missing} (${maxMissRow.sourceBlock}→${maxMissRow.nextBlock}, ${maxMissRow.delayMs}ms)`
            : 'n/a';
        const medMissing = Number(analysis.missingStats.median || 0);
        const medDelayMs = Math.round(analysis.delayStats.median || 0);
        table.push([
            proposerDisplay,
            analysis.sampleCount,
            medMissing,
            medDelayMs,
            Math.round(analysis.delayStats.stddev || 0),
            minDelayDisplay,
            maxDelayDisplay,
            maxMissingDisplay
        ]);
    }
    console.log(table.toString());

    // Histogram of missing validators across all next blocks (bucket size = 1)
    console.log('\n📊 HISTOGRAM: Missing Validators per Next Block (bucket size = 1)');
    const hist = new Map();
    let maxMissingVal = 0;
    let maxFreq = 0;
    for (const m of missingSamples) {
        const v = Number.isFinite(m) ? m : 0;
        maxMissingVal = Math.max(maxMissingVal, v);
        const f = (hist.get(v) || 0) + 1;
        hist.set(v, f);
        if (f > maxFreq) maxFreq = f;
    }
    const barMax = 40;
    const histTable = new Table({
        head: ['Missing', 'Frequency', 'Bar'],
        colWidths: [10, 12, 50],
        wordWrap: true
    });
    for (let v = 0; v <= maxMissingVal; v++) {
        const f = hist.get(v) || 0;
        const barLen = maxFreq > 0 ? Math.max(1, Math.round((f / maxFreq) * barMax)) : 0;
        const bar = f > 0 ? '█'.repeat(barLen) : '';
        histTable.push([v, f, bar]);
    }
    console.log(histTable.toString());
    
    // Overall statistics
    const allDelays = [];
    const allMissing = [];
    for (const [_, data] of proposerImpacts.entries()) {
        allDelays.push(...data.nextBlockDelays);
        allMissing.push(...data.nextBlockMissing);
    }
    
    const overallDelayStats = StatUtils.calculateStats(allDelays);
    const overallMissingStats = StatUtils.calculateStats(allMissing);
    
    console.log(`\n📊 OVERALL STATISTICS:`);
    console.log(`Total block pairs analyzed: ${allDelays.length.toLocaleString()}`);
    console.log(`Total proposers with data: ${proposerImpacts.size.toLocaleString()}`);
    console.log(`\nBlock Timing:`);
    console.log(`  Average delay: ${StatUtils.formatNumber(overallDelayStats.avg)} ms (${StatUtils.formatDuration(overallDelayStats.avg)})`);
    console.log(`  Median delay: ${overallDelayStats.median.toLocaleString()} ms`);
    console.log(`  Range: ${overallDelayStats.min.toLocaleString()} - ${overallDelayStats.max.toLocaleString()} ms`);
    console.log(`\nMissing Votes (flag=1):`);
    console.log(`  Average missing: ${StatUtils.formatNumber(overallMissingStats.avg, 1)}`);
    console.log(`  Median missing: ${overallMissingStats.median}`);
    console.log(`  Range: ${overallMissingStats.min} - ${overallMissingStats.max} validators`);
    
    ProgressReporter.logSuccess('Block delay analysis completed successfully!');
    
    return {
        proposerAnalysis,
        overallStats: {
            delays: overallDelayStats,
            missing: overallMissingStats
        },
        totalPairs: allDelays.length,
        totalProposers: proposerImpacts.size
    };
}

function showHelp() {
    console.log(`
Berachain Block Delay Analysis Script

This script analyzes how each validator's block proposals affect the timing
and participation in subsequent blocks. It measures delays and signature counts
in blocks that follow each proposer's blocks.

Key Features:
- Efficient single-pass block fetching (no re-querying)
- Millisecond-accurate timing analysis between consecutive blocks
- Signature count analysis for blocks following each proposer
- Statistical analysis: min, max, average, median for both timing and signatures
- Validator name lookup via database

Usage: node analyze-block-delays.js [options]

Options:
  --blocks=N         Number of blocks to analyze (default: ${ConfigHelper.getDefaultBlockCount()})
  -c, --chain=NAME   Chain to use: mainnet|bepolia (default: mainnet)
  -h, --help         Show this help message

Examples:
  node analyze-block-delays.js                    # Use defaults
  node analyze-block-delays.js --blocks=2000      # Analyze 2000 blocks
  node analyze-block-delays.js --chain=bepolia    # Use testnet
    `);
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const blockCountArg = args.find(arg => arg.startsWith('--blocks='));
    const networkArg = args.find(arg => arg.startsWith('--network='));
    
    const blockCount = blockCountArg ? parseInt(blockCountArg.split('=')[1]) : ConfigHelper.getDefaultBlockCount();
    const network = networkArg ? networkArg.split('=')[1] : 'mainnet';
    
    if (args.includes('--help') || args.includes('-h')) {
        showHelp();
        process.exit(0);
    }
    
    analyzeBlockDelays(blockCount, network)
        .then(results => {
            process.exit(0);
        })
        .catch(error => {
            ProgressReporter.logError(`Script failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { analyzeBlockDelays };