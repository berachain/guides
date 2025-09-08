#!/usr/bin/env node

/**
 * Berachain Missing Voting Power Analysis Script
 * 
 * This script analyzes missing voting power (block_id_flag = 1) in blocks with dual analysis:
 * 1. FREQUENTLY ABSENT VALIDATORS - Validators who consistently miss signing blocks
 * 2. UNLUCKY PROPOSERS - Block proposers who consistently see missing voting power during their proposals
 * 
 * Note: The last_commit in a block represents the consensus for the PREVIOUS block,
 * so missing validators are attributed to the previous block's proposer.
 * 
 * Key Features:
 * - Efficient single-pass block fetching
 * - Missing voting power analysis (not just validator count)
 * - Per-proposer missing voting power statistics (unlucky proposers)
 * - Per-validator absence tracking (frequently absent validators)
 * - Dynamic voting power tracking (updates every 500 blocks)
 * - Validator name lookup via database
 * - Configurable analysis modes (validators, proposers, or both)
 * 
 * Usage: node analyze-missing-validators.js [options]
 */

const { ValidatorNameDB, BlockFetcher, StatUtils, ProgressReporter, ConfigHelper } = require('./lib/shared-utils');
const Table = require('cli-table3');
const axios = require('axios');

// Fetch voting power data for a specific block height
async function getVotingPowerData(height, baseUrl) {
    try {
        const response = await axios.get(`${baseUrl}/validators?per_page=99&height=${height}`);
        const validators = response.data.result.validators;
        
        // Create maps for quick lookup
        const votingPowerByAddress = new Map();
        const addressByPosition = new Map();
        let totalVotingPower = 0;
        
        validators.forEach((validator, index) => {
            const power = parseInt(validator.voting_power);
            votingPowerByAddress.set(validator.address, power);
            addressByPosition.set(index, validator.address);
            totalVotingPower += power;
        });
        
        return {
            votingPowerByAddress,
            addressByPosition,
            totalVotingPower,
            validatorCount: validators.length,
            blockHeight: height
        };
    } catch (error) {
        console.error(`Error fetching voting power for block ${height}:`, error.message);
        return null;
    }
}

// Compute missing voting power (BlockIDFlagAbsent = 1)
function computeMissingVotingPower(signatures, votingPowerData) {
    if (!Array.isArray(signatures) || !votingPowerData) {
        return { 
            missingCount: 0, 
            missingVotingPower: 0, 
            totalVotingPower: 0,
            missingPercentage: 0,
            flagCounts: new Map() 
        };
    }
    
    const flagCounts = new Map();
    let missingCount = 0;
    let missingVotingPower = 0;
    
    for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        const flag = sig?.block_id_flag;
        flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
        
        if (flag === 1) { // Missing validator
            missingCount += 1;
            // Get validator address by position
            const validatorAddress = votingPowerData.addressByPosition.get(i);
            if (validatorAddress) {
                const power = votingPowerData.votingPowerByAddress.get(validatorAddress) || 0;
                missingVotingPower += power;
            }
        }
    }
    
    const missingPercentage = votingPowerData.totalVotingPower > 0 
        ? (missingVotingPower / votingPowerData.totalVotingPower) * 100 
        : 0;
    
    return { 
        missingCount, 
        missingVotingPower, 
        totalVotingPower: votingPowerData.totalVotingPower,
        missingPercentage,
        flagCounts 
    };
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

// Track validator absences (BlockIDFlagAbsent = 1) to identify frequently absent validators
function trackValidatorAbsences(signatures, votingPowerData, validatorAbsenceData) {
    if (!Array.isArray(signatures) || !votingPowerData) {
        return;
    }
    
    for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        const validatorAddress = votingPowerData.addressByPosition.get(i);
        
        if (!validatorAddress) continue;
        
        // Initialize validator tracking if not exists
        if (!validatorAbsenceData.has(validatorAddress)) {
            validatorAbsenceData.set(validatorAddress, {
                totalOpportunities: 0,
                absences: 0,
                votingPower: votingPowerData.votingPowerByAddress.get(validatorAddress) || 0,
                absenceBlocks: []
            });
        }
        
        const data = validatorAbsenceData.get(validatorAddress);
        data.totalOpportunities++;
        
        if (sig?.block_id_flag === 1) { // Missing validator
            data.absences++;
            data.absenceBlocks.push({
                blockHeight: votingPowerData.blockHeight,
                votingPower: data.votingPower
            });
        }
        
        // Update voting power (may change over time)
        data.votingPower = votingPowerData.votingPowerByAddress.get(validatorAddress) || 0;
    }
}


async function analyzeMissingValidators(blockCount = ConfigHelper.getDefaultBlockCount(), chainName = 'mainnet', options = {}) {
    // Default options
    const { 
        showAddresses = false, 
        filterProposer = null,
        analyzeValidators = true,
        analyzeProposers = true,
        minValidatorOpportunities = 10 // Minimum opportunities for meaningful validator stats
    } = options;
    
    // Initialize components with consolidated config
    const baseUrl = ConfigHelper.getBlockScannerUrl(chainName);
    const blockFetcher = new BlockFetcher(baseUrl);
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
    
    ProgressReporter.logStep('Analyzing missing voting power per proposer');
    
    // Cache for voting power data
    const votingPowerCache = new Map();
    
    // Get initial voting power data
    let currentVotingPowerData = await getVotingPowerData(startBlock, baseUrl);
    if (currentVotingPowerData) {
        votingPowerCache.set(startBlock, currentVotingPowerData);
        console.log(`📊 Initial voting power: ${(currentVotingPowerData.totalVotingPower / 1e9).toFixed(2)} BERA total power, ${currentVotingPowerData.validatorCount} validators`);
    }
    
    // Map to store missing voting power data for each proposer
    const proposerData = new Map();
    
    // Map to store absence data for each validator
    const validatorAbsenceData = new Map();
    
    // Global statistics
    const globalMissingVotingPowerSamples = [];
    const globalMissingPercentageSamples = [];
    const globalFlagCounts = new Map();
    
    console.log('\n📊 Processing blocks (voting power updates every 500 blocks)...');
    
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        
        // Update voting power data every 500 blocks
        if (i > 0 && i % 500 === 0) {
            const newVotingPowerData = await getVotingPowerData(block.height, baseUrl);
            if (newVotingPowerData) {
                currentVotingPowerData = newVotingPowerData;
                votingPowerCache.set(block.height, newVotingPowerData);
                console.log(`  📊 Updated voting power at block ${block.height.toLocaleString()}: ${(newVotingPowerData.totalVotingPower / 1e9).toFixed(2)} BERA total power`);
            }
        }
        
        if (block.proposer === 'unknown' || !currentVotingPowerData) {
            continue;
        }
        
        // IMPORTANT: last_commit represents consensus for the PREVIOUS block
        // So we need to attribute missing validators to the PREVIOUS block's proposer
        if (i < blocks.length - 1) {
            const previousBlock = blocks[i + 1]; // Previous chronologically
            const signatures = block?.raw?.last_commit?.signatures || [];
            const analysis = computeMissingVotingPower(signatures, currentVotingPowerData);
            
            // Track validator absences for frequently absent validator analysis
            if (analyzeValidators) {
                trackValidatorAbsences(signatures, currentVotingPowerData, validatorAbsenceData);
            }
            
            // Track global statistics
            globalMissingVotingPowerSamples.push(analysis.missingVotingPower);
            globalMissingPercentageSamples.push(analysis.missingPercentage);
            for (const [flag, cnt] of analysis.flagCounts.entries()) {
                globalFlagCounts.set(flag, (globalFlagCounts.get(flag) || 0) + cnt);
            }
            
            // Track proposer stats for unlucky proposer analysis (for PREVIOUS block's proposer)
            if (analyzeProposers) {
                if (!proposerData.has(previousBlock.proposer)) {
                    proposerData.set(previousBlock.proposer, {
                        blocks: 0,
                        missingVotingPowerSamples: [],
                        missingPercentageSamples: [],
                        missingByBlock: []
                    });
                }
                
                const data = proposerData.get(previousBlock.proposer);
                data.blocks++;
                data.missingVotingPowerSamples.push(analysis.missingVotingPower);
                data.missingPercentageSamples.push(analysis.missingPercentage);
                data.missingByBlock.push({
                    blockNumber: previousBlock.height,
                    missingCount: analysis.missingCount,
                    missingVotingPower: analysis.missingVotingPower,
                    missingPercentage: analysis.missingPercentage,
                    totalVotingPower: analysis.totalVotingPower
                });
            }
        }
        
        // Progress indicator
        if (i % 100 === 0) {
            console.log(`  Processed ${i + 1}/${blocks.length} blocks (${((i + 1) / blocks.length * 100).toFixed(1)}%)`);
        }
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('🎯 MISSING VOTING POWER ANALYSIS COMPLETE');
    console.log('=' .repeat(80));
    
    // Show observed flag distribution for transparency
    if (globalFlagCounts.size > 0) {
        console.log('\n🔎 Observed block_id_flag distribution:');
        const flags = Array.from(globalFlagCounts.entries()).sort((a, b) => a[0] - b[0]);
        for (const [flag, cnt] of flags) {
            console.log(`  flag ${flag}: ${cnt.toLocaleString()}`);
        }
    }
    
    // Calculate statistics for each proposer (unlucky proposers analysis)
    const proposerAnalysis = [];
    
    if (analyzeProposers) {
        for (const [proposer, data] of proposerData.entries()) {
            if (data.blocks >= 3) { // Minimum blocks for meaningful stats
                const votingPowerStats = StatUtils.calculateStats(data.missingVotingPowerSamples);
                const percentageStats = StatUtils.calculateStats(data.missingPercentageSamples);
                const votingPowerPercentiles = calculatePercentiles(data.missingVotingPowerSamples);
                const percentagePercentiles = calculatePercentiles(data.missingPercentageSamples);
                
                // Find block with max missing voting power
                const maxMissingBlock = data.missingByBlock.reduce(
                    (max, curr) => curr.missingVotingPower > max.missingVotingPower ? curr : max, 
                    data.missingByBlock[0]
                );
                
                proposerAnalysis.push({
                    proposer,
                    blockCount: data.blocks,
                    votingPowerStats,
                    percentageStats,
                    votingPowerPercentiles,
                    percentagePercentiles,
                    maxMissingBlock
                });
            }
        }
    }
    
    // Calculate statistics for each validator (frequently absent validators analysis)
    const validatorAnalysis = [];
    
    if (analyzeValidators) {
        for (const [validatorAddress, data] of validatorAbsenceData.entries()) {
            if (data.totalOpportunities >= minValidatorOpportunities) { // Minimum opportunities for meaningful stats
                const absenceRate = (data.absences / data.totalOpportunities) * 100;
                
                // Calculate missed voting power (total power that was absent)
                const missedVotingPower = data.absences * data.votingPower;
                
                validatorAnalysis.push({
                    validatorAddress,
                    totalOpportunities: data.totalOpportunities,
                    absences: data.absences,
                    absenceRate,
                    votingPower: data.votingPower,
                    missedVotingPower,
                    absenceBlocks: data.absenceBlocks
                });
            }
        }
        
        // Sort by absence rate (descending) - most problematic validators first
        validatorAnalysis.sort((a, b) => b.absenceRate - a.absenceRate);
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
    
    // Sort by average missing voting power percentage (descending)
    filteredAnalysis.sort((a, b) => (b.percentageStats?.avg ?? 0) - (a.percentageStats?.avg ?? 0));
    
    // Display unlucky proposers analysis
    if (analyzeProposers && proposerAnalysis.length > 0) {
        console.log('\n📊 UNLUCKY PROPOSERS - Missing Voting Power During Their Proposals' + 
            (filterProposer ? ` (filtered to: ${filterProposer})` : '') + ':');
        
        const proposerTable = new Table({
            head: ['Proposer', 'Blocks', 'Avg Missing %', 'Median %', 'P90 %', 'P99 %', 'Avg Missing Power', 'Max Missing (Block#)'],
            colWidths: [30, 8, 12, 10, 8, 8, 15, 22],
            wordWrap: true
        });
        
        for (const analysis of filteredAnalysis) {
            const proposerName = await validatorDB.getValidatorName(analysis.proposer);
            const proposerDisplay = showAddresses ? analysis.proposer : (proposerName || analysis.proposer);
            
                    const maxMissingDisplay = analysis.maxMissingBlock
            ? `${(analysis.maxMissingBlock.missingVotingPower / 1e9).toFixed(2)} BERA (#${analysis.maxMissingBlock.blockNumber})`
            : 'n/a';
            
            proposerTable.push([
                proposerDisplay,
                analysis.blockCount,
                analysis.percentageStats.avg.toFixed(2),
                analysis.percentageStats.median.toFixed(2),
                (analysis.percentagePercentiles.p90 || 0).toFixed(1),
                (analysis.percentagePercentiles.p99 || 0).toFixed(1),
                (analysis.votingPowerStats.avg / 1e9).toFixed(2) + ' BERA',
                maxMissingDisplay
            ]);
        }
        
        console.log(proposerTable.toString());
    }
    
    // Display frequently absent validators analysis  
    if (analyzeValidators && validatorAnalysis.length > 0) {
        console.log('\n🚨 FREQUENTLY ABSENT VALIDATORS - Chronically Missing from Consensus:');
        
        const validatorTable = new Table({
            head: ['Validator', 'Opportunities', 'Absences', 'Absence Rate %', 'Voting Power', 'Total Missed Power', 'Recent Absences'],
            colWidths: [30, 12, 10, 12, 12, 15, 15],
            wordWrap: true
        });
        
        // Show top 20 most frequently absent validators
        const topAbsentValidators = validatorAnalysis.slice(0, 20);
        
        for (const analysis of topAbsentValidators) {
            const validatorName = await validatorDB.getValidatorName(analysis.validatorAddress);
            const validatorDisplay = showAddresses ? analysis.validatorAddress : (validatorName || analysis.validatorAddress);
            
            // Show count of recent absences (last 5 recorded)
            const recentAbsences = analysis.absenceBlocks.slice(-5).length;
            const recentDisplay = recentAbsences > 0 ? `${recentAbsences} recent` : 'none recent';
            
            validatorTable.push([
                validatorDisplay,
                analysis.totalOpportunities,
                analysis.absences,
                analysis.absenceRate.toFixed(2),
                (analysis.votingPower / 1e9).toFixed(2) + ' BERA',
                (analysis.missedVotingPower / 1e9).toFixed(2) + ' BERA',
                recentDisplay
            ]);
        }
        
        console.log(validatorTable.toString());
        
        if (validatorAnalysis.length > 20) {
            console.log(`\n(Showing top 20 of ${validatorAnalysis.length} validators with absence data)`);
        }
    }
    
    // Overall statistics
    const overallVotingPowerStats = StatUtils.calculateStats(globalMissingVotingPowerSamples);
    const overallPercentageStats = StatUtils.calculateStats(globalMissingPercentageSamples);
    const overallPercentagePercentiles = calculatePercentiles(globalMissingPercentageSamples);
    
    console.log(`\n📊 OVERALL STATISTICS:`);
    console.log(`Total blocks analyzed: ${blocks.length.toLocaleString()}`);
    if (analyzeProposers) {
        console.log(`Total proposers with data: ${proposerData.size.toLocaleString()}`);
    }
    if (analyzeValidators) {
        console.log(`Total validators tracked: ${validatorAbsenceData.size.toLocaleString()}`);
        console.log(`Validators with sufficient data (${minValidatorOpportunities}+ opportunities): ${validatorAnalysis.length.toLocaleString()}`);
    }
    console.log(`\nMissing Voting Power (flag=1):`);
    console.log(`  Average missing: ${(overallVotingPowerStats.avg / 1e9).toFixed(2)} BERA (${overallPercentageStats.avg.toFixed(2)}%)`);
    console.log(`  Median missing: ${(overallVotingPowerStats.median / 1e9).toFixed(2)} BERA (${overallPercentageStats.median.toFixed(2)}%)`);
    console.log(`  90th percentile: ${(overallPercentagePercentiles.p90 || 0).toFixed(2)}%`);
    console.log(`  99th percentile: ${(overallPercentagePercentiles.p99 || 0).toFixed(2)}%`);
    console.log(`  Range: ${(overallVotingPowerStats.min / 1e9).toFixed(2)} - ${(overallVotingPowerStats.max / 1e9).toFixed(2)} BERA`);
    if (currentVotingPowerData) {
        console.log(`  Total network voting power: ${(currentVotingPowerData.totalVotingPower / 1e9).toFixed(2)} BERA`);
    }
    
    // Summary insights
    if (analyzeValidators && validatorAnalysis.length > 0) {
        const highAbsenceValidators = validatorAnalysis.filter(v => v.absenceRate > 5.0);
        if (highAbsenceValidators.length > 0) {
            console.log(`\n🚨 HIGH ABSENCE VALIDATORS: ${highAbsenceValidators.length} validators with >5% absence rate`);
            const totalMissedPower = highAbsenceValidators.reduce((sum, v) => sum + v.missedVotingPower, 0);
            console.log(`  Total voting power lost due to high-absence validators: ${(totalMissedPower / 1e9).toFixed(2)} BERA`);
        }
    }
    
    if (analyzeProposers && proposerAnalysis.length > 0) {
        const unluckyProposers = proposerAnalysis.filter(p => p.percentageStats.avg > overallPercentageStats.avg * 1.5);
        if (unluckyProposers.length > 0) {
            console.log(`\n📊 UNLUCKY PROPOSERS: ${unluckyProposers.length} proposers see 50%+ more missing power than average`);
        }
    }
    
    ProgressReporter.logSuccess('Missing voting power analysis completed successfully!');
}

function showHelp() {
    console.log(`
Berachain Missing Voting Power Analysis Script

This script provides dual analysis of missing voting power (block_id_flag = 1):
1. FREQUENTLY ABSENT VALIDATORS - Validators who consistently miss signing blocks
2. UNLUCKY PROPOSERS - Block proposers who consistently see missing voting power during their proposals

IMPORTANT: The last_commit in a block represents consensus for the PREVIOUS block,
so missing validators are attributed to the previous block's proposer.

Key Features:
- Efficient single-pass block fetching
- Missing voting power analysis (not just validator count)
- Per-proposer missing voting power statistics (unlucky proposers)
- Per-validator absence tracking (frequently absent validators)
- Dynamic voting power tracking (updates every 500 blocks)
- Proper attribution of consensus results to previous block's proposer
- Validator name lookup via database
- Configurable analysis modes

Usage: node analyze-missing-validators.js [options]

Options:
  --blocks=N             Number of blocks to analyze (default: ${ConfigHelper.getDefaultBlockCount()})
  -c, --chain=NAME       Chain to use: mainnet|bepolia (default: mainnet)
  -a, --addresses        Show validator addresses instead of names
  -p, --proposer=X       Filter analysis to a specific proposer (address or name substring)
  --validators-only      Only analyze frequently absent validators (skip proposer analysis)
  --proposers-only       Only analyze unlucky proposers (skip validator analysis)
  --min-opportunities=N  Minimum opportunities for validator analysis (default: 10)
  -h, --help             Show this help message

Examples:
  node analyze-missing-validators.js                         # Analyze both validators and proposers
  node analyze-missing-validators.js --blocks=2000           # Analyze 2000 blocks
  node analyze-missing-validators.js --chain=bepolia         # Use testnet
  node analyze-missing-validators.js --validators-only       # Only show frequently absent validators
  node analyze-missing-validators.js --proposers-only        # Only show unlucky proposers
  node analyze-missing-validators.js --min-opportunities=20  # Require 20+ opportunities for validator stats
  node analyze-missing-validators.js --addresses             # Show validator addresses instead of names
  node analyze-missing-validators.js --proposer=0x123        # Filter to specific proposer address
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
    const minOpportunitiesArg = args.find(arg => arg.startsWith('--min-opportunities='));
    
    const blockCount = blockCountArg ? parseInt(blockCountArg.split('=')[1]) : ConfigHelper.getDefaultBlockCount();
    const network = networkArg ? 
        (networkArg.includes('=') ? networkArg.split('=')[1] : args[args.indexOf(networkArg) + 1]) : 
        'mainnet';
    const showAddresses = args.includes('--addresses') || args.includes('-a');
    const filterProposer = proposerArg ? 
        (proposerArg.includes('=') ? proposerArg.split('=')[1] : args[args.indexOf(proposerArg) + 1]) : 
        null;
    const minValidatorOpportunities = minOpportunitiesArg ? parseInt(minOpportunitiesArg.split('=')[1]) : 10;
    
    // Determine analysis modes
    const validatorsOnly = args.includes('--validators-only');
    const proposersOnly = args.includes('--proposers-only');
    
    // Default to both if neither specified, otherwise respect the flags
    const analyzeValidators = !proposersOnly;
    const analyzeProposers = !validatorsOnly;
    
    if (args.includes('--help') || args.includes('-h')) {
        showHelp();
        process.exit(0);
    }
    
    const options = {
        showAddresses,
        filterProposer,
        analyzeValidators,
        analyzeProposers,
        minValidatorOpportunities
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
