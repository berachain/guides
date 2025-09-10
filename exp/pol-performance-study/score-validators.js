#!/usr/bin/env node

import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration constants
const CHUNK_SIZE = 200;
const BLOCKS_PER_DAY = 43200; // Approximate, used for binary search estimates
const EMPTY_BLOCK_THRESHOLD = 1; // Blocks with at least this many transactions are not empty
const GENESIS_TIMESTAMP = 1737382451; // 2025-01-20 14:14:11 UTC
const BGT_CONTRACT = '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba';
const TEST_BLOCKS_TO_SCAN = 5000; // Number of blocks to scan in test mode

// Environment variables with defaults from old script
const EL_ETHRPC_URL = process.env.EL_ETHRPC_URL || 'http://37.27.231.195:59830';
const CL_ETHRPC_URL = process.env.CL_ETHRPC_URL || 'http://37.27.231.195:59820';

// Command line arguments
const args = process.argv.slice(2);
const isTestMode = args.includes('--test');
const showHelp = args.includes('--help') || args.includes('-h');

// Show help if requested
if (showHelp) {
    console.log(`
Validator POL Performance Study

Usage:
  node validator-scoring.js [options]

Options:
  --days=N          Number of days to analyze (default: 45)
  --test            Run in test mode for quick validation
  --help, -h        Show this help message

Examples:
  node validator-scoring.js --days=1     # Analyze yesterday
  node validator-scoring.js --days=7     # Analyze last 7 days
  node validator-scoring.js --test       # Run test mode
  node validator-scoring.js              # Analyze last 45 days (default)

Environment Variables:
  EL_ETHRPC_URL     Execution layer RPC endpoint
  CL_ETHRPC_URL     Consensus layer RPC endpoint
  FULL_DETAIL       Set to 'true' for detailed CSV output
`);
    process.exit(0);
}

const daysToAnalyze = parseInt(args.find(arg => arg.startsWith('--days='))?.split('=')[1]) || 45;
const showFullDetail = process.env.FULL_DETAIL === 'true';

// Utility functions
function log(message) {
    console.error(message);
}

function logProgress(current, total, description = '') {
    const percent = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percent / 2)) + '░'.repeat(50 - Math.floor(percent / 2));
    process.stderr.write(`\r${description} [${bar}] ${percent}% (${current}/${total})`);
    if (current === total) process.stderr.write('\n');
}

async function withRetry(operation, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (error.message.includes('Fetch failed') || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNRESET')) {
                if (attempt < maxRetries) {
                    log(`Attempt ${attempt} failed, retrying in ${delay/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

// RPC helper functions
async function jsonRpcCall(url, method, params = []) {
    return withRetry(async () => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method,
                params
            })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.result;
    });
}

async function getBlockProposer(blockHeight) {
    return withRetry(async () => {
        const response = await fetch(`${CL_ETHRPC_URL}/header?height=${blockHeight}`);
        const data = await response.json();
        if (!data.result?.header?.proposer_address) {
            throw new Error(`No proposer found for block ${blockHeight}`);
        }
        return data.result.header.proposer_address;
    });
}

async function getBlockTimestamp(blockNumber) {
    const provider = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    const block = await provider.getBlock(blockNumber);
    return block.timestamp;
}

// Contract interaction functions
async function getValidatorVotingPower(blockHeight) {
    return withRetry(async () => {
        const validators = {};
        let page = 1;
        const perPage = 100; // Use 100 instead of 99 for better pagination
        
        while (true) {
            const response = await fetch(`${CL_ETHRPC_URL}/validators?height=${blockHeight}&per_page=${perPage}&page=${page}`);
            if (!response.ok) {
                log(`HTTP error ${response.status}: ${response.statusText} for block ${blockHeight} page ${page}`);
                break;
            }
            
            const data = await response.json();
            if (data.error) {
                log(`RPC error for block ${blockHeight} page ${page}: ${data.error.message}`);
                break;
            }
            
            if (!data.result?.validators || data.result.validators.length === 0) {
                break; // No more validators
            }
            
                    if (process.env.VERBOSE && page === 1) {
            log(`Found ${data.result.validators.length} validators at block ${blockHeight} page ${page}`);
        }
        
        data.result.validators.forEach(validator => {
            validators[validator.address] = {
                address: validator.address,
                voting_power: validator.voting_power / 1e9, // Convert GWEI to BERA
                pub_key: validator.pub_key.value
            };
        });
        
        // If we got fewer validators than requested, we've reached the end
        if (data.result.validators.length < perPage) {
            break;
        }
        
        page++;
    }
    
    if (Object.keys(validators).length === 0) {
        log(`No validators found for block ${blockHeight}`);
        return null;
    }
    
    if (process.env.VERBOSE) {
        log(`Total validators found: ${Object.keys(validators).length}`);
        
        // Log some sample data for debugging
        const sampleKeys = Object.keys(validators).slice(0, 3);
        sampleKeys.forEach(key => {
            log(`Sample validator ${key}: voting_power=${validators[key].voting_power} BERA`);
        });
    }
        
        return validators;
    });
}

async function getValidatorBoost(validatorPubkey, blockNumber) {
    try {
        const result = await callContractFunction(
            BGT_CONTRACT,
            "boostees(bytes)",
            [`0x${validatorPubkey}`],
            blockNumber
        );
        
        if (result && result !== '0x') {
            const rawValue = parseInt(result, 16);
            return rawValue / 1e18; // Convert wei to BGT
        }
        return 0;
    } catch (error) {
        log(`Error getting boost for validator ${validatorPubkey}: ${error.message}`);
        return 0;
    }
}

async function callContractFunction(contractAddress, functionSignature, params, blockNumber = 'latest') {
    return withRetry(async () => {
        const { execSync } = await import('child_process');
        const output = execSync(`cast call --rpc-url ${EL_ETHRPC_URL} --block ${blockNumber} ${contractAddress} "${functionSignature}" ${params.join(' ')}`, { encoding: 'utf8' });
        return output.trim();
    });
}

// Validator loading
function loadValidators() {
    const csvContent = fs.readFileSync('genesis_validators.csv', 'utf8');
    const lines = csvContent.split('\n');
    const validators = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
            const [cometAddress, name, pubkey, operatorAddress] = line.split(',');
            validators.push({
                name,
                proposer: cometAddress,
                pubkey: pubkey.startsWith('0x') ? pubkey.substring(2) : pubkey,
                operatorAddress
            });
        }
    }
    
    return validators;
}

// Day boundary detection
async function findDayBoundaries(dates) {
    log('Finding day boundary blocks...');
    let numGuesses = 0;
    const provider = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    const latestBlock = await provider.getBlockNumber();
    const boundaries = {};
    const progress = createProgressBar(dates.length, 'Finding boundaries');
    
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const midnight = new Date(date);
        midnight.setUTCHours(0, 0, 0, 0);
        const targetTimestamp = Math.floor(midnight.getTime() / 1000);
        
        // Use iterative approach like find_day_boundaries.js
        let estimatedBlock;
        if (i === 0) {
            // For the first date, calculate from genesis using block time
            const secondsSinceGenesis = targetTimestamp - GENESIS_TIMESTAMP;
            const estimatedBlocks = Math.floor(secondsSinceGenesis / 2); // 2 second block time
            estimatedBlock = Math.max(1, estimatedBlocks);
        } else {
            const previousDate = dates[i - 1];
            const previousBoundary = boundaries[previousDate.toISOString().split('T')[0]];
            if (!previousBoundary) {
                throw new Error(`No previous boundary found for ${previousDate.toISOString().split('T')[0]}, cannot continue`);
            }
            estimatedBlock = previousBoundary + BLOCKS_PER_DAY; // Daily block guess
        }
        
        // If estimated block is beyond latest block, adjust it
        if (estimatedBlock > latestBlock) {
            log(`Estimated block ${estimatedBlock} is beyond latest block ${latestBlock}, adjusting...`);
            estimatedBlock = latestBlock - 1000; // Start from a reasonable point before latest
        }
        
        let candidateBlock = estimatedBlock;
        let attempts = 0;
        const maxAttempts = 200; // Prevent infinite loops, but give more attempts
        
        while (attempts < maxAttempts) {            attempts++;
            numGuesses++;
            try {
                // Get current block and previous block timestamps
                const currentBlock = await provider.getBlock(candidateBlock);
                const prevBlock = await provider.getBlock(candidateBlock - 1);
                
                if (!currentBlock || !prevBlock) {
                    log(`Cannot get blocks ${candidateBlock} or ${candidateBlock - 1}, trying next block`);
                    candidateBlock += 1;
                    continue;
                }
                
                const currentTimestamp = currentBlock.timestamp;
                const prevTimestamp = prevBlock.timestamp;
                
                // Check if we have the correct boundary
                if (currentTimestamp >= targetTimestamp && prevTimestamp < targetTimestamp) {
                    boundaries[date.toISOString().split('T')[0]] = candidateBlock;
                    break;
                }
                
                // Calculate how far off we are and adjust
                if (currentTimestamp < targetTimestamp) {
                    // Current block is before target, need to go forward
                    const blocksToAdd = Math.ceil((targetTimestamp - currentTimestamp) / 2);
                    candidateBlock += Math.max(1, blocksToAdd);
                } else if (prevTimestamp >= targetTimestamp) {
                    // Previous block is after target, need to go backward
                    const blocksToSubtract = Math.ceil((prevTimestamp - targetTimestamp) / 2);
                    candidateBlock -= Math.max(1, blocksToSubtract);
                } else {
                    // We're in the right range but not at the boundary
                    candidateBlock += 1;
                }
                
                // Safety check
                if (candidateBlock <= 0 || candidateBlock > latestBlock) {
                    log(`Candidate block ${candidateBlock} out of range, stopping`);
                    break;
                }
            } catch (error) {
                log(`Error getting block ${candidateBlock}: ${error.message}`);
                candidateBlock += 1;
            }
        }
        
        if (!boundaries[date.toISOString().split('T')[0]]) {
            throw new Error(`No boundary block found for date: ${date.toISOString().split('T')[0]}`);
        }
        progress.update(i + 1);
    }
    
    progress.finish();
    log(`Guesed ${numGuesses} times to find ${Object.keys(boundaries).length} boundary blocks`);
    return boundaries;
}

// Uptime scoring function
function calculateUptimeScore(emptyBlocks, totalBlocks) {
    const emptyBlockPercentage = calculateEmptyBlockPercentage(emptyBlocks, totalBlocks);
    return Math.max(0, 100 - emptyBlockPercentage);
}

// Calculate empty block percentage
function calculateEmptyBlockPercentage(emptyBlocks, totalBlocks) {
    return totalBlocks > 0 ? (emptyBlocks / totalBlocks) * 100 : 0;
}

// Calculate POL ratio
function calculatePolRatio(boost, stake) {
    return stake === 0 ? 0 : boost / stake;
}

// Collect stake and boost data for a single validator
async function collectValidatorData(validator, blockNumber, votingPowerData) {
    try {
        // Try exact match first, then case-insensitive match
        let stakeBalance = votingPowerData?.[validator.proposer]?.voting_power || 0;
        if (stakeBalance === 0 && votingPowerData) {
            const lowerProposer = validator.proposer.toLowerCase();
            const foundByLower = Object.keys(votingPowerData).find(addr => addr.toLowerCase() === lowerProposer);
            if (foundByLower) {
                stakeBalance = votingPowerData[foundByLower].voting_power;
                log(`Debug: Found stake by case-insensitive match: ${foundByLower} -> ${stakeBalance}`);
            }
        }
        const boostBalance = await getValidatorBoost(validator.pubkey, blockNumber);
        const ratio = calculatePolRatio(boostBalance, stakeBalance);
        
        // Debug logging for first few validators (only in verbose mode)
        if (process.env.VERBOSE && Object.keys(votingPowerData || {}).length > 0) {
            log(`Debug: ${validator.name} (${validator.proposer}) - stake: ${stakeBalance}, boost: ${boostBalance}, ratio: ${ratio}`);
        }
        
        return {
            stake: stakeBalance,
            boost: boostBalance,
            ratio: ratio
        };
    } catch (error) {
        log(`Error collecting data for ${validator.name}: ${error.message}`);
        return {
            stake: 0,
            boost: 0,
            ratio: 0
        };
    }
}

// Progress bar utility
class ProgressBar {
    constructor(total, description = '') {
        this.total = total;
        this.current = 0;
        this.description = description;
    }

    update(value) {
        this.current = value;
        logProgress(this.current, this.total, this.description);
    }

    finish() {
        this.update(this.total);
    }
}

function createProgressBar(total, description = '') {
    return new ProgressBar(total, description);
}

// Block scanning worker
async function scanBlockChunk(chunkStart, chunkEnd, validators, validatorMap) {
    const provider = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    const chunkResults = new Map();
    
    for (let blockNum = chunkStart; blockNum <= chunkEnd; blockNum++) {
        try {
            const proposer = await getBlockProposer(blockNum);
            if (validatorMap.has(proposer)) {
                const block = await provider.getBlock(blockNum);
                const isEmpty = !block.transactions || block.transactions.length <= EMPTY_BLOCK_THRESHOLD;
                
                if (!chunkResults.has(proposer)) {
                    chunkResults.set(proposer, { blocks: [], emptyBlockNumbers: [] });
                }
                
                chunkResults.get(proposer).blocks.push(blockNum);
                if (isEmpty) {
                    chunkResults.get(proposer).emptyBlockNumbers.push(blockNum);
                }
            }
        } catch (error) {
            log(`Error at block ${blockNum}: ${error.message}`);
        }
    }
    
    return chunkResults;
}

// Parallel block scanning
async function scanBlocksParallel(startBlock, endBlock, validators, validatorMap, showProgress = true) {
    const totalChunks = Math.ceil((endBlock - startBlock + 1) / CHUNK_SIZE);
    const progress = showProgress ? createProgressBar(totalChunks, 'Scanning block chunks') : null;
    
    const chunks = [];
    for (let chunkStart = startBlock; chunkStart <= endBlock; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, endBlock);
        chunks.push({ chunkStart, chunkEnd });
    }
    
    const results = [];
    const workerCount = Math.max(1, os.cpus().length - 1);
    
    for (let i = 0; i < chunks.length; i += workerCount) {
        const batch = chunks.slice(i, i + workerCount);
        const batchPromises = batch.map(chunk => 
            scanBlockChunk(chunk.chunkStart, chunk.chunkEnd, validators, validatorMap)
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        if (progress) {
            progress.update(Math.min(i + workerCount, chunks.length));
        }
    }
    
    if (progress) {
        progress.finish();
    }
    
    // Merge results
    const mergedResults = new Map();
    results.forEach(chunkResult => {
        chunkResult.forEach((data, proposer) => {
            if (!mergedResults.has(proposer)) {
                mergedResults.set(proposer, { blocks: [], emptyBlockNumbers: [] });
            }
            mergedResults.get(proposer).blocks.push(...data.blocks);
            if (data.emptyBlockNumbers && Array.isArray(data.emptyBlockNumbers)) {
                mergedResults.get(proposer).emptyBlockNumbers.push(...data.emptyBlockNumbers);
            }
        });
    });
    
    return mergedResults;
}

// Stake and boost collection
async function collectStakeAndBoost(validators, dayBoundaries) {
    log('Collecting stake and boost data...');
    const stakeBoostData = {};
    const progress = createProgressBar(Object.keys(dayBoundaries).length, 'Collecting stake/boost');
    let completed = 0;
    
    for (const [date, blockNumber] of Object.entries(dayBoundaries)) {
        stakeBoostData[date] = {};
        
        try {
            // Get voting power for all validators at this block
            const votingPowerData = await getValidatorVotingPower(blockNumber);
            
            if (votingPowerData && process.env.VERBOSE) {
                log(`Collected voting power data for ${Object.keys(votingPowerData).length} validators at block ${blockNumber}`);
                
                // Calculate total stake for debugging
                const totalStake = Object.values(votingPowerData).reduce((sum, v) => sum + v.voting_power, 0);
                log(`Total stake at block ${blockNumber}: ${totalStake.toLocaleString()} BERA`);
            } else if (!votingPowerData) {
                log(`No voting power data collected for block ${blockNumber}`);
            }
            
            // Get boost data for each validator
            for (const validator of validators) {
                stakeBoostData[date][validator.proposer] = await collectValidatorData(validator, blockNumber, votingPowerData);
            }
            
                    // Log collected stake data summary (only in verbose mode)
        if (process.env.VERBOSE) {
            const totalStake = Object.values(stakeBoostData[date]).reduce((sum, data) => sum + data.stake, 0);
            log(`Stake data collected for ${date}: total stake = ${totalStake.toLocaleString()} BERA`);
        }
        } catch (error) {
            log(`Error collecting voting power data for ${date}: ${error.message}`);
            // Set default values for all validators on this date
            for (const validator of validators) {
                stakeBoostData[date][validator.proposer] = {
                    stake: 0,
                    boost: 0,
                    ratio: 0
                };
            }
        }
        
        completed++;
        progress.update(completed);
    }
    
    progress.finish();
    return stakeBoostData;
}

// Statistics calculation
function calculateStatistics(blockResults, stakeBoostData, dayBoundaries, validators) {
    const statistics = {};
    const sortedDates = Object.keys(dayBoundaries).sort();
    
    // Only process the analyzed dates (excluding the boundary date)
    const datesToProcess = sortedDates.slice(0, sortedDates.length - 1);
    
    // Calculate per-day statistics
    for (let i = 0; i < datesToProcess.length; i++) {
        const date = datesToProcess[i];
        const nextDate = sortedDates[i + 1];
        const dayStartBlock = dayBoundaries[date];
        if (!nextDate) {
            throw new Error(`No next day block found for date ${date}. This script refuses to guess the end block. If you want to analyze the last day, please provide a complete day range.`);
        }
        const dayEndBlock = dayBoundaries[nextDate] - 1;
        
        // Find max POL ratio for this day
        const dayRatios = Object.values(stakeBoostData[date] || {}).map(data => data.ratio);
        const maxRatio = Math.max(...dayRatios, 0);
        
        statistics[date] = {};
        
        // Process each validator's data for this day
        for (const [proposer, validatorData] of blockResults) {
            const dayBlocks = validatorData.blocks.filter(blockNum => 
                blockNum >= dayStartBlock && blockNum <= dayEndBlock
            );
            
            // Count empty blocks for this day
            const dayEmptyBlocks = validatorData.emptyBlockNumbers.filter(blockNum => 
                blockNum >= dayStartBlock && blockNum <= dayEndBlock
            ).length;
            
            const totalBlocks = dayBlocks.length;
            const uptimeScore = calculateUptimeScore(dayEmptyBlocks, totalBlocks);
            const emptyBlockPercentage = calculateEmptyBlockPercentage(dayEmptyBlocks, totalBlocks);
            
            const polRatio = stakeBoostData[date]?.[proposer]?.ratio || 0;
            const polScore = maxRatio > 0 ? (polRatio / maxRatio) * 100 : 0;
            
            statistics[date][proposer] = {
                totalBlocks,
                emptyBlocks: dayEmptyBlocks,
                emptyBlockPercentage,
                uptimeScore,
                polScore,
                stake: stakeBoostData[date]?.[proposer]?.stake || 0,
                boost: stakeBoostData[date]?.[proposer]?.boost || 0,
                polRatio
            };
        }
        
        // Add validators that weren't found in blockResults (they had 0 blocks)
        for (const validator of validators) {
            if (!statistics[date][validator.proposer]) {
                const polRatio = stakeBoostData[date]?.[validator.proposer]?.ratio || 0;
                const polScore = maxRatio > 0 ? (polRatio / maxRatio) * 100 : 0;
                
                statistics[date][validator.proposer] = {
                    totalBlocks: 0,
                    emptyBlocks: 0,
                    emptyBlockPercentage: 0,
                    uptimeScore: 100, // Perfect uptime if no blocks
                    polScore,
                    stake: stakeBoostData[date]?.[validator.proposer]?.stake || 0,
                    boost: stakeBoostData[date]?.[validator.proposer]?.boost || 0,
                    polRatio
                };
            }
        }
    }
    
    return statistics;
}

// Report generation
function generateReport(statistics, validators, dayBoundaries) {
    const sortedDates = Object.keys(dayBoundaries).sort();
    const validatorMap = new Map(validators.map(v => [v.proposer, v]));
    
    // Calculate averages for each validator
    const validatorAverages = {};
    
    for (const validator of validators) {
        const uptimeScores = [];
        const polScores = [];
        
        for (const date of sortedDates) {
            const dayStats = statistics[date]?.[validator.proposer];
            if (dayStats) {
                uptimeScores.push(dayStats.uptimeScore);
                polScores.push(dayStats.polScore);
            }
        }
        
        const avgUptimeScore = uptimeScores.length > 0 ? 
            uptimeScores.reduce((sum, score) => sum + score, 0) / uptimeScores.length : 0;
        const avgPolScore = polScores.length > 0 ? 
            polScores.reduce((sum, score) => sum + score, 0) / polScores.length : 0;
        // const totalScore = (avgUptimeScore + avgPolScore) / 2;
        const totalScore = (avgUptimeScore*2/3 + avgPolScore*1/3);
        
        // Get most recent stake from the last analyzed date (not the boundary date)
        const lastAnalyzedDate = sortedDates[sortedDates.length - 2]; // -2 because -1 is the boundary date
        const mostRecentStake = statistics[lastAnalyzedDate]?.[validator.proposer]?.stake || 0;
        
        validatorAverages[validator.proposer] = {
            name: validator.name,
            validatorAddress: validator.proposer,
            operatorAddress: validator.operatorAddress,
            pubkey: validator.pubkey,
            avgUptimeScore,
            avgPolScore,
            totalScore,
            stake: mostRecentStake,
            days: sortedDates.map(date => ({
                date,
                ...statistics[date]?.[validator.proposer]
            }))
        };
    }
    
    // Sort by total score
    const rankings = Object.values(validatorAverages).sort((a, b) => b.totalScore - a.totalScore);
    
    // Console output
    log('\nValidator Rankings:');
    log('='.repeat(100));
    log(
        'Rank'.padEnd(6),
        'Validator'.padEnd(30),
        'Total'.padEnd(8),
        'Uptime'.padEnd(8),
        'PoL'.padEnd(8),
        'Stake (BERA)'
    );
    log('-'.repeat(100));
    
    rankings.forEach((validator, index) => {
        const line = `${(index + 1).toString().padEnd(6)}${validator.name.padEnd(30)}${validator.totalScore.toFixed(2).padEnd(8)}${validator.avgUptimeScore.toFixed(2).padEnd(8)}${validator.avgPolScore.toFixed(2).padEnd(8)}${validator.stake.toLocaleString()}`;
        log(line);
    });
    log('='.repeat(100));
    
    // CSV output
    let csvHeader = 'Validator name,Pubkey,Proposer,Operator,Stake,Uptime Score,POL Score,Total Score';
    
    if (showFullDetail) {
        sortedDates.forEach(date => {
            csvHeader += `,${date} boost,${date} stake,${date} empty blocks,${date} total blocks,${date} boost/stake ratio,${date} empty block ratio`;
        });
    }
    
    const csvRows = rankings.map(validator => {
        let row = `${validator.name},${validator.pubkey},${validator.validatorAddress},${validator.operatorAddress},${validator.stake.toFixed(6)},${validator.avgUptimeScore.toFixed(2)},${validator.avgPolScore.toFixed(2)},${validator.totalScore.toFixed(2)}`;
        
        if (showFullDetail) {
            validator.days.forEach(day => {
                row += `,${(day.boost || 0).toFixed(6)},${(day.stake || 0).toFixed(6)},${day.emptyBlocks || 0},${day.totalBlocks || 0},${(day.polRatio || 0).toFixed(6)},${(day.emptyBlockPercentage || 0).toFixed(2)}`;
            });
        }
        
        return row;
    });
    
    const csvContent = [csvHeader, ...csvRows].join('\n');
    const reportFile = `validator_stats.csv`;
    fs.writeFileSync(reportFile, csvContent); 
    log(`\nDetailed report saved to ${reportFile}`);
    
    return rankings;
}

// Test mode functions
async function runTestMode() {
    log('Running in test mode...');
    
    // Find previous day's start block
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    
    const boundaries = await findDayBoundaries([yesterday]);
    const dateKey = yesterday.toISOString().split('T')[0];
    const previousDayStartBlock = boundaries[dateKey];
    
    log(`Looking for date: ${dateKey}`);
    log(`Found boundaries: ${JSON.stringify(boundaries)}`);
    
    if (!previousDayStartBlock) {
        throw new Error('Could not find previous day start block');
    }
    
    log(`Previous day start block: ${previousDayStartBlock}`);
    
    // Load validators
    const validators = loadValidators();
    const validatorMap = new Map(validators.map(v => [v.proposer, v]));
    
    // Collect boost and stake values at that block
    const stakeBoostData = {};
    stakeBoostData[dateKey] = {};
    
    log('Collecting stake and boost data for test...');
    
    // Get voting power for all validators at this block
    const votingPowerData = await getValidatorVotingPower(previousDayStartBlock);
    
    for (const validator of validators) {
        stakeBoostData[dateKey][validator.proposer] = await collectValidatorData(validator, previousDayStartBlock, votingPowerData);
    }
    
    // Scan blocks for genesis validators and empty blocks
    const endBlock = previousDayStartBlock + TEST_BLOCKS_TO_SCAN - 1;
    log(`Scanning blocks ${previousDayStartBlock} to ${endBlock}...`);
    
    const blockResults = await scanBlocksParallel(previousDayStartBlock, endBlock, validators, validatorMap);
    
    // Find worst offender
    let worstValidator = null;
    let worstScore = Infinity;
    
    for (const [proposer, data] of blockResults) {
        const validator = validatorMap.get(proposer);
        const totalBlocks = data.blocks.length;
        const emptyBlocks = data.emptyBlockNumbers.length;
        const uptimeScore = calculateUptimeScore(emptyBlocks, totalBlocks);
        
        const polRatio = stakeBoostData[dateKey]?.[proposer]?.ratio || 0;
        
        if (uptimeScore < worstScore) {
            worstScore = uptimeScore;
            worstValidator = {
                name: validator.name,
                proposer,
                pubkey: validator.pubkey,
                totalBlocks,
                emptyBlocks,
                uptimeScore,
                polRatio,
                stake: stakeBoostData[dateKey]?.[proposer]?.stake || 0,
                boost: stakeBoostData[dateKey]?.[proposer]?.boost || 0
            };
        }
    }
    
    // Report results
    log('\nTest Mode Results:');
    log('='.repeat(80));
    log(`Scanned blocks: ${previousDayStartBlock} to ${endBlock} (${endBlock - previousDayStartBlock + 1} blocks)`);
    
    if (worstValidator) {
        log(`Worst offender: ${worstValidator.name}`);
        log(`Pubkey: ${worstValidator.pubkey}`);
        const emptyBlockPercentage = calculateEmptyBlockPercentage(worstValidator.emptyBlocks, worstValidator.totalBlocks);
        log(`Empty blocks: ${worstValidator.emptyBlocks}/${worstValidator.totalBlocks} (${emptyBlockPercentage.toFixed(2)}%)`);
        log(`Uptime score: ${worstValidator.uptimeScore.toFixed(2)}`);
        log(`POL ratio: ${worstValidator.polRatio.toFixed(6)}`);
        log(`Stake: ${worstValidator.stake} BERA`);
        log(`Boost: ${worstValidator.boost} BGT`);
    } else {
        log('No validators found in scanned blocks');
    }
    log('='.repeat(80));
}

// Main execution
async function main() {
    try {
        if (isTestMode) {
            await runTestMode();
            return;
        }
        
        // Regular mode
        log(`Analyzing ${daysToAnalyze} days of validator performance...`);
        
        // Generate dates to analyze (complete days, starting from yesterday)
        // Also include today to find the boundary for the last analyzed day's end block
        const today = new Date();
        const dates = Array.from({ length: daysToAnalyze + 1 }, (_, i) => {
            const date = new Date(today);
            date.setDate(date.getDate() - (daysToAnalyze - i)); // i=0 -> first day to analyze, i=daysToAnalyze -> today
            return date;
        });
        
        // Load validators
        const validators = loadValidators();
        if (validators.length === 0) {
            throw new Error('No validators loaded from genesis_validators.csv');
        }
        
        const validatorMap = new Map(validators.map(v => [v.proposer, v]));
        
        // Find day boundaries
        const dayBoundaries = await findDayBoundaries(dates);
        
        // Calculate block ranges for each day
        const sortedDates = Object.keys(dayBoundaries).sort();
        const dayRanges = {};
        
        // Only analyze the first N days (excluding today which is used for boundary calculation)
        const datesToAnalyze = sortedDates.slice(0, daysToAnalyze);
        
        for (let i = 0; i < datesToAnalyze.length; i++) {
            const currentDate = datesToAnalyze[i];
            const nextDate = sortedDates[i + 1];
            
            const dayStartBlock = dayBoundaries[currentDate];
            if (!nextDate) {
                throw new Error(`No next day block found for date ${currentDate}. This script refuses to guess the end block. If you want to analyze the last day, please provide a complete day range.`);
            }
            const dayEndBlock = dayBoundaries[nextDate] - 1;
            
            dayRanges[currentDate] = {
                startBlock: dayStartBlock,
                endBlock: dayEndBlock
            };
        }
        
        // Scan blocks for proposers and empty blocks
        log('\nScanning blocks for proposers and empty blocks...');
        
        // Calculate total blocks to scan for progress bar
        const totalBlocksToScan = Object.values(dayRanges).reduce((sum, range) => 
            sum + (range.endBlock - range.startBlock + 1), 0
        );
        
        // Scan all day ranges
        const allBlockResults = new Map();
        for (const [date, range] of Object.entries(dayRanges)) {
            log(`Scanning day ${date}: blocks ${range.startBlock} to ${range.endBlock}`);
            const dayResults = await scanBlocksParallel(range.startBlock, range.endBlock, validators, validatorMap, true);
            
            // Count empty blocks for this day
            let dayEmptyBlocks = 0;
            dayResults.forEach((data, proposer) => {
                dayEmptyBlocks += data.emptyBlockNumbers.length;
            });
            log(`Found ${dayEmptyBlocks} empty blocks`);
            
            // Merge results
            dayResults.forEach((data, proposer) => {
                if (!allBlockResults.has(proposer)) {
                    allBlockResults.set(proposer, { blocks: [], emptyBlockNumbers: [] });
                }
                allBlockResults.get(proposer).blocks.push(...data.blocks);
                if (data.emptyBlockNumbers && Array.isArray(data.emptyBlockNumbers)) {
                    allBlockResults.get(proposer).emptyBlockNumbers.push(...data.emptyBlockNumbers);
                }
            });
        }
        
        const blockResults = allBlockResults;
        
        // Collect stake and boost data
        const stakeBoostData = await collectStakeAndBoost(validators, dayBoundaries);
        
        // Calculate statistics
        log('\nCalculating statistics...');
        const statistics = calculateStatistics(blockResults, stakeBoostData, dayBoundaries, validators);
        
        // Generate report
        log('\nGenerating report...');
        generateReport(statistics, validators, dayBoundaries);
        
    } catch (error) {
        log('Fatal error: ' + error.message);
        process.exit(1);
    }
}

// Run if this is the main thread
if (isMainThread) {
    main();
}
