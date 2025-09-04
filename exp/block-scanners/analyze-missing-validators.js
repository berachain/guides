#!/usr/bin/env node

/**
 * Berachain Missing Validator Analysis Script
 * 
 * This script analyzes missing validators (block_id_flag = 1) in blocks
 * and creates histograms per proposer. It helps identify which proposers
 * have blocks with higher rates of missing validators.
 * 
 * Key Features:
 * - Efficient single-pass block fetching
 * - Per-proposer histogram of missing validator counts
 * - Overall distribution analysis
 * - Validator name lookup via database
 * 
 * Usage: node analyze-missing-validators.js [options]
 */

const { ValidatorNameDB, BlockFetcher, StatUtils, ProgressReporter, ConfigHelper } = require('./lib/shared-utils');
const Table = require('cli-table3');

// Count missing validators (BlockIDFlagAbsent = 1)
function computeMissingValidators(signatures) {
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

// Calculate percentiles for an array of numbers
function calculatePercentiles(values, percentiles = [25, 50, 75, 90, 95, 99]) {
    if (!values || values.length === 0) return {};
    
    const sorted = [...values].sort((a, b) => a - b);
    const result = {};
    
    for (const p of percentiles) {
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        result[`p${p}`] = sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }
    
    return result;
}


async function analyzeMissingValidators(blockCount = ConfigHelper.getDefaultBlockCount(), chainName = 'mainnet', options = {}) {
    // Default options
    const { showAddresses = false, filterProposer = null } = options;
    
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
    
    ProgressReporter.logStep('Analyzing missing validators per proposer');
    
    // Map to store missing validator data for each proposer
    const proposerData = new Map();
    
    // Analyze blocks
    const globalMissingSamples = [];
    const globalFlagCounts = new Map();
    
    for (const block of blocks) {
        if (block.proposer === 'unknown') {
            continue;
        }
        
        const signatures = block?.raw?.last_commit?.signatures || [];
        const { missingCount, totalCount, flagCounts } = computeMissingValidators(signatures);
        
        // Track global statistics
        globalMissingSamples.push(missingCount);
        for (const [flag, cnt] of flagCounts.entries()) {
            globalFlagCounts.set(flag, (globalFlagCounts.get(flag) || 0) + cnt);
        }
        
        // Initialize proposer stats if not exists
        if (!proposerData.has(block.proposer)) {
            proposerData.set(block.proposer, {
                blocks: 0,
                missingSamples: [],
                missingByBlock: [] // Store block number and missing count
            });
        }
        
        const data = proposerData.get(block.proposer);
        data.blocks++;
        data.missingSamples.push(missingCount);
        data.missingByBlock.push({
            blockNumber: block.height,
            missing: missingCount,
            total: totalCount
        });
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('🎯 MISSING VALIDATOR ANALYSIS COMPLETE');
    console.log('=' .repeat(80));
    
    // Show observed flag distribution for transparency
    if (globalFlagCounts.size > 0) {
        console.log('\n🔎 Observed block_id_flag distribution:');
        const flags = Array.from(globalFlagCounts.entries()).sort((a, b) => a[0] - b[0]);
        for (const [flag, cnt] of flags) {
            console.log(`  flag ${flag}: ${cnt.toLocaleString()}`);
        }
    }
    
    // Calculate statistics for each proposer
    const proposerAnalysis = [];
    
    for (const [proposer, data] of proposerData.entries()) {
        if (data.blocks >= 3) { // Minimum blocks for meaningful stats
            const stats = StatUtils.calculateStats(data.missingSamples);
            const percentiles = calculatePercentiles(data.missingSamples);
            
            // Find block with max missing validators
            const maxMissingBlock = data.missingByBlock.reduce(
                (max, curr) => curr.missing > max.missing ? curr : max, 
                data.missingByBlock[0]
            );
            
            proposerAnalysis.push({
                proposer,
                blockCount: data.blocks,
                stats,
                percentiles,
                maxMissingBlock
            });
        }
    }
    
    // Filter by proposer if specified
    const filteredAnalysis = filterProposer 
        ? proposerAnalysis.filter(a => a.proposer === filterProposer || 
            (validatorDB.getValidatorName(a.proposer) && 
             validatorDB.getValidatorName(a.proposer).toLowerCase().includes(filterProposer.toLowerCase())))
        : proposerAnalysis;
    
    if (filterProposer && filteredAnalysis.length === 0) {
        console.log(`\n⚠️ No data found for proposer: ${filterProposer}`);
    }
    
    // Sort by median missing validators (descending)
    filteredAnalysis.sort((a, b) => (b.stats?.median ?? 0) - (a.stats?.median ?? 0));
    
    // Display summary table
    console.log('\n📊 MISSING VALIDATORS PER PROPOSER' + 
        (filterProposer ? ` (filtered to: ${filterProposer})` : '') + ':');
    
    const table = new Table({
        head: ['Proposer', 'Blocks', 'Avg Missing', 'Median', 'P90', 'P99', 'StdDev', 'Max (Block#)'],
        colWidths: [32, 8, 12, 10, 10, 10, 10, 20],
        wordWrap: true
    });
    
    for (const analysis of filteredAnalysis) {
        const proposerName = await validatorDB.getValidatorName(analysis.proposer);
        const proposerDisplay = showAddresses ? analysis.proposer : (proposerName || analysis.proposer);
        
        const maxMissingDisplay = analysis.maxMissingBlock
            ? `${analysis.maxMissingBlock.missing} (#${analysis.maxMissingBlock.blockNumber})`
            : 'n/a';
        
        table.push([
            proposerDisplay,
            analysis.blockCount,
            analysis.stats.avg.toFixed(2),
            analysis.stats.median,
            analysis.percentiles.p90 || 0,
            analysis.percentiles.p99 || 0,
            analysis.stats.stddev.toFixed(2),
            maxMissingDisplay
        ]);
    }
    
    console.log(table.toString());
    
    // Overall statistics
    const overallStats = StatUtils.calculateStats(globalMissingSamples);
    const overallPercentiles = calculatePercentiles(globalMissingSamples);
    
    console.log(`\n📊 OVERALL STATISTICS:`);
    console.log(`Total blocks analyzed: ${blocks.length.toLocaleString()}`);
    console.log(`Total proposers with data: ${proposerData.size.toLocaleString()}`);
    console.log(`\nMissing Validators (flag=1):`);
    console.log(`  Average missing: ${overallStats.avg.toFixed(2)}`);
    console.log(`  Median missing: ${overallStats.median}`);
    console.log(`  90th percentile: ${overallPercentiles.p90}`);
    console.log(`  99th percentile: ${overallPercentiles.p99}`);
    console.log(`  Range: ${overallStats.min} - ${overallStats.max} validators`);
    
    ProgressReporter.logSuccess('Missing validator analysis completed successfully!');
}

function showHelp() {
    console.log(`
Berachain Missing Validator Analysis Script

This script analyzes missing validators (block_id_flag = 1) in blocks
and creates histograms per proposer. It helps identify which proposers
have blocks with higher rates of missing validators.

Key Features:
- Efficient single-pass block fetching
- Per-proposer histogram of missing validator counts
- Overall distribution analysis
- Validator name lookup via database

Usage: node analyze-missing-validators.js [options]

Options:
  --blocks=N         Number of blocks to analyze (default: ${ConfigHelper.getDefaultBlockCount()})
  -c, --chain=NAME   Chain to use: mainnet|bepolia (default: mainnet)
  -a, --addresses    Show validator addresses instead of names
  -p, --proposer=X   Filter analysis to a specific proposer (address or name substring)
  -h, --help         Show this help message

Examples:
  node analyze-missing-validators.js                    # Use defaults
  node analyze-missing-validators.js --blocks=2000      # Analyze 2000 blocks
  node analyze-missing-validators.js --chain=bepolia    # Use testnet
  node analyze-missing-validators.js --addresses        # Show validator addresses instead of names
  node analyze-missing-validators.js --proposer=0x123   # Filter to specific proposer address
    `);
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const blockCountArg = args.find(arg => arg.startsWith('--blocks='));
    const networkArg = args.find(arg => arg.startsWith('--network=')) || 
                      args.find(arg => arg.startsWith('--chain=')) || 
                      args.find(arg => arg === '-c' && args[args.indexOf(arg) + 1]);
    const proposerArg = args.find(arg => arg.startsWith('--proposer=')) || 
                       args.find(arg => arg === '-p' && args[args.indexOf(arg) + 1]);
    
    const blockCount = blockCountArg ? parseInt(blockCountArg.split('=')[1]) : ConfigHelper.getDefaultBlockCount();
    const network = networkArg ? 
        (networkArg.includes('=') ? networkArg.split('=')[1] : args[args.indexOf(networkArg) + 1]) : 
        'mainnet';
    const showAddresses = args.includes('--addresses') || args.includes('-a');
    const filterProposer = proposerArg ? 
        (proposerArg.includes('=') ? proposerArg.split('=')[1] : args[args.indexOf(proposerArg) + 1]) : 
        null;
    
    if (args.includes('--help') || args.includes('-h')) {
        showHelp();
        process.exit(0);
    }
    
    const options = {
        showAddresses,
        filterProposer
    };
    
    analyzeMissingValidators(blockCount, network, options)
        .then(() => {
            process.exit(0);
        })
        .catch(error => {
            ProgressReporter.logError(`Script failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { analyzeMissingValidators };
