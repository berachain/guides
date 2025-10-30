#!/usr/bin/env node

/**
 * Berachain Block Delay Analysis Script
 * 
 * This script analyzes how each validator's block proposals compare to the previous
 * blocks. It measures delays between blocks and provides percentile analysis for
 * each proposer.
 * 
 * Key Features:
 * - Efficient single-pass block fetching (no re-querying)
 * - Millisecond-accurate timing analysis between consecutive blocks
 * - Statistical analysis: min, max, median, and percentiles for block delays
 * - Validator name lookup via database
 * 
 * Usage: node analyze-block-delays.js [options]
 */

const { ValidatorNameDB, BlockFetcher, StatUtils, ProgressReporter, ConfigHelper } = require('./lib/shared-utils');
const Table = require('cli-table3');

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

async function analyzeBlockDelays(blockCount = ConfigHelper.getDefaultBlockCount(), chainName = 'mainnet', options = {}) {
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
    
    ProgressReporter.logStep('Analyzing block delays per proposer');
    
         // Map to store delay data for each proposer
     const proposerDelays = new Map();
     // Map to store proposer predecessor patterns
     const proposerPredecessors = new Map();
     
     // Analyze consecutive block pairs
     // Note: blocks are in reverse chronological order, so block[i+1] comes before block[i] chronologically
     const allDelaySamples = [];
     for (let i = 0; i < blocks.length - 1; i++) {
         const currentBlock = blocks[i];      // This is the block we're analyzing
         const prevBlock = blocks[i + 1];     // This is the block that came before it
         
         if (currentBlock.proposer === 'unknown' || !currentBlock.timestampMs || !prevBlock.timestampMs) {
             continue;
         }
         
         // Calculate delay between previous block and current block
         const delayMs = currentBlock.timestampMs - prevBlock.timestampMs;
         allDelaySamples.push(delayMs);
         
         // Initialize proposer stats if not exists
         if (!proposerDelays.has(currentBlock.proposer)) {
             proposerDelays.set(currentBlock.proposer, {
                 blockCount: 0,
                 delays: [],
                 delayDetails: [] // Store delay with block number for min/max tracking
             });
         }
         
         const stats = proposerDelays.get(currentBlock.proposer);
         stats.blockCount++;
         stats.delays.push(delayMs);
         // Label delays by the current block (the proposer block)
         stats.delayDetails.push({ 
             delay: delayMs, 
             blockNumber: currentBlock.height,
             prevBlockNumber: prevBlock.height
         });
         
         // Track proposer predecessor patterns
         if (!proposerPredecessors.has(currentBlock.proposer)) {
             proposerPredecessors.set(currentBlock.proposer, {
                 totalBlocks: 0,
                 predecessorCounts: new Map()
             });
         }
         
         const predecessorStats = proposerPredecessors.get(currentBlock.proposer);
         predecessorStats.totalBlocks++;
         
         const prevProposer = prevBlock.proposer;
         if (!predecessorStats.predecessorCounts.has(prevProposer)) {
             predecessorStats.predecessorCounts.set(prevProposer, 0);
         }
         predecessorStats.predecessorCounts.set(prevProposer, predecessorStats.predecessorCounts.get(prevProposer) + 1);
     }
    
    console.log('\n' + '=' .repeat(80));
    console.log('🎯 BLOCK DELAY ANALYSIS COMPLETE');
    console.log('=' .repeat(80));
    
    // Build delay buckets (ms) for overall distribution
    const buckets = [
        { name: '<=1000ms', min: -Infinity, max: 1000, count: 0, sumDelay: 0 },
        { name: '1000-1500ms', min: 1000, max: 1500, count: 0, sumDelay: 0 },
        { name: '1500-2000ms', min: 1500, max: 2000, count: 0, sumDelay: 0 },
        { name: '2000-2500ms', min: 2000, max: 2500, count: 0, sumDelay: 0 },
        { name: '2500-3000ms', min: 2500, max: 3000, count: 0, sumDelay: 0 },
        { name: '>3000ms', min: 3000, max: Infinity, count: 0, sumDelay: 0 },
    ];
    
    for (const delay of allDelaySamples) {
        const b = buckets.find(b => delay > b.min && delay <= b.max);
        if (b) { b.count++; b.sumDelay += delay; }
    }
    
    console.log('\n📉 BLOCK DELAY DISTRIBUTION:');
    console.log(`Samples: ${allDelaySamples.length.toLocaleString()}`);
    console.log('Bucket                  | Samples | Percentage | Avg Delay (ms)');
    console.log('------------------------|---------|-----------|---------------');
    
    for (const b of buckets) {
        if (b.count === 0) continue;
        const percentage = (b.count / allDelaySamples.length * 100).toFixed(1) + '%';
        const avgDelay = Math.round(b.sumDelay / b.count);
        
        console.log(
            `${b.name.padEnd(24)} | ` +
            `${b.count.toString().padStart(7)} | ` +
            `${percentage.padStart(9)} | ` +
            `${avgDelay.toString().padStart(15)}`
        );
    }

         // Calculate statistics for each proposer
     const proposerAnalysis = [];
     for (const [proposer, data] of proposerDelays.entries()) {
         if (data.delays.length >= 3) { // Minimum 3 samples for meaningful stats
             const delayStats = StatUtils.calculateStats(data.delays);
             const percentiles = calculatePercentiles(data.delays);
             
             // Find min/max delay details
             const minDelayDetail = data.delayDetails.reduce(
                 (min, curr) => curr.delay < min.delay ? curr : min, 
                 data.delayDetails[0]
             );
             const maxDelayDetail = data.delayDetails.reduce(
                 (max, curr) => curr.delay > max.delay ? curr : max, 
                 data.delayDetails[0]
             );
             
             // Find most common predecessor
             let mostCommonPredecessor = null;
             let maxCount = 0;
             let totalBlocks = 0;
             
             if (proposerPredecessors.has(proposer)) {
                 const predecessorData = proposerPredecessors.get(proposer);
                 totalBlocks = predecessorData.totalBlocks;
                 
                 for (const [predecessor, count] of predecessorData.predecessorCounts.entries()) {
                     if (count > maxCount) {
                         maxCount = count;
                         mostCommonPredecessor = predecessor;
                     }
                 }
             }
             
             const predecessorPercentage = totalBlocks > 0 ? Math.round((maxCount / totalBlocks) * 100) : 0;
             
             proposerAnalysis.push({
                 proposer,
                 blockCount: data.blockCount,
                 delayStats,
                 percentiles,
                 minDelayDetail,
                 maxDelayDetail,
                 mostCommonPredecessor,
                 predecessorPercentage
             });
         }
     }
    
    // Sort by median delay ascending
    proposerAnalysis.sort((a, b) => (a.delayStats?.median ?? Infinity) - (b.delayStats?.median ?? Infinity));
    
    // Filter by proposer if specified
    const filteredAnalysis = filterProposer 
        ? proposerAnalysis.filter(a => a.proposer === filterProposer || 
            (validatorDB.getValidatorName(a.proposer) && 
             validatorDB.getValidatorName(a.proposer).toLowerCase().includes(filterProposer.toLowerCase())))
        : proposerAnalysis;
    
    if (filterProposer && filteredAnalysis.length === 0) {
        console.log(`\n⚠️ No data found for proposer: ${filterProposer}`);
    }
    
         console.log('\n📈 PROPOSER BLOCK DELAY ANALYSIS' + 
         (filterProposer ? ` (filtered to: ${filterProposer})` : ' (complete dataset)') + ':');
     const table = new Table({
         head: ['Proposer', 'Blocks', 'Most Common Predecessor', '%', 'Median (ms)', 'P75', 'P99', 'StdDev', 'Min/Max Delay'],
         colWidths: [30, 8, 30, 6, 10, 7, 7, 8, 18],
         wordWrap: true
     });
     
     for (const analysis of filteredAnalysis) {
         const proposerName = await validatorDB.getValidatorName(analysis.proposer);
         const proposerDisplay = showAddresses ? analysis.proposer : (proposerName || analysis.proposer);
         
         // Get predecessor name
         const predecessorName = analysis.mostCommonPredecessor ? 
             await validatorDB.getValidatorName(analysis.mostCommonPredecessor) : null;
         const predecessorDisplay = showAddresses ? 
             (analysis.mostCommonPredecessor || 'N/A') : 
             (predecessorName || analysis.mostCommonPredecessor || 'N/A');
         
         const delayRange = `${analysis.minDelayDetail.delay}-${analysis.maxDelayDetail.delay}ms`;
         
         table.push([
             proposerDisplay,
             analysis.blockCount,
             predecessorDisplay,
             analysis.predecessorPercentage + '%',
             Math.round(analysis.delayStats.median || 0),
             Math.round(analysis.percentiles.p75 || 0),
             Math.round(analysis.percentiles.p99 || 0),
             Math.round(analysis.delayStats.stddev || 0),
             delayRange
         ]);
     }
         console.log(table.toString());

     // Per-proposer delay distribution histograms
    if (filterProposer && filteredAnalysis.length > 0) {
        for (const analysis of filteredAnalysis) {
            const proposerName = await validatorDB.getValidatorName(analysis.proposer);
            const proposerDisplay = showAddresses ? analysis.proposer : (proposerName || analysis.proposer);
            
            console.log(`\n📊 DELAY HISTOGRAM: ${proposerDisplay}`);
            
            // Create delay buckets for this proposer
            const delayBuckets = [
                { min: 0, max: 1000, label: '0-1000ms' },
                { min: 1000, max: 1500, label: '1000-1500ms' },
                { min: 1500, max: 2000, label: '1500-2000ms' },
                { min: 2000, max: 2500, label: '2000-2500ms' },
                { min: 2500, max: 3000, label: '2500-3000ms' },
                { min: 3000, max: 4000, label: '3000-4000ms' },
                { min: 4000, max: Infinity, label: '>4000ms' }
            ];
            
            // Count delays in each bucket
            const bucketCounts = new Array(delayBuckets.length).fill(0);
            const data = proposerDelays.get(analysis.proposer);
            
            for (const delay of data.delays) {
                for (let i = 0; i < delayBuckets.length; i++) {
                    if (delay >= delayBuckets[i].min && delay < delayBuckets[i].max) {
                        bucketCounts[i]++;
                        break;
                    }
                }
            }
            
            // Find max count for bar scaling
            const maxCount = Math.max(...bucketCounts);
            const barMax = 40;
            
            // Create histogram table
            const histTable = new Table({
                head: ['Delay Range', 'Count', 'Percentage', 'Distribution'],
                colWidths: [15, 10, 12, 45],
                wordWrap: true
            });
            
            for (let i = 0; i < delayBuckets.length; i++) {
                const count = bucketCounts[i];
                if (count === 0) continue;
                
                const percentage = (count / data.delays.length * 100).toFixed(1) + '%';
                const barLength = maxCount > 0 ? Math.round((count / maxCount) * barMax) : 0;
                const bar = barLength > 0 ? '█'.repeat(barLength) : '';
                
                histTable.push([
                    delayBuckets[i].label,
                    count,
                    percentage,
                    bar
                ]);
            }
            
            console.log(histTable.toString());
        }
    }
    
    // Overall statistics
    const overallDelayStats = StatUtils.calculateStats(allDelaySamples);
    const overallPercentiles = calculatePercentiles(allDelaySamples);
    
    console.log(`\n📊 OVERALL STATISTICS:`);
    console.log(`Total blocks analyzed: ${allDelaySamples.length.toLocaleString()}`);
    console.log(`Total proposers with data: ${proposerDelays.size.toLocaleString()}`);
    console.log(`\nBlock Timing:`);
    console.log(`  Average delay: ${StatUtils.formatNumber(overallDelayStats.avg)} ms (${StatUtils.formatDuration(overallDelayStats.avg)})`);
    console.log(`  Median delay: ${overallDelayStats.median.toLocaleString()} ms`);
    console.log(`  Percentiles:`);
    console.log(`    - P25: ${Math.round(overallPercentiles.p25)} ms`);
    console.log(`    - P75: ${Math.round(overallPercentiles.p75)} ms`);
    console.log(`    - P90: ${Math.round(overallPercentiles.p90)} ms`);
    console.log(`    - P99: ${Math.round(overallPercentiles.p99)} ms`);
    console.log(`  Range: ${overallDelayStats.min.toLocaleString()} - ${overallDelayStats.max.toLocaleString()} ms`);
    
    ProgressReporter.logSuccess('Block delay analysis completed successfully!');
    
         return {
         proposerAnalysis,
         overallStats: {
             delays: overallDelayStats,
             percentiles: overallPercentiles
         },
         totalBlocks: allDelaySamples.length,
         totalProposers: proposerDelays.size
     };
}

function showHelp() {
    console.log(`
Berachain Block Delay Analysis Script

 This script analyzes how each validator's block proposals compare to the previous
 blocks. It measures delays between blocks and provides percentile analysis for
 each proposer.
 
 Key Features:
 - Efficient single-pass block fetching (no re-querying)
 - Millisecond-accurate timing analysis between consecutive blocks
 - Statistical analysis: min, max, median, and percentiles for block delays
 - Proposer predecessor analysis showing which validator most commonly precedes each proposer
 - Validator name lookup via database

Usage: node analyze-block-delays.js [options]

Options:
  --blocks=N         Number of blocks to analyze (default: ${ConfigHelper.getDefaultBlockCount()})
  -c, --chain=NAME   Chain to use: mainnet|bepolia (default: mainnet)
  -a, --addresses    Show validator addresses instead of names
  -p, --proposer=X   Filter analysis to a specific proposer (address or name substring)
                     When specified, shows detailed delay histogram for the proposer
  -h, --help         Show this help message

Examples:
  node analyze-block-delays.js                    # Use defaults
  node analyze-block-delays.js --blocks=2000      # Analyze 2000 blocks
  node analyze-block-delays.js --chain=bepolia    # Use testnet
  node analyze-block-delays.js --addresses        # Show validator addresses instead of names
  node analyze-block-delays.js --proposer=0x123   # Filter to specific proposer address
  node analyze-block-delays.js --proposer=chorus  # Filter to proposer with 'chorus' in name
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
    
    analyzeBlockDelays(blockCount, network, options)
        .then(results => {
            process.exit(0);
        })
        .catch(error => {
            ProgressReporter.logError(`Script failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { analyzeBlockDelays };