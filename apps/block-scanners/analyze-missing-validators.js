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
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

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

// Format voting power with readable units (Kbera, Mbera, BERA)
// Takes value in wei (smallest unit) and returns formatted string
function formatVotingPower(valueInWei) {
    const bera = valueInWei / 1e9;
    
    if (bera >= 1e6) {
        return `${(bera / 1e6).toFixed(2)} Mbera`;
    } else if (bera >= 1e3) {
        return `${(bera / 1e3).toFixed(2)} Kbera`;
    } else {
        return `${bera.toFixed(2)} BERA`;
    }
}

// Fetch blocks in parallel with controlled concurrency
async function fetchBlocksParallel(blockFetcher, startBlock, blockCount, concurrency = 20, progressCallback = null) {
    const blocks = [];
    const blockHeights = [];
    
    // Generate all block heights we need to fetch
    for (let i = 0; i < blockCount; i++) {
        blockHeights.push(startBlock - i);
    }
    
    // Process blocks in batches with controlled concurrency
    for (let i = 0; i < blockHeights.length; i += concurrency) {
        const batch = blockHeights.slice(i, i + concurrency);
        const batchPromises = batch.map(async (blockHeight) => {
            const blockData = await blockFetcher.getBlock(blockHeight);
            if (!blockData || !blockData.result || !blockData.result.block) {
                return null;
            }
            
            const block = blockData.result.block;
            const signatures = block.last_commit?.signatures || [];
            const proposer = block.header?.proposer_address;
            const timestamp = block.header?.time;
            
            return {
                height: blockHeight,
                proposer: proposer || 'unknown',
                timestamp: timestamp,
                signatureCount: signatures.filter(sig => sig && sig.block_id_flag !== 5).length,
                totalValidators: signatures.length,
                timestampMs: timestamp ? new Date(timestamp).getTime() : null,
                raw: block
            };
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        // Add results in order (null results are filtered out)
        for (const result of batchResults) {
            if (result) {
                blocks.push(result);
            }
        }
        
        // Progress callback
        if (progressCallback) {
            progressCallback(blocks.length, blockCount, batch[batch.length - 1]);
        }
    }
    
    // Sort blocks by height descending (to maintain order)
    blocks.sort((a, b) => b.height - a.height);
    
    return blocks;
}

// Track validator absences (BlockIDFlagAbsent = 1) to identify frequently absent validators
function trackValidatorAbsences(signatures, votingPowerData, validatorAbsenceData) {
    if (!Array.isArray(signatures) || !votingPowerData) return;
    
    for (let i = 0; i < signatures.length; i++) {
        const validatorAddress = votingPowerData.addressByPosition.get(i);
        if (!validatorAddress) continue;
        
        if (!validatorAbsenceData.has(validatorAddress)) {
            validatorAbsenceData.set(validatorAddress, {
                totalOpportunities: 0,
                absences: 0,
                votingPower: votingPowerData.votingPowerByAddress.get(validatorAddress) || 0
            });
        }
        
        const data = validatorAbsenceData.get(validatorAddress);
        data.totalOpportunities++;
        if (signatures[i]?.block_id_flag === 1) data.absences++;
        data.votingPower = votingPowerData.votingPowerByAddress.get(validatorAddress) || 0;
    }
}

// Fetch validator names in parallel
async function fetchValidatorNames(validatorDB, addresses) {
    const nameMap = new Map();
    await Promise.all(addresses.map(async (addr) => {
        const name = await validatorDB.getValidatorName(addr);
        if (name) nameMap.set(addr, name);
    }));
    return nameMap;
}

// Filter items by threshold but show at least minCount
function filterWithMinCount(items, filterFn, minCount = 3, showAll = false) {
    if (showAll) return { items, skipped: 0 };
    const filtered = items.filter(filterFn);
    const result = filtered.length >= minCount ? filtered : items.slice(0, minCount);
    return { items: result, skipped: items.length - result.length };
}

// Display histogram from count map
function displayHistogram(title, countMap, labelFn = (k) => k.toString()) {
    if (countMap.size === 0) return;
    console.log(`\n${title}:`);
    const entries = Array.from(countMap.entries()).sort((a, b) => a[0] - b[0]);
    const maxCount = entries.reduce((m, [, c]) => Math.max(m, c), 0);
    const barMaxWidth = 40;
    for (const [key, count] of entries) {
        const barLength = maxCount > 0 ? Math.max(1, Math.round((count / maxCount) * barMaxWidth)) : 0;
        console.log(`  ${labelFn(key).padStart(2, ' ')} | ${'#'.repeat(barLength)} (${count.toLocaleString()})`);
    }
}

// Calculate block range from options
async function calculateBlockRange(blockFetcher, blockCount, startHeight, endHeight) {
    if (Number.isFinite(startHeight) && Number.isFinite(endHeight)) {
        if (startHeight < endHeight) {
            ProgressReporter.logError('Invalid range: --start must be >= --end');
            process.exit(1);
        }
        return { startBlock: startHeight, endBlock: endHeight, effectiveBlockCount: startHeight - endHeight + 1 };
    }
    
    const currentBlock = await blockFetcher.getCurrentBlock();
    if (!currentBlock) {
        ProgressReporter.logError('Failed to get current block height');
        process.exit(1);
    }
    
    if (Number.isFinite(endHeight)) {
        const startBlock = Math.min(endHeight + blockCount - 1, currentBlock);
        return { startBlock, endBlock: endHeight, effectiveBlockCount: startBlock - endHeight + 1 };
    }
    
    if (Number.isFinite(startHeight)) {
        const endBlock = Math.max(startHeight - blockCount + 1, 1);
        return { startBlock: startHeight, endBlock, effectiveBlockCount: startHeight - endBlock + 1 };
    }
    
    return { startBlock: currentBlock, endBlock: currentBlock - blockCount + 1, effectiveBlockCount: blockCount };
}


async function analyzeMissingValidators(blockCount = ConfigHelper.getDefaultBlockCount(), chainName = 'mainnet', options = {}) {
    // Default options
    const { 
        showAddresses = false, 
        filterProposer = null,
        analyzeValidators = true,
        analyzeProposers = true,
        minValidatorOpportunities = 10, // Minimum opportunities for meaningful validator stats
        startHeight = null,
        endHeight = null,
        showAll = false // Force output of all entries, bypassing thresholds
    } = options;
    
    // Initialize components with consolidated config
    const baseUrl = ConfigHelper.getBlockScannerUrl(chainName);
    const blockFetcher = new BlockFetcher(baseUrl);
    const validatorDB = new ValidatorNameDB();
    
    // Verify database exists and log path for debugging
    const dbPath = ConfigHelper.getValidatorDbPath();
    const fs = require('fs');
    if (fs.existsSync(dbPath)) {
        ProgressReporter.logStep(`Using validator database: ${dbPath}`);
    } else {
        ProgressReporter.logError(`Validator database not found at: ${dbPath}`);
        ProgressReporter.logError('Validator names will not be available. Set VALIDATOR_DB_PATH environment variable if database is elsewhere.');
    }
    
    const { startBlock, endBlock, effectiveBlockCount } = await calculateBlockRange(blockFetcher, blockCount, startHeight, endHeight);
    
    console.log(`📊 Current block: ${startBlock.toLocaleString()}`);
    console.log(`📊 Analyzing ${effectiveBlockCount.toLocaleString()} blocks backwards from ${startBlock.toLocaleString()} to ${endBlock.toLocaleString()}`);
    console.log('=' .repeat(80));
    
    // Fetch all blocks efficiently in parallel
    ProgressReporter.logStep('Fetching blocks');
    const BLOCK_FETCH_CONCURRENCY = 20; // Parallel block fetches
    const blocks = await fetchBlocksParallel(blockFetcher, startBlock, effectiveBlockCount, BLOCK_FETCH_CONCURRENCY, (current, total, blockHeight) => {
        ProgressReporter.showProgress(current, total, blockHeight);
    });
    
    ProgressReporter.clearProgress();
    ProgressReporter.logSuccess(`Fetched ${blocks.length.toLocaleString()} blocks`);
    
    // Cache for voting power data
    const votingPowerCache = new Map();
    
    // Pre-fetch all voting power data points in parallel (every 500 blocks)
    // This is much faster than fetching sequentially during block processing
    ProgressReporter.logStep('Pre-fetching voting power data');
    const votingPowerHeights = [];
    for (let i = 0; i < blocks.length; i += 500) {
        votingPowerHeights.push(blocks[i].height);
    }
    // Also ensure we have the start block
    if (!votingPowerHeights.includes(startBlock)) {
        votingPowerHeights.unshift(startBlock);
    }
    
    // Fetch all voting power data in parallel with controlled concurrency
    const VOTING_POWER_CONCURRENCY = 10;
    for (let i = 0; i < votingPowerHeights.length; i += VOTING_POWER_CONCURRENCY) {
        const batch = votingPowerHeights.slice(i, i + VOTING_POWER_CONCURRENCY);
        const results = await Promise.all(batch.map(height => getVotingPowerData(height, baseUrl)));
        results.forEach((data, idx) => {
            if (data) {
                votingPowerCache.set(batch[idx], data);
            }
        });
    }
    
    // Get initial voting power data (use cached if available)
    let currentVotingPowerData = votingPowerCache.get(startBlock) || await getVotingPowerData(startBlock, baseUrl);
    if (currentVotingPowerData && !votingPowerCache.has(startBlock)) {
        votingPowerCache.set(startBlock, currentVotingPowerData);
    }
    
    ProgressReporter.logSuccess(`Pre-fetched voting power data for ${votingPowerCache.size} block heights`);
    
    // Map to store missing voting power data for each proposer
    const proposerData = new Map();
    
    // Map to store absence data for each validator
    const validatorAbsenceData = new Map();
    
    // Global statistics
    const globalMissingVotingPowerSamples = [];
    const globalMissingPercentageSamples = [];
    const globalFlagCounts = new Map();
    const globalRounds = [];
    const roundCounts = new Map();
    
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        
        // Use cached voting power data (pre-fetched in parallel) or fetch if missing
        if (i > 0 && i % 500 === 0) {
            const cachedData = votingPowerCache.get(block.height);
            if (cachedData) {
                currentVotingPowerData = cachedData;
            } else {
                // Fallback: fetch if not in cache (shouldn't happen with pre-fetch)
                const newVotingPowerData = await getVotingPowerData(block.height, baseUrl);
                if (newVotingPowerData) {
                    currentVotingPowerData = newVotingPowerData;
                    votingPowerCache.set(block.height, newVotingPowerData);
                }
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

            // Track consensus round from last_commit (applies to previous block)
            const roundValueRaw = block?.raw?.last_commit?.round;
            const roundValue = typeof roundValueRaw === 'string' ? parseInt(roundValueRaw, 10) : (typeof roundValueRaw === 'number' ? roundValueRaw : NaN);
            if (!Number.isNaN(roundValue)) {
                globalRounds.push(roundValue);
                roundCounts.set(roundValue, (roundCounts.get(roundValue) || 0) + 1);
            }
            
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
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('🎯 MISSING VOTING POWER ANALYSIS COMPLETE');
    console.log('=' .repeat(80));
    
    displayHistogram('🔎 Observed block_id_flag distribution', globalFlagCounts, k => `flag ${k}`);
    displayHistogram('🔁 Consensus rounds (last_commit.round)', roundCounts);
    
    // Calculate statistics for each proposer (unlucky proposers analysis)
    const proposerAnalysis = analyzeProposers ? Array.from(proposerData.entries())
        .filter(([, data]) => data.blocks >= 3)
        .map(([proposer, data]) => ({
            proposer,
            blockCount: data.blocks,
            votingPowerStats: StatUtils.calculateStats(data.missingVotingPowerSamples),
            percentageStats: StatUtils.calculateStats(data.missingPercentageSamples),
            votingPowerPercentiles: calculatePercentiles(data.missingVotingPowerSamples),
            percentagePercentiles: calculatePercentiles(data.missingPercentageSamples),
            maxMissingBlock: data.missingByBlock.reduce((max, curr) => 
                curr.missingVotingPower > max.missingVotingPower ? curr : max, data.missingByBlock[0])
        })) : [];
    
    // Calculate statistics for each validator (frequently absent validators analysis)
    const validatorAnalysis = analyzeValidators ? Array.from(validatorAbsenceData.entries())
        .filter(([, data]) => data.totalOpportunities >= minValidatorOpportunities)
        .map(([validatorAddress, data]) => ({
            validatorAddress,
            totalOpportunities: data.totalOpportunities,
            absences: data.absences,
            absenceRate: (data.absences / data.totalOpportunities) * 100,
            votingPower: data.votingPower
        }))
        .sort((a, b) => b.absenceRate - a.absenceRate) : [];
    
    let filteredAnalysis = proposerAnalysis;
    if (filterProposer) {
        const proposerNameMap = await fetchValidatorNames(validatorDB, proposerAnalysis.map(a => a.proposer));
        const filterLower = filterProposer.toLowerCase();
        filteredAnalysis = proposerAnalysis.filter(a => 
            a.proposer.toLowerCase().includes(filterLower) || 
            proposerNameMap.get(a.proposer)?.toLowerCase().includes(filterLower)
        );
    }
    
    if (filterProposer && filteredAnalysis.length === 0) {
        console.log(`\n⚠️ No data found for proposer: ${filterProposer}`);
    }
    
    // Sort by average missing voting power percentage (descending)
    filteredAnalysis.sort((a, b) => (b.percentageStats?.avg ?? 0) - (a.percentageStats?.avg ?? 0));
    
    const { items: proposersToShow, skipped: skippedProposers } = filterWithMinCount(
        filteredAnalysis,
        a => (a.percentageStats?.avg ?? 0) > 2.0 || (a.percentageStats?.median ?? 0) > 2.0,
        3,
        showAll
    );
    
    // Display unlucky proposers analysis
    if (analyzeProposers && proposerAnalysis.length > 0) {
        console.log('\n📊 UNLUCKY PROPOSERS - Missing Voting Power During Their Proposals' + 
            (filterProposer ? ` (filtered to: ${filterProposer})` : '') + ':');
        
        const proposerTable = new Table({
            head: ['Proposer', 'Blocks', 'Avg Missing %', 'Median %', 'P90 %', 'P99 %', 'Avg Missing Power', 'Max Missing (Block#)'],
            colWidths: [30, 8, 12, 10, 8, 8, 15, 22],
            wordWrap: true
        });
        
        const proposerNames = await fetchValidatorNames(validatorDB, proposersToShow.map(a => a.proposer));
        if (proposerNames.size === 0 && proposersToShow.length > 0) {
            ProgressReporter.logError(`Warning: No validator names found in database. Check database path: ${dbPath}`);
        } else if (proposerNames.size > 0) {
            ProgressReporter.logSuccess(`Resolved ${proposerNames.size} of ${proposersToShow.length} proposer names`);
        }
        
        for (const analysis of proposersToShow) {
            const proposerName = proposerNames.get(analysis.proposer);
            const proposerDisplay = showAddresses ? analysis.proposer : (proposerName || analysis.proposer);
            
                    const maxMissingDisplay = analysis.maxMissingBlock
            ? `${formatVotingPower(analysis.maxMissingBlock.missingVotingPower)} (#${analysis.maxMissingBlock.blockNumber})`
            : 'n/a';
            
            proposerTable.push([
                proposerDisplay,
                analysis.blockCount,
                analysis.percentageStats.avg.toFixed(2),
                analysis.percentageStats.median.toFixed(2),
                (analysis.percentagePercentiles.p90 || 0).toFixed(1),
                (analysis.percentagePercentiles.p99 || 0).toFixed(1),
                formatVotingPower(analysis.votingPowerStats.avg),
                maxMissingDisplay
            ]);
        }
        
        console.log(proposerTable.toString());
        
        if (!showAll && skippedProposers > 0) {
            console.log(`\n(Showing ${proposersToShow.length} of ${filteredAnalysis.length} proposers. ${skippedProposers} skipped below threshold)`);
        }
    }
    
    // Display frequently absent validators analysis  
    if (analyzeValidators && validatorAnalysis.length > 0) {
        console.log('\n🚨 FREQUENTLY ABSENT VALIDATORS - Chronically Missing from Consensus:');
        
        const validatorTable = new Table({
            head: ['Validator', 'Opportunities', 'Absences', 'Absence Rate %', 'Voting Power'],
            colWidths: [30, 12, 10, 12, 15],
            wordWrap: true
        });
        
        const { items: topAbsentValidators, skipped: skippedValidators } = filterWithMinCount(
            validatorAnalysis,
            v => v.absenceRate > 1.0,
            3,
            showAll
        );
        
        const validatorNames = await fetchValidatorNames(validatorDB, topAbsentValidators.map(a => a.validatorAddress));
        if (validatorNames.size === 0 && topAbsentValidators.length > 0) {
            ProgressReporter.logError(`Warning: No validator names found in database (validators exist but names are N/A). Database: ${dbPath}`);
        }
        
        for (const analysis of topAbsentValidators) {
            const validatorName = validatorNames.get(analysis.validatorAddress);
            const validatorDisplay = showAddresses ? analysis.validatorAddress : (validatorName || analysis.validatorAddress);
            
            validatorTable.push([
                validatorDisplay,
                analysis.totalOpportunities,
                analysis.absences,
                analysis.absenceRate.toFixed(2),
                formatVotingPower(analysis.votingPower)
            ]);
        }
        
        console.log(validatorTable.toString());
        
        if (!showAll && skippedValidators > 0) {
            console.log(`\n(Showing ${topAbsentValidators.length} of ${validatorAnalysis.length} validators. ${skippedValidators} skipped below threshold)`);
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
    console.log(`  Average missing: ${formatVotingPower(overallVotingPowerStats.avg)} (${overallPercentageStats.avg.toFixed(2)}%)`);
    console.log(`  Median missing: ${formatVotingPower(overallVotingPowerStats.median)} (${overallPercentageStats.median.toFixed(2)}%)`);
    console.log(`  90th percentile: ${(overallPercentagePercentiles.p90 || 0).toFixed(2)}%`);
    console.log(`  99th percentile: ${(overallPercentagePercentiles.p99 || 0).toFixed(2)}%`);
    console.log(`  Range: ${formatVotingPower(overallVotingPowerStats.min)} - ${formatVotingPower(overallVotingPowerStats.max)}`);
    if (currentVotingPowerData) {
        console.log(`  Total network voting power: ${formatVotingPower(currentVotingPowerData.totalVotingPower)}`);
    }
    
    // Summary insights
    if (analyzeValidators && validatorAnalysis.length > 0) {
        const highAbsence = validatorAnalysis.filter(v => v.absenceRate > 25.0);
        if (highAbsence.length > 0) {
            console.log(`\n🚨 HIGH ABSENCE VALIDATORS: ${highAbsence.length} validators with >25% absence rate`);
        }
    }
    
    if (analyzeProposers && proposerAnalysis.length > 0) {
        const highMissing = proposerAnalysis.filter(p => p.percentageStats.avg > 10.0);
        if (highMissing.length > 0) {
            console.log(`\n📊 HIGH MISSING POWER PROPOSERS: ${highMissing.length} proposers with >10% average missing voting power`);
        }
        const unlucky = proposerAnalysis.filter(p => p.percentageStats.avg > overallPercentageStats.avg * 1.5);
        if (unlucky.length > 0) {
            console.log(`\n📊 UNLUCKY PROPOSERS: ${unlucky.length} proposers see 50%+ more missing power than average`);
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
  --start=N              Start block height (analyze from this block downward)
  --end=N                End block height (inclusive). Requires --start. start >= end.
  -c, --chain=NAME       Chain to use: mainnet|bepolia (default: mainnet)
  -a, --addresses        Show validator addresses instead of names
  -p, --proposer=X       Filter analysis to a specific proposer (address or name substring)
  --validators-only      Only analyze frequently absent validators (skip proposer analysis)
  --proposers-only       Only analyze unlucky proposers (skip validator analysis)
  --min-opportunities=N  Minimum opportunities for validator analysis (default: 10)
  --show-all             Show all entries, bypassing threshold filters
  -h, --help             Show this help message

Examples:
  node analyze-missing-validators.js                         # Analyze both validators and proposers
  node analyze-missing-validators.js --blocks=2000           # Analyze 2000 blocks
  node analyze-missing-validators.js --start=10100000 --end=10095000  # Explicit range
  node analyze-missing-validators.js --chain=bepolia         # Use testnet
  node analyze-missing-validators.js --validators-only       # Only show frequently absent validators
  node analyze-missing-validators.js --proposers-only        # Only show unlucky proposers
  node analyze-missing-validators.js --min-opportunities=20  # Require 20+ opportunities for validator stats
  node analyze-missing-validators.js --addresses             # Show validator addresses instead of names
  node analyze-missing-validators.js --proposer=0x123        # Filter to specific proposer address
  node analyze-missing-validators.js --show-all              # Show all entries, bypassing thresholds
    `);
}

// CLI handling
if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .option('blocks', {
            alias: 'b',
            type: 'number',
            default: ConfigHelper.getDefaultBlockCount(),
            description: 'Number of blocks to analyze'
        })
        .option('start', {
            type: 'number',
            description: 'Start block height (analyze from this block downward)'
        })
        .option('end', {
            type: 'number',
            description: 'End block height (inclusive). Requires --start. start >= end.'
        })
        .option('chain', {
            alias: 'c',
            type: 'string',
            default: 'mainnet',
            choices: ['mainnet', 'bepolia'],
            description: 'Chain to use'
        })
        .option('addresses', {
            alias: 'a',
            type: 'boolean',
            default: false,
            description: 'Show validator addresses instead of names'
        })
        .option('proposer', {
            alias: 'p',
            type: 'string',
            description: 'Filter analysis to a specific proposer (address or name substring)'
        })
        .option('validators-only', {
            type: 'boolean',
            default: false,
            description: 'Only analyze frequently absent validators (skip proposer analysis)'
        })
        .option('proposers-only', {
            type: 'boolean',
            default: false,
            description: 'Only analyze unlucky proposers (skip validator analysis)'
        })
        .option('min-opportunities', {
            type: 'number',
            default: 10,
            description: 'Minimum opportunities for validator analysis'
        })
        .option('show-all', {
            type: 'boolean',
            default: false,
            description: 'Show all entries, bypassing threshold filters'
        })
        .option('help', {
            alias: 'h',
            type: 'boolean',
            description: 'Show help message'
        })
        .strict()
        .help()
        .argv;
    
    if (argv.help) {
        showHelp();
        process.exit(0);
    }
    
    const options = {
        showAddresses: argv.addresses,
        filterProposer: argv.proposer || null,
        analyzeValidators: !argv['proposers-only'],
        analyzeProposers: !argv['validators-only'],
        minValidatorOpportunities: argv['min-opportunities'],
        startHeight: argv.start !== undefined ? argv.start : null,
        endHeight: argv.end !== undefined ? argv.end : null,
        showAll: argv['show-all']
    };
    
    analyzeMissingValidators(argv.blocks, argv.chain, options)
        .then(() => {
            process.exit(0);
        })
        .catch(error => {
            ProgressReporter.logError(`Script failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { analyzeMissingValidators };
