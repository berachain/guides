#!/usr/bin/env node

import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import { isMainThread } from 'worker_threads';

// Environment variables
const EL_ETHRPC_URL = process.env.EL_ETHRPC_URL || 'http://37.27.231.195:59830';
const CL_ETHRPC_URL = process.env.CL_ETHRPC_URL || 'http://37.27.231.195:59820';
const HONEY_TOKEN = process.env.HONEY_TOKEN || '0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce';
const DISTRIBUTOR_ADDRESS = process.env.DISTRIBUTOR_ADDRESS || '0xD2f19a79b026Fb636A7c300bF5947df113940761';

// Configuration constants
const CHUNK_SIZE = 200; // Block scanning chunk size
const BLOCKS_PER_DAY = 43200; // Approximate, used for binary search estimates
const EMPTY_BLOCK_THRESHOLD = 1; // A block is considered empty if it has <= 1 transactions (i.e., 0 or 1)
const GENESIS_TIMESTAMP = 1737382451; // 2025-01-20 14:14:11 UTC
const BGT_CONTRACT = '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba';
const KYBER_ROUTE_URL = 'https://gateway.mainnet.berachain.com/proxy/kyberswap/berachain/api/v1/routes';

// Concurrency and performance constants
const LOG_CHUNK_SIZE = 1000; // Size of each log fetching chunk in blocks
const LOG_BATCH_SIZE = 16; // Number of log chunks to process in parallel
const MAX_WORKER_COUNT = Math.max(1, os.cpus().length - 1); // Use most CPU cores, leave one free

// Event signatures
const DISTRIBUTED_SIG = 'Distributed(bytes,uint64,address,uint256)';
const BOOSTER_PROCESSED_SIG = 'BGTBoosterIncentivesProcessed(bytes,address,uint256,uint256)';

// Minimal ERC20 ABI fragments
const ERC20_DECIMALS_ABI = [ 'function decimals() view returns (uint8)' ];
const ERC20_NAME_ABI = [ 'function name() view returns (string)' ];

// Caches
const tokenDecimalsCache = new Map(); // token -> decimals
const tokenUsdRateCache = new Map(); // token -> usd per 1 token (number)
const tokenNameCache = new Map(); // token -> name

// Utility functions

/**
* Converts various value types to BigInt safely
* @param {bigint|number|string} value - The value to convert
* @returns {bigint} The converted BigInt value
* @throws {Error} If the value type is unsupported
*/
function bn(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.floor(value)); // Floor to avoid decimals
    if (typeof value === 'string') return BigInt(value);
    throw new Error('Unsupported bigint conversion');
}

/**
* Formats a BigInt amount with decimal places (like ethers.formatUnits)
* @param {bigint} amountBI - The BigInt amount in wei/smallest unit
* @param {number} decimals - Number of decimal places to format
* @returns {string} Formatted string representation
*/
function formatUnitsBI(amountBI, decimals) {
    const negative = amountBI < 0n;
    let x = negative ? -amountBI : amountBI; // Work with absolute value
    const base = 10n ** BigInt(decimals); // Calculate divisor (10^decimals)
    const integer = x / base; // Integer part
    const fraction = x % base; // Fractional part
    // Format fraction with leading zeros, then remove trailing zeros
    const fracStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return (negative ? '-' : '') + integer.toString() + (fracStr.length ? '.' + fracStr : '');
}

/**
* Logs a message to stderr (useful for progress/debug info that shouldn't interfere with stdout)
* @param {string} message - The message to log
*/
function log(message) {
    console.error(message);
}

/**
* Displays a progress bar in the terminal
* @param {number} current - Current progress value
* @param {number} total - Total/max progress value
* @param {string} description - Optional description to show with the progress bar
*/
function logProgress(current, total, description = '') {
    const percent = Math.round((current / total) * 100);
    // Create visual progress bar: █ for completed, ░ for remaining (50 chars total)
    const bar = '█'.repeat(Math.floor(percent / 2)) + '░'.repeat(50 - Math.floor(percent / 2));
    process.stderr.write(`\r${description} [${bar}] ${percent}% (${current}/${total})`);
    if (current === total) process.stderr.write('\n'); // New line when complete
}

/**
* Retries an async operation with exponential backoff
* @param {Function} operation - Async function to retry
* @param {number} maxRetries - Maximum number of retry attempts (default: 3)
* @param {number} initialDelay - Initial delay in ms (default: 1000)
* @returns {Promise<any>} Result of the operation
* @throws {Error} Last error if all retries fail
*/
async function withRetry(operation, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            // Only retry network-related errors
            if (error.message.includes('Fetch failed') || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNRESET')) {
                if (attempt < maxRetries) {
                    log(`Attempt ${attempt} failed, retrying in ${delay/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                }
                continue;
            }
            // Non-network errors should not be retried
            throw error;
        }
    }
    throw lastError;
}

/**
* Progress bar utility class for displaying operation progress
*/
class ProgressBar {
    /**
    * Creates a new progress bar
    * @param {number} total - Total number of items to process
    * @param {string} description - Description to show with the progress bar
    */
    constructor(total, description = '') {
        this.total = total;
        this.current = 0;
        this.description = description;
    }
    
    /**
    * Updates the progress bar to a specific value
    * @param {number} value - Current progress value
    */
    update(value) {
        this.current = value;
        logProgress(this.current, this.total, this.description);
    }
    
    /**
    * Finalizes the progress bar, ensuring it shows 100% completion
    */
    finish() {
        if (this.current < this.total) {
            this.update(this.total); // Complete the progress bar
        } else if (this.current === this.total) {
            // Just ensure we have a newline at the end for clean terminal output
            process.stderr.write('\n');
        }
    }
}

/**
* Factory function to create a new progress bar
* @param {number} total - Total number of items to process
* @param {string} description - Description to show with the progress bar
* @returns {ProgressBar} New progress bar instance
*/
function createProgressBar(total, description = '') {
    return new ProgressBar(total, description);
}

// Scoring/calculation functions

/**
* Calculates uptime score based on empty block percentage
* Perfect uptime (no empty blocks) = 100%, more empty blocks = lower score
* @param {number} emptyBlocks - Number of empty blocks produced
* @param {number} totalBlocks - Total number of blocks produced
* @returns {number} Uptime score (0-100)
*/
function calculateUptimeScore(emptyBlocks, totalBlocks) {
    const emptyBlockPercentage = calculateEmptyBlockPercentage(emptyBlocks, totalBlocks);
    return Math.max(0, 100 - emptyBlockPercentage); // Invert percentage: fewer empty blocks = higher score
}

/**
* Calculates the percentage of empty blocks
* @param {number} emptyBlocks - Number of empty blocks
* @param {number} totalBlocks - Total number of blocks
* @returns {number} Percentage of empty blocks (0-100)
*/
function calculateEmptyBlockPercentage(emptyBlocks, totalBlocks) {
    return totalBlocks > 0 ? (emptyBlocks / totalBlocks) * 100 : 0;
}

/**
* Calculates the POL (Proof of Liquidity) ratio: boost/stake
* Higher ratio indicates more BGT boost relative to validator stake
* @param {number} boost - BGT boost amount
* @param {number} stake - Validator stake amount
* @returns {number} POL ratio (boost/stake), 0 if stake is 0
*/
function calculatePolRatio(boost, stake) {
    return stake === 0 ? 0 : boost / stake;
}

// RPC helper functions


/**
* Gets the decimal places for an ERC20 token (cached)
* @param {ethers.Provider} provider - Ethers provider instance
* @param {string} token - Token contract address
* @returns {Promise<number>} Number of decimal places (defaults to 18 if unknown)
*/
async function getTokenDecimals(provider, token) {
    if (tokenDecimalsCache.has(token)) return tokenDecimalsCache.get(token);
    try {
        const iface = new ethers.Interface(ERC20_DECIMALS_ABI);
        const data = iface.encodeFunctionData('decimals', []);
        const res = await provider.call({ to: token, data });
        const [dec] = iface.decodeFunctionResult('decimals', res);
        tokenDecimalsCache.set(token, dec);
        return dec;
    } catch (e) {
        // Default to 18 decimals if the call fails (standard for most tokens)
        tokenDecimalsCache.set(token, 18);
        return 18;
    }
}

/**
* Gets the name of an ERC20 token (cached)
* @param {ethers.Provider} provider - Ethers provider instance
* @param {string} token - Token contract address
* @returns {Promise<string>} Token name (or truncated address if unknown)
*/
async function getTokenName(provider, token) {
    if (tokenNameCache.has(token)) return tokenNameCache.get(token);
    try {
        const iface = new ethers.Interface(ERC20_NAME_ABI);
        const data = iface.encodeFunctionData('name', []);
        const res = await provider.call({ to: token, data });
        const [name] = iface.decodeFunctionResult('name', res);
        tokenNameCache.set(token, name);
        return name;
    } catch (e) {
        // Use truncated address as fallback if name() call fails
        const fallbackName = token.substring(0, 8) + '...';
        tokenNameCache.set(token, fallbackName);
        return fallbackName;
    }
}

/**
* Gets the USD exchange rate for a token using Kyberswap API (cached)
* @param {string} tokenIn - Token contract address to get rate for
* @returns {Promise<number>} USD rate per token
* @throws {Error} If API call fails
*/
async function getUsdRatePerToken(tokenIn) {
    if (tokenUsdRateCache.has(tokenIn)) {
        log(`Using cached rate for ${tokenIn}: $${tokenUsdRateCache.get(tokenIn).toFixed(8)}`);
        return tokenUsdRateCache.get(tokenIn);
    }
    
    // Special case: HONEY token has 1:1 USD peg by design
    if (tokenIn.toLowerCase() === HONEY_TOKEN.toLowerCase()) {
        log(`Token ${tokenIn} is HONEY, using 1:1 exchange rate`);
        tokenUsdRateCache.set(tokenIn, 1.0);
        return 1.0;
    }
    
    // Special case: BGT can be burnt 1:1 for BERA, and BERA can be wrapped to WBERA
    // Use WBERA address for pricing since BGT doesn't have direct liquidity pools
    const WBERA_ADDRESS = '0x6969696969696969696969696969696969696969';
    const actualTokenIn = (tokenIn.toLowerCase() === BGT_CONTRACT.toLowerCase()) ? WBERA_ADDRESS : tokenIn;
    
    // Simulate swapping 1 unit of the token to get USD value
    const decimals = tokenDecimalsCache.get(tokenIn) ?? 18;
    const amountIn = 10n ** BigInt(decimals); // 1 token in wei
    const params = new URLSearchParams({
        tokenIn: actualTokenIn,
        tokenOut: HONEY_TOKEN.toLowerCase(), // Price against HONEY (USD-pegged)
        amountIn: amountIn.toString(),
        slippageTolerance: '0.005' // 0.5% slippage tolerance
    });
    const url = `${KYBER_ROUTE_URL}?${params.toString()}`;
    
    const resp = await fetch(url);
    
    if (!resp.ok) {
        const errorText = await resp.text();
        // Handle "route not found" errors by defaulting to 1.0 USD per token
        if (resp.status === 400 && errorText.includes('route not found')) {
            log(`Route not found for token ${tokenIn}, defaulting to $1.0 per token`);
            tokenUsdRateCache.set(tokenIn, 1.0);
            return 1.0;
        }
        throw new Error(`Kyber route fetch failed: ${resp.status} - ${errorText}`);
    }
    
    const data = await resp.json();
    
    // Extract USD value from API response (handles BigInt values safely)
    const amountOutUsd = parseFloat(data?.data?.routeSummary?.amountOutUsd || 0);
    const rate = amountOutUsd; // Direct rate since we used 1 token
    tokenUsdRateCache.set(tokenIn, rate);
    return rate;
}

/**
* Gets the proposer address for a specific block height from consensus layer
* @param {number} blockHeight - Block height to query
* @returns {Promise<string>} Proposer address
* @throws {Error} If block not found or no proposer
*/
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


/**
* Gets validator voting power data from consensus layer at a specific block height
* @param {number} blockHeight - Block height to query validator set
* @returns {Promise<Object|null>} Validator data object or null if no validators found
* @returns {Object} validators - Map of validator address to {address, voting_power, pub_key}
*/
async function getValidatorVotingPower(blockHeight) {
    return withRetry(async () => {
        const validators = {};
        let page = 1;
        const perPage = 100; // Reasonable page size for API pagination
        
        // Paginate through all validators
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
                break; // No more validators to fetch
            }
            
            // Process each validator in this page
        data.result.validators.forEach(validator => {
            validators[validator.address] = {
                address: validator.address,
                voting_power: validator.voting_power / 1e9, // Convert GWEI to BERA
                pub_key: validator.pub_key.value
            };
        });
        
            // Check if we've reached the end of results
        if (data.result.validators.length < perPage) {
                break; // Last page
        }
        
            page++; // Continue to next page
    }
    
    if (Object.keys(validators).length === 0) {
        log(`No validators found for block ${blockHeight}`);
        return null;
    }
    
    if (process.env.VERBOSE) {
        log(`Total validators found: ${Object.keys(validators).length}`);
    }
        
        return validators;
    });
}

/**
* Gets the BGT boost amount for a validator at a specific block
* @param {string} validatorPubkey - Validator public key (without 0x prefix)
* @param {number} blockNumber - Block number to query
* @returns {Promise<number>} BGT boost amount (0 if none or error)
*/
async function getValidatorBoost(validatorPubkey, blockNumber) {
    try {
        const result = await callContractFunction(
            BGT_CONTRACT,
            "boostees(bytes)", // BGT contract function to get boost amount
            [`0x${validatorPubkey}`], // Add 0x prefix to pubkey
            blockNumber
        );
        
        if (result && result !== '0x') {
            const rawValue = parseInt(result, 16); // Parse hex result
            return rawValue / 1e18; // Convert wei to BGT (18 decimals)
        }
        return 0;
    } catch (error) {
        log(`Error getting boost for validator ${validatorPubkey}: ${error.message}`);
        return 0; // Return 0 on error rather than throwing
    }
}

/**
* Calls a smart contract function using the cast CLI tool
* @param {string} contractAddress - Contract address to call
* @param {string} functionSignature - Function signature (e.g., "balanceOf(address)")
* @param {Array<string>} params - Function parameters
* @param {string|number} blockNumber - Block number to query (default: 'latest')
* @returns {Promise<string>} Raw contract call result
*/
async function callContractFunction(contractAddress, functionSignature, params, blockNumber = 'latest') {
    return withRetry(async () => {
        const { execSync } = await import('child_process');
        // Use foundry's cast tool for reliable contract calls
        const output = execSync(`cast call --rpc-url ${EL_ETHRPC_URL} --block ${blockNumber} ${contractAddress} "${functionSignature}" ${params.join(' ')}`, { encoding: 'utf8' });
        return output.trim();
    });
}

// Data loading and processing functions

/**
* Loads validator information from genesis_validators.csv file
* @returns {Array<Object>} Array of validator objects with name, proposer, pubkey, operatorAddress
* @throws {Error} If CSV file cannot be read or parsed
*/
function loadValidators() {
    const csvContent = fs.readFileSync('genesis_validators.csv', 'utf8');
    const lines = csvContent.split('\n');
    const validators = [];
    
    // Skip header row (i=1)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
            const [cometAddress, name, pubkey, operatorAddress] = line.split(',');
            validators.push({
                name,
                proposer: cometAddress, // Consensus layer address
                pubkey: pubkey.startsWith('0x') ? pubkey.substring(2) : pubkey, // Remove 0x prefix if present
                operatorAddress // Execution layer address
            });
        }
    }
    
    return validators;
}

/**
* Collects stake, boost, and POL ratio data for a single validator at a specific block
* @param {Object} validator - Validator object with proposer address and pubkey
* @param {number} blockNumber - Block number to query data at
* @param {Object} votingPowerData - Pre-fetched voting power data from consensus layer
* @returns {Promise<Object>} Object with stake, boost, and ratio properties
*/
async function collectValidatorData(validator, blockNumber, votingPowerData) {
    try {
        // First try exact address match for stake data
        let stakeBalance = votingPowerData?.[validator.proposer]?.voting_power || 0;
        
        // If no exact match, try case-insensitive search (addresses can have different casing)
        if (stakeBalance === 0 && votingPowerData) {
            const lowerProposer = validator.proposer.toLowerCase();
            const foundByLower = Object.keys(votingPowerData).find(addr => addr.toLowerCase() === lowerProposer);
            if (foundByLower) {
                stakeBalance = votingPowerData[foundByLower].voting_power;
            }
        }
        
        // Get BGT boost amount from smart contract
        const boostBalance = await getValidatorBoost(validator.pubkey, blockNumber);
        
        // Calculate POL ratio (boost/stake)
        const ratio = calculatePolRatio(boostBalance, stakeBalance);
        
        return {
            stake: stakeBalance,
            boost: boostBalance,
            ratio: ratio
        };
    } catch (error) {
        log(`Error collecting data for ${validator.name}: ${error.message}`);
        // Return zero values on error to avoid breaking the analysis
        return {
            stake: 0,
            boost: 0,
            ratio: 0
        };
    }
}

// Block scanning functions

/**
* Scans a chunk of blocks to identify proposers and empty blocks
* @param {number} chunkStart - Starting block number (inclusive)
* @param {number} chunkEnd - Ending block number (inclusive)
* @param {Array<Object>} validators - Array of validator objects (unused but kept for consistency)
* @param {Map} validatorMap - Map of proposer addresses to validator objects for fast lookup
* @returns {Promise<Map>} Map of proposer -> {blocks: [], emptyBlockNumbers: []}
*/
async function scanBlockChunk(chunkStart, chunkEnd, validators, validatorMap) {
    const provider = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    const chunkResults = new Map();
    
    // Scan each block in the chunk
    for (let blockNum = chunkStart; blockNum <= chunkEnd; blockNum++) {
        try {
            // Get the proposer of this block from consensus layer
            const proposer = await getBlockProposer(blockNum);
            
            // Only process blocks from validators we're tracking
            if (validatorMap.has(proposer)) {
                // Get block data from execution layer to check if empty
                const block = await provider.getBlock(blockNum);
                const isEmpty = !block.transactions || block.transactions.length <= EMPTY_BLOCK_THRESHOLD;
                
                // Initialize proposer data if first time seeing them
                if (!chunkResults.has(proposer)) {
                    chunkResults.set(proposer, { blocks: [], emptyBlockNumbers: [] });
                }
                
                // Record this block for the proposer
                chunkResults.get(proposer).blocks.push(blockNum);
                if (isEmpty) {
                    chunkResults.get(proposer).emptyBlockNumbers.push(blockNum);
                }
            }
        } catch (error) {
            log(`Error at block ${blockNum}: ${error.message}`);
            // Continue processing other blocks even if one fails
        }
    }
    
    return chunkResults;
}

/**
* Scans a range of blocks in parallel using multiple workers
* Divides the work into chunks and processes them concurrently for better performance
* @param {number} startBlock - Starting block number (inclusive)
* @param {number} endBlock - Ending block number (inclusive)
* @param {Array<Object>} validators - Array of validator objects
* @param {Map} validatorMap - Map of proposer addresses to validator objects
* @param {boolean} showProgress - Whether to show progress bar (default: true)
* @returns {Promise<Map>} Merged results from all chunks
*/
async function scanBlocksParallel(startBlock, endBlock, validators, validatorMap, showProgress = true) {
    const totalChunks = Math.ceil((endBlock - startBlock + 1) / CHUNK_SIZE);
    const progress = showProgress ? createProgressBar(totalChunks, 'Scanning block chunks') : null;
    
    // Divide the block range into chunks
    const chunks = [];
    for (let chunkStart = startBlock; chunkStart <= endBlock; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, endBlock);
        chunks.push({ chunkStart, chunkEnd });
    }
    
    const results = [];
    const workerCount = MAX_WORKER_COUNT;
    
    // Process chunks in batches to avoid overwhelming the RPC endpoints
    for (let i = 0; i < chunks.length; i += workerCount) {
        const batch = chunks.slice(i, i + workerCount);
        const batchPromises = batch.map(chunk => 
            scanBlockChunk(chunk.chunkStart, chunk.chunkEnd, validators, validatorMap)
        );
        
        // Wait for all chunks in this batch to complete
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Update progress bar
        if (progress) {
            progress.update(Math.min(i + workerCount, chunks.length));
        }
    }
    
    if (progress) {
        progress.finish();
    }
    
    // Merge results from all chunks
    const mergedResults = new Map();
    results.forEach(chunkResult => {
        chunkResult.forEach((data, proposer) => {
            if (!mergedResults.has(proposer)) {
                mergedResults.set(proposer, { blocks: [], emptyBlockNumbers: [] });
            }
            // Combine block lists from different chunks
            mergedResults.get(proposer).blocks.push(...data.blocks);
            if (data.emptyBlockNumbers && Array.isArray(data.emptyBlockNumbers)) {
                mergedResults.get(proposer).emptyBlockNumbers.push(...data.emptyBlockNumbers);
            }
        });
    });
    
    return mergedResults;
}


/**
* Builds a set of pubkey topics and mapping for efficient event filtering
* Creates keccak256 hashes of validator pubkeys for use in event log filtering
* @param {Array<Object>} validators - Array of validator objects with pubkey property
* @returns {Object} Object with set of topics and mapping from topic to proposer
* @returns {Set} set - Set of keccak256 hashed pubkeys for filtering
* @returns {Map} topicToProposer - Map from topic hash to proposer address
*/
function buildPubkeyTopicSet(validators) {
    const set = new Set();
    const topicToProposer = new Map();
    
    for (const v of validators) {
        // Ensure pubkey has 0x prefix for consistent hashing
        const pk = v.pubkey.startsWith('0x') ? v.pubkey : `0x${v.pubkey}`;
        const topic = ethers.keccak256(pk); // Hash pubkey for event filtering
        set.add(topic.toLowerCase()); // Normalize to lowercase
        topicToProposer.set(topic.toLowerCase(), v.proposer); // Map hash back to proposer address
    }
    
    return { set, topicToProposer };
}

/**
 * Indexes POL (Proof of Liquidity) events from the blockchain for validator incentives
 * 
 * This function builds a comprehensive map of validator incentive earnings by scanning
 * blockchain events across specified day ranges. It compiles two types of POL events:
 * 1. Distributed events: BGT emissions from the protocol to validator vaults
 * 2. BGTBoosterIncentivesProcessed events: Booster token incentives from validators to users
 * 
 * The function processes events in chunks to prevent memory issues, then aggregates
 * all token amounts (stored as BigInt for precision) by validator and date.
 * 
 * @param {Array<Object>} validators - Array of validator objects with pubkey for filtering
 * @param {Object} dayRanges - Object mapping dates to {startBlock, endBlock} ranges
 * @returns {Promise<Object>} Object with compiled daily aggregated data
 * @returns {Object} daily - Structure: date -> proposer -> {vaultBgtBI: BigInt, boosters: {token: BigInt}}
 *   - vaultBgtBI: Total BGT emissions to validator vaults (in wei)
 *   - boosters: Map of token addresses to BigInt amounts of booster incentives
 */
async function indexPolEvents(validators, dayRanges) {
    const provider = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    const iface = new ethers.Interface([
        'event Distributed(bytes indexed valPubkey, uint64 indexed nextTimestamp, address indexed receiver, uint256 amount)',
        'event BGTBoosterIncentivesProcessed(bytes indexed pubkey, address indexed token, uint256 bgtEmitted, uint256 amount)'
    ]);
    const distributedTopic0 = ethers.id(DISTRIBUTED_SIG);
    const boosterTopic0 = ethers.id(BOOSTER_PROCESSED_SIG);
    
    const { set: pubTopicSet, topicToProposer } = buildPubkeyTopicSet(validators);
    const daily = {}; // date -> proposer -> { vaultBgtBI: bigint, boosters: { token: bigint } }
    
    /**
     * Helper function to fetch event logs in parallel batches for better performance
     * 
     * This function builds a complete log collection by breaking large block ranges
     * into manageable chunks and processing them in controlled parallel batches. It compiles logs by:
     * 1. Dividing the block range into chunks of ~5000 blocks each
     * 2. Processing chunks in parallel batches to balance speed and memory usage
     * 3. Concatenating all chunk results into a single comprehensive log array
     * 
     * The batched parallel approach provides better performance than sequential while
     * preventing memory issues by limiting concurrent requests.
     * 
     * @param {number} fromBlock - Starting block number (inclusive)
     * @param {number} toBlock - Ending block number (inclusive)
     * @param {Object} filter - Ethers log filter object with topics and addresses
     * @param {number} chunkSize - Size of each chunk in blocks (default: 3000)
     * @param {number} batchSize - Number of chunks to process in parallel (default: 4)
     * @returns {Promise<Array>} Compiled array of all log entries from the range
     */
    async function processLogsChunked(fromBlock, toBlock, filter, eventType, chunkSize = LOG_CHUNK_SIZE, batchSize = LOG_BATCH_SIZE) {
        const totalBlocks = toBlock - fromBlock + 1;
        
        // Create chunk ranges
        const chunks = [];
        let currentBlock = fromBlock;
        
        while (currentBlock <= toBlock) {
            const chunkEnd = Math.min(currentBlock + chunkSize - 1, toBlock);
            chunks.push({ start: currentBlock, end: chunkEnd });
            currentBlock = chunkEnd + 1;
        }
        
        // Process ALL chunks in parallel with controlled concurrency
        log(`Processing ${chunks.length} chunks for ${eventType} events with max ${batchSize} concurrent requests...`);
        
        const semaphore = {
            count: batchSize,
            waiters: [],
            async acquire() {
                if (this.count > 0) {
                    this.count--;
                    return;
                }
                return new Promise(resolve => this.waiters.push(resolve));
            },
            release() {
                if (this.waiters.length > 0) {
                    const resolve = this.waiters.shift();
                    resolve();
                } else {
                    this.count++;
                }
            }
        };
        
        const allPromises = chunks.map(async (chunk, index) => {
            await semaphore.acquire();
            try {
                const chunkLogs = await provider.getLogs({
                    ...filter,
                    fromBlock: chunk.start,
                    toBlock: chunk.end
                });
                
                // Process logs immediately in this worker to avoid memory accumulation
                let processedCount = 0;
                for (const log of chunkLogs) {
                    const topicPub = (log.topics?.[1] || '').toLowerCase();
                    if (!pubTopicSet.has(topicPub)) continue;
                    
                    const proposer = topicToProposer.get(topicPub);
                    const date = getDateForBlock(log.blockNumber);
                    if (!date) continue;
                    
                    const parsed = iface.parseLog(log);
                    
                    // Initialize proposer data if needed
                    if (!daily[date][proposer]) daily[date][proposer] = { vaultBgtBI: 0n, boosters: {} };
                    
                    if (eventType === 'Distributed') {
                        const amount = BigInt(parsed.args.amount.toString());
                        daily[date][proposer].vaultBgtBI += amount;
                    } else if (eventType === 'BGTBoosterIncentivesProcessed') {
                        const token = parsed.args.token.toLowerCase();
                        const amount = BigInt(parsed.args.amount.toString());
                        daily[date][proposer].boosters[token] = (daily[date][proposer].boosters[token] || 0n) + amount;
                    }
                    processedCount++;
                }
                
                return processedCount;
            } catch (e) {
                log(`Error processing ${eventType} logs for chunk ${index + 1}/${chunks.length} (blocks ${chunk.start}-${chunk.end}): ${e.message}`);
                return 0;
            } finally {
                semaphore.release();
            }
        });
        
        // Wait for ALL chunks to complete
        const processedCounts = await Promise.all(allPromises);
        const totalProcessed = processedCounts.reduce((sum, count) => sum + count, 0);
        log(`Processed ${totalProcessed} ${eventType} events from ${chunks.length} chunks`);
        
        return totalProcessed;
    }
    
    // Initialize daily structure for all dates
    for (const date of Object.keys(dayRanges)) {
        daily[date] = {};
    }
    
    // Calculate overall block range across all days
    const allRanges = Object.values(dayRanges);
    const overallStartBlock = Math.min(...allRanges.map(r => r.startBlock));
    const overallEndBlock = Math.max(...allRanges.map(r => r.endBlock));
    const totalBlocks = overallEndBlock - overallStartBlock + 1;
    
    log(`Indexing POL events for all ${Object.keys(dayRanges).length} days (${totalBlocks} total blocks in parallel batches of ${LOG_BATCH_SIZE}x${LOG_CHUNK_SIZE})...`);
    
    // Helper function to determine which date a block belongs to
    function getDateForBlock(blockNumber) {
        for (const [date, range] of Object.entries(dayRanges)) {
            if (blockNumber >= range.startBlock && blockNumber <= range.endBlock) {
                return date;
            }
        }
        return null;
    }
    
    // Process both event types with memory-efficient parallel processing
    try {
        // Process Distributed events from the specific distributor address
        await processLogsChunked(overallStartBlock, overallEndBlock, {
            address: DISTRIBUTOR_ADDRESS,
            topics: [distributedTopic0]
        }, 'Distributed');
    } catch (e) {
        log(`Error processing Distributed events: ${e.message}`);
    }
    
    try {
        // Process BGTBoosterIncentivesProcessed events from any address
        await processLogsChunked(overallStartBlock, overallEndBlock, {
            topics: [boosterTopic0]
        }, 'BGTBoosterIncentivesProcessed');
    } catch (e) {
        log(`Error processing BGTBoosterIncentivesProcessed events: ${e.message}`);
    }
    
    
    return { daily };
}

/**
 * Computes USD valuations for all validator incentive earnings
 * 
 * This function builds USD-denominated valuations by taking the raw BigInt token amounts
 * from POL events and converting them to USD values. It compiles the conversion process:
 * 1. Discovers all unique tokens from the daily aggregated data
 * 2. Fetches token metadata (decimals, names) from smart contracts
 * 3. Retrieves real-time USD exchange rates from Kyberswap API
 * 4. Performs BigInt arithmetic to convert token amounts to USD values
 * 
 * The function uses BigInt math throughout to maintain precision, only converting
 * to regular numbers at the final step for USD display values.
 * 
 * @param {Object} dailyAgg - Daily aggregated POL data from indexPolEvents
 * @param {Array<Object>} validators - Array of validator objects (for reference)
 * @param {Object} dayRanges - Day ranges being analyzed (for iteration)
 * @returns {Promise<Object>} Object with compiled USD valuations and token rates
 * @returns {Object} dailyUsd - Structure: date -> proposer -> {vaultsUSD, boostersUSD, totalUSD}
 *   - vaultsUSD: USD value of BGT vault emissions
 *   - boostersUSD: USD value of booster token incentives
 *   - totalUSD: Combined USD value
 * @returns {Object} perTokenRates - Map of token addresses to USD exchange rates
 */
async function computeUsdValuations(dailyAgg, validators, dayRanges) {
    const provider = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    // collect tokens
    const tokenSet = new Set();
    tokenSet.add(BGT_CONTRACT.toLowerCase());
    for (const date of Object.keys(dayRanges)) {
        const perDate = dailyAgg[date] || {};
        for (const proposer of Object.keys(perDate)) {
            const boosters = perDate[proposer]?.boosters || {};
            Object.keys(boosters).forEach(t => tokenSet.add(t));
        }
    }
    
    // fetch decimals, names, and rates
    log(`Fetching decimals for ${tokenSet.size} unique tokens...`);
    for (const token of tokenSet) {
        await getTokenDecimals(provider, token);
    }
    
    log(`Fetching names for ${tokenSet.size} unique tokens...`);
    for (const token of tokenSet) {
        await getTokenName(provider, token);
    }
    
    log(`Fetching USD rates for ${tokenSet.size} unique tokens...`);
    let tokenCount = 0;
    for (const token of tokenSet) {
        tokenCount++;
        const tokenName = tokenNameCache.get(token) || token.substring(0, 8) + '...';
        log(`Fetching rate for token ${tokenCount}/${tokenSet.size}: ${tokenName} (${token})`);
        await getUsdRatePerToken(token);
        // Add small delay between API calls to be respectful to the API
        if (tokenCount < tokenSet.size) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    const bgtDecimals = tokenDecimalsCache.get(BGT_CONTRACT.toLowerCase()) ?? 18;
    const bgtRate = tokenUsdRateCache.get(BGT_CONTRACT.toLowerCase()) ?? 0;
    
    const perTokenRates = {};
    for (const token of tokenSet) perTokenRates[token] = tokenUsdRateCache.get(token) ?? 0;
    
    // compute per day per validator USD using BigInt math
    const dailyUsd = {}; // date -> proposer -> { vaultsUSD, boostersUSD, totalUSD }
    for (const [date, perDate] of Object.entries(dailyAgg)) {
        dailyUsd[date] = {};
        for (const [proposer, data] of Object.entries(perDate)) {
            const vaultBgtBI = data.vaultBgtBI || 0n;
            const boosters = data.boosters || {};
            
            // Calculate vault USD using BigInt math
            // vaultBgtBI is in wei, we need to multiply by rate and divide by 1e18
            const bgtRateBI = BigInt(Math.floor(bgtRate * 1e18)); // Convert rate to wei precision
            const vaultsUSDWei = (vaultBgtBI * bgtRateBI) / (10n ** BigInt(bgtDecimals));
            const vaultsUSD = parseFloat(vaultsUSDWei.toString()) / 1e18; // Convert back to USD
            
            let boostersUSD = 0;
            for (const [token, amountBI] of Object.entries(boosters)) {
                const dec = tokenDecimalsCache.get(token) ?? 18;
                const rate = perTokenRates[token] ?? 0;
                const rateBI = BigInt(Math.floor(rate * 1e18)); // Convert rate to wei precision
                const tokenUSDWei = (amountBI * rateBI) / (10n ** BigInt(dec));
                boostersUSD += parseFloat(tokenUSDWei.toString()) / 1e18; // Convert back to USD
            }
            dailyUsd[date][proposer] = { vaultsUSD, boostersUSD, totalUSD: vaultsUSD + boostersUSD };
        }
    }
    return { dailyUsd, perTokenRates };
}

// Command line arguments
const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');

// Show help if requested
if (showHelp) {
    console.log(`
Validator POL Performance Study
        
Usage:
  node validator-scoring.js [options]
        
  Options:
    --days=N          Number of days to analyze (default: 45)
    --end-date=DATE   End date for analysis in YYYY-MM-DD format (default: yesterday)
    --help, -h        Show this help message
         
  Examples:
    node score-validators.js --days=1                         # Quick test: analyze yesterday only
    node score-validators.js --days=7                         # Analyze last 7 days ending yesterday
    node score-validators.js --days=7 --end-date=2025-01-25   # Analyze 7 days ending on Jan 25, 2025
    node score-validators.js --end-date=2025-01-20            # Analyze 45 days ending on Jan 20, 2025
    node score-validators.js                                  # Full analysis: last 45 days (default)
        
Environment Variables:
  EL_ETHRPC_URL     Execution layer RPC endpoint
  CL_ETHRPC_URL     Consensus layer RPC endpoint
  VERBOSE           Set to 'true' for verbose logs and detailed CSV output
        
Memory Requirements:
  For large day ranges, consider running with increased memory:
  node --max-old-space-size=8192 validator-scoring.js --days=45
`);
        process.exit(0);
    }
    
    const showFullDetail = process.env.VERBOSE === 'true' || process.env.VERBOSE === '1';
    
    
    
    
    /**
     * Finds exact block numbers for day boundaries (midnight UTC)
     * 
     * This function builds a mapping of dates to their corresponding block numbers by
     * performing binary search against block timestamps. It compiles precise boundaries by:
     * 1. Estimating initial block numbers using genesis timestamp and block time
     * 2. Iteratively adjusting block candidates based on timestamp differences
     * 3. Finding the exact block where timestamp transitions from previous day to target day
     * 
     * The compilation process ensures each date maps to the first block of that UTC day,
     * which is essential for accurate daily analysis ranges.
     * 
     * @param {Array<Date>} dates - Array of Date objects to find boundaries for
     * @returns {Promise<Object>} Compiled mapping of date strings to block numbers
     * @returns {Object} boundaries - Structure: "YYYY-MM-DD" -> blockNumber
     */
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
        log(`Guessed ${numGuesses} times to find ${Object.keys(boundaries).length} boundary blocks`);
        return boundaries;
    }
    
    
    
    /**
     * Collects stake and boost data for all validators at day boundary blocks
     * 
     * This function builds a comprehensive dataset of validator financial positions by
     * compiling stake and boost amounts at specific points in time. It constructs the data by:
     * 1. Querying consensus layer for voting power (stake) data at each day boundary
     * 2. Calling BGT smart contract to get boost amounts for each validator
     * 3. Calculating POL ratios (boost/stake) for scoring purposes
     * 4. Aggregating all data into a structured format for daily analysis
     * 
     * The compilation process handles address matching (case-insensitive) and provides
     * fallback values to ensure complete datasets even when some queries fail.
     * 
     * @param {Array<Object>} validators - Array of validator objects with proposer addresses
     * @param {Object} dayBoundaries - Mapping of date strings to block numbers
     * @returns {Promise<Object>} Compiled stake and boost data structure
     * @returns {Object} stakeBoostData - Structure: date -> proposer -> {stake, boost, ratio}
     *   - stake: Validator stake amount in BERA
     *   - boost: BGT boost amount
     *   - ratio: Calculated POL ratio (boost/stake)
     */
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

    /**
     * Calculates comprehensive daily statistics and 4-dimensional scores for all validators
     * 
     * This function builds the core scoring dataset by compiling multiple data sources
     * into normalized performance metrics. It constructs the statistics by:
     * 1. Processing block results to calculate uptime metrics (empty blocks vs total blocks)
     * 2. Extracting POL ratios from stake/boost data for POL scoring
     * 3. Computing economic values from USD data for BGT vault and booster scoring
     * 4. Normalizing each metric against daily maximums to create 0-100% scores
     * 5. Aggregating all metrics into comprehensive daily statistics per validator
     * 
     * The compilation process ensures fair comparison by normalizing each score type
     * against the best performer for that metric on that day.
     * 
     * @param {Map} blockResults - Block scanning results: proposer -> {blocks, emptyBlockNumbers}
     * @param {Object} stakeBoostData - Stake and boost data: date -> proposer -> {stake, boost, ratio}
     * @param {Object} dayBoundaries - Day boundary blocks: date -> blockNumber
     * @param {Array<Object>} validators - Array of validator objects for complete coverage
     * @returns {Object} Compiled daily statistics structure
     * @returns {Object} statistics - Structure: date -> proposer -> {all scores and metrics}
     *   - uptimeScore, polScore, stakeScaledBgtScore, stakeScaledBoosterScore (0-100%)
     *   - totalBlocks, emptyBlocks, stake, boost, economic values
     */
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
            
            // Get economic data for this day
            const dayUsd = global.__DAILY_USD__?.[date] || {};
            
            // Calculate max stake-scaled BGT vault returns for normalization
            // IMPORTANT: Consider ALL validators, not just those with economic data
            const dayStakeScaledBgtReturns = validators.map(validator => {
                const stake = stakeBoostData[date]?.[validator.proposer]?.stake || 0;
                const bgtValue = dayUsd[validator.proposer]?.vaultsUSD || 0;
                return stake > 0 ? bgtValue / stake : 0;
            });
            const maxStakeScaledBgtReturns = Math.max(...dayStakeScaledBgtReturns, 0);
            
            // Calculate max stake-scaled booster incentive returns for normalization
            // IMPORTANT: Consider ALL validators, not just those with economic data
            const dayStakeScaledBoosterReturns = validators.map(validator => {
                const stake = stakeBoostData[date]?.[validator.proposer]?.stake || 0;
                const boosterValue = dayUsd[validator.proposer]?.boostersUSD || 0;
                return stake > 0 ? boosterValue / stake : 0;
            });
            const maxStakeScaledBoosterReturns = Math.max(...dayStakeScaledBoosterReturns, 0);
        
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
                
                // Stake-scaled BGT vault scoring
                const economicData = dayUsd[proposer] || { vaultsUSD: 0, boostersUSD: 0 };
                const stake = stakeBoostData[date]?.[proposer]?.stake || 0;
                const stakeScaledBgtValue = stake > 0 ? economicData.vaultsUSD / stake : 0;
                const stakeScaledBgtScore = maxStakeScaledBgtReturns > 0 ? (stakeScaledBgtValue / maxStakeScaledBgtReturns) * 100 : 0;
                
                // Stake-scaled booster incentive scoring
                const stakeScaledBoosterValue = stake > 0 ? economicData.boostersUSD / stake : 0;
                const stakeScaledBoosterScore = maxStakeScaledBoosterReturns > 0 ? (stakeScaledBoosterValue / maxStakeScaledBoosterReturns) * 100 : 0;
            
            statistics[date][proposer] = {
                totalBlocks,
                emptyBlocks: dayEmptyBlocks,
                emptyBlockPercentage,
                uptimeScore,
                polScore,
                    stakeScaledBgtScore,
                    stakeScaledBoosterScore,
                stake: stakeBoostData[date]?.[proposer]?.stake || 0,
                boost: stakeBoostData[date]?.[proposer]?.boost || 0,
                    polRatio,
                    vaultsUSD: economicData.vaultsUSD,
                    boostersUSD: economicData.boostersUSD,
                    stakeScaledBgtValue,
                    stakeScaledBoosterValue
            };
        }
        
        // Add validators that weren't found in blockResults (they had 0 blocks)
        for (const validator of validators) {
            if (!statistics[date][validator.proposer]) {
                const polRatio = stakeBoostData[date]?.[validator.proposer]?.ratio || 0;
                const polScore = maxRatio > 0 ? (polRatio / maxRatio) * 100 : 0;
                    
                    const economicData = dayUsd[validator.proposer] || { vaultsUSD: 0, boostersUSD: 0 };
                    const stake = stakeBoostData[date]?.[validator.proposer]?.stake || 0;
                    const stakeScaledBgtValue = stake > 0 ? economicData.vaultsUSD / stake : 0;
                    const stakeScaledBgtScore = maxStakeScaledBgtReturns > 0 ? (stakeScaledBgtValue / maxStakeScaledBgtReturns) * 100 : 0;
                    
                    const stakeScaledBoosterValue = stake > 0 ? economicData.boostersUSD / stake : 0;
                    const stakeScaledBoosterScore = maxStakeScaledBoosterReturns > 0 ? (stakeScaledBoosterValue / maxStakeScaledBoosterReturns) * 100 : 0;
                
                statistics[date][validator.proposer] = {
                    totalBlocks: 0,
                    emptyBlocks: 0,
                    emptyBlockPercentage: 0,
                    uptimeScore: 100, // Perfect uptime if no blocks
                    polScore,
                        stakeScaledBgtScore,
                        stakeScaledBoosterScore,
                    stake: stakeBoostData[date]?.[validator.proposer]?.stake || 0,
                    boost: stakeBoostData[date]?.[validator.proposer]?.boost || 0,
                        polRatio,
                        vaultsUSD: economicData.vaultsUSD,
                        boostersUSD: economicData.boostersUSD,
                        stakeScaledBgtValue,
                        stakeScaledBoosterValue
                };
            }
        }
    }
    
    return statistics;
}

    /**
     * Generates comprehensive validator performance reports with rankings and detailed output
     * 
     * This function builds the final performance analysis by compiling daily statistics
     * into averaged scores and comprehensive rankings. It constructs the report by:
     * 1. Averaging daily scores across the analysis period for each validator
     * 2. Calculating total scores using equal weighting of all 4 metrics
     * 3. Ranking validators by their total performance scores
     * 4. Generating formatted console output with aligned columns
     * 5. Creating detailed CSV output with optional daily breakdowns (VERBOSE mode)
     * 
     * The compilation process produces both human-readable console rankings and
     * machine-readable CSV data for further analysis or visualization.
     * 
     * @param {Object} statistics - Daily statistics from calculateStatistics
     * @param {Array<Object>} validators - Array of validator objects with metadata
     * @param {Object} dayBoundaries - Day boundary blocks for date processing
     * @returns {Array<Object>} Compiled validator rankings sorted by total score
     * @returns {Object} rankings - Array of validator objects with averaged scores:
     *   - name, addresses, pubkey, all averaged scores, stake, daily breakdowns
     */
function generateReport(statistics, validators, dayBoundaries) {
    const sortedDates = Object.keys(dayBoundaries).sort();
    const validatorMap = new Map(validators.map(v => [v.proposer, v]));
    
    // Calculate averages for each validator
    const validatorAverages = {};
    
    for (const validator of validators) {
        const uptimeScores = [];
        const polScores = [];
            const stakeScaledBgtScores = [];
            const stakeScaledBoosterScores = [];
        
        for (const date of sortedDates) {
            const dayStats = statistics[date]?.[validator.proposer];
            if (dayStats) {
                uptimeScores.push(dayStats.uptimeScore);
                polScores.push(dayStats.polScore);
                    stakeScaledBgtScores.push(dayStats.stakeScaledBgtScore);
                    stakeScaledBoosterScores.push(dayStats.stakeScaledBoosterScore);
            }
        }
        
        const avgUptimeScore = uptimeScores.length > 0 ? 
            uptimeScores.reduce((sum, score) => sum + score, 0) / uptimeScores.length : 0;
        const avgPolScore = polScores.length > 0 ? 
            polScores.reduce((sum, score) => sum + score, 0) / polScores.length : 0;
            const avgStakeScaledBgtScore = stakeScaledBgtScores.length > 0 ? 
            stakeScaledBgtScores.reduce((sum, score) => sum + score, 0) / stakeScaledBgtScores.length : 0;
            const avgStakeScaledBoosterScore = stakeScaledBoosterScores.length > 0 ? 
            stakeScaledBoosterScores.reduce((sum, score) => sum + score, 0) / stakeScaledBoosterScores.length : 0;
            
            // Equal weighting of all 4 metrics
            const totalScore = (avgUptimeScore + avgPolScore + avgStakeScaledBgtScore + avgStakeScaledBoosterScore) / 4;
        
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
                avgStakeScaledBgtScore,
                avgStakeScaledBoosterScore,
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
        log('='.repeat(140));
        log(
            'Rank'.padEnd(6) +
            'Validator'.padEnd(30) +
            'Total'.padEnd(8) +
            'Uptime'.padEnd(8) +
            'Boost/Stake'.padEnd(12) +
            'BGT→Vault/Stake'.padEnd(15) +
            'Incentive/Stake'.padEnd(16) +
        'Stake (BERA)'
    );
        log('-'.repeat(140));
    
    rankings.forEach((validator, index) => {
            const line = `${(index + 1).toString().padEnd(6)}${validator.name.padEnd(30)}${validator.totalScore.toFixed(2).padEnd(8)}${validator.avgUptimeScore.toFixed(2).padEnd(8)}${validator.avgPolScore.toFixed(2).padEnd(12)}${validator.avgStakeScaledBgtScore.toFixed(2).padEnd(15)}${validator.avgStakeScaledBoosterScore.toFixed(2).padEnd(16)}${validator.stake.toLocaleString()}`;
        log(line);
    });
        log('='.repeat(140));
    
    // CSV output
        let csvHeader = 'Validator name,Pubkey,Proposer,Operator,Stake,Uptime Score,Boost/Stake Ratio Score,BGT→Vault/Stake Score,Incentive→User/Stake Score,Total Score';
    
        if (showFullDetail) {
            // Only add columns for dates that were actually analyzed (exclude boundary date)
            const datesToAnalyze = sortedDates.slice(0, sortedDates.length - 1);
            
            // Group columns by data type across all days
            datesToAnalyze.forEach(date => csvHeader += `,${date} BGT boost`);
            datesToAnalyze.forEach(date => csvHeader += `,${date} stake`);
            datesToAnalyze.forEach(date => csvHeader += `,${date} empty blocks`);
            datesToAnalyze.forEach(date => csvHeader += `,${date} total blocks`);
            datesToAnalyze.forEach(date => csvHeader += `,${date} boost/stake ratio`);
            datesToAnalyze.forEach(date => csvHeader += `,${date} BGT→vault USD`);
            datesToAnalyze.forEach(date => csvHeader += `,${date} incentive→user USD`);
        }
    
    const csvRows = rankings.map(validator => {
            let row = `${validator.name},${validator.pubkey},${validator.validatorAddress},${validator.operatorAddress},${validator.stake.toFixed(6)},${validator.avgUptimeScore.toFixed(2)},${validator.avgPolScore.toFixed(2)},${validator.avgStakeScaledBgtScore.toFixed(2)},${validator.avgStakeScaledBoosterScore.toFixed(2)},${validator.totalScore.toFixed(2)}`;
        
            if (showFullDetail) {
                // Only include data for dates that were actually analyzed (exclude boundary date)
                const datesToAnalyze = sortedDates.slice(0, sortedDates.length - 1);
                
                // Group data by type across all days (matching header order)
                datesToAnalyze.forEach(date => {
                    const day = validator.days.find(d => d.date === date);
                    row += `,${(day?.boost || 0).toFixed(6)}`;
                });
                datesToAnalyze.forEach(date => {
                    const day = validator.days.find(d => d.date === date);
                    row += `,${(day?.stake || 0).toFixed(6)}`;
                });
                datesToAnalyze.forEach(date => {
                    const day = validator.days.find(d => d.date === date);
                    row += `,${day?.emptyBlocks || 0}`;
                });
                datesToAnalyze.forEach(date => {
                    const day = validator.days.find(d => d.date === date);
                    row += `,${day?.totalBlocks || 0}`;
                });
                datesToAnalyze.forEach(date => {
                    const day = validator.days.find(d => d.date === date);
                    row += `,${(day?.polRatio || 0).toFixed(6)}`;
                });
                datesToAnalyze.forEach(date => {
                    const dayUsd = global.__DAILY_USD__?.[date]?.[validator.validatorAddress] || {};
                    row += `,${(dayUsd.vaultsUSD || 0).toFixed(6)}`;
                });
                datesToAnalyze.forEach(date => {
                    const dayUsd = global.__DAILY_USD__?.[date]?.[validator.validatorAddress] || {};
                    row += `,${(dayUsd.boostersUSD || 0).toFixed(6)}`;
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

    /**
     * Generates incentive token distribution matrix showing validators vs tokens earned
     * 
     * This function builds a comprehensive matrix view by compiling token earnings
     * across all validators and time periods. It constructs the matrix by:
     * 1. Discovering all unique tokens from POL event data across all days
     * 2. Aggregating token amounts per validator using BigInt arithmetic for precision
     * 3. Converting BigInt amounts to human-readable token quantities
     * 4. Creating a matrix with validators as rows and tokens as columns
     * 5. Adding exchange rate headers and total columns/rows for comprehensive view
     * 
     * The compilation process produces a detailed CSV matrix that shows exactly
     * which validators earned which tokens and in what quantities, with USD rates
     * for easy economic interpretation.
     * 
     * @param {Object} statistics - Daily statistics (for validator iteration)
     * @param {Array<Object>} validators - Array of validator objects with metadata
     * @param {Object} dayBoundaries - Day boundaries for date processing
     * @param {Object} polDaily - Raw POL event data with BigInt token amounts
     * @param {Map} tokenNameCache - Cached token names for display
     * @returns {string} Compiled CSV filename that was written
     * @returns {File} validator_incentive_summary.csv - Matrix with:
     *   - Row 1: Token names and addresses as column headers
     *   - Row 2: USD exchange rates per token
     *   - Data rows: Token amounts earned by each validator
     *   - Totals: Row and column summation
     */
    function generateSummaryCSV(statistics, validators, dayBoundaries, polDaily, tokenNameCache) {
        const sortedDates = Object.keys(dayBoundaries).sort();
        const datesToAnalyze = sortedDates.slice(0, sortedDates.length - 1);
        
        // Collect all unique tokens across all days from POL events
        const allTokens = new Set();
        for (const date of datesToAnalyze) {
            const dayData = polDaily[date] || {};
            for (const proposer of Object.keys(dayData)) {
                const proposerData = dayData[proposer];
                if (proposerData) {
                    // Add BGT vault emissions
                    if (proposerData.vaultBgtBI && proposerData.vaultBgtBI > 0n) {
                        allTokens.add('BGT_Vaults');
                    }
                    // Add booster tokens
                    if (proposerData.boosters) {
                        Object.keys(proposerData.boosters).forEach(token => {
                            if (proposerData.boosters[token] > 0n) {
                                allTokens.add(token);
                            }
                        });
                    }
                }
            }
        }
        
        const tokenList = Array.from(allTokens).sort();
        
        
        // Create CSV header with token names
        let csvHeader = 'Validator Name,Validator Address,Operator Address';
        tokenList.forEach(token => {
            const tokenName = tokenNameCache.get(token) || token.substring(0, 8) + '...';
            csvHeader += `,${tokenName} (${token})`;
        });
        csvHeader += ',Total USD';
        
        // Create second header row with exchange rates
        let exchangeRateHeader = 'USD per token,,';
        tokenList.forEach(token => {
            let rate = 0;
            if (token === 'BGT_Vaults') {
                rate = tokenUsdRateCache.get(BGT_CONTRACT.toLowerCase()) || 0;
            } else {
                rate = tokenUsdRateCache.get(token) || 0;
            }
            exchangeRateHeader += `,${rate.toFixed(8)}`;
        });
        exchangeRateHeader += ',Total';
        
        // Create CSV rows
        const csvRows = [];
        const tokenTotals = {};
        tokenList.forEach(token => tokenTotals[token] = 0);
    
    for (const validator of validators) {
            let row = `${validator.name},${validator.proposer},${validator.operatorAddress}`;
            let validatorTotal = 0;
            
            tokenList.forEach(token => {
                let tokenAmount = 0;
                try {
                    
                    if (token === 'BGT_Vaults') {
                        // Sum up vault BGT across all days using BigInt math
                        let totalBgtBI = 0n;
                        for (const date of datesToAnalyze) {
                            const dayData = polDaily[date]?.[validator.proposer];
                            if (dayData?.vaultBgtBI) {
                                totalBgtBI += dayData.vaultBgtBI;
                            }
                        }
                        // Convert to number safely using string conversion
                        tokenAmount = parseFloat(totalBgtBI.toString()) / 1e18;
                    } else {
                        // Sum up booster tokens across all days using BigInt math
                        let totalTokenBI = 0n;
                        const decimals = Number(tokenDecimalsCache.get(token) || 18);
                        for (const date of datesToAnalyze) {
                            const dayData = polDaily[date]?.[validator.proposer];
                            if (dayData?.boosters?.[token]) {
                                const tokenValue = dayData.boosters[token];
                                // Ensure we're working with BigInt
                                if (typeof tokenValue === 'bigint') {
                                    totalTokenBI += tokenValue;
                                } else {
                                    log(`Warning: Non-BigInt token value for ${token}: ${typeof tokenValue} = ${tokenValue}`);
                                }
                            }
                        }
                        // Convert to number safely using string conversion
                        const totalTokenStr = totalTokenBI.toString();
                        const divisor = Math.pow(10, decimals);
                        const parsedFloat = parseFloat(totalTokenStr);
                        tokenAmount = parsedFloat / divisor;
                    }
                } catch (error) {
                    log(`Error processing token ${token} for validator ${validator.name}: ${error.message}`);
                    tokenAmount = 0; // Set to 0 on error
                }
                
                row += `,${tokenAmount.toFixed(6)}`;
                validatorTotal += tokenAmount;
                tokenTotals[token] += tokenAmount;
            });
            
            row += `,${validatorTotal.toFixed(6)}`;
            csvRows.push(row);
        }
        
        // Add totals row
        let totalsRow = 'TOTALS,,';
        let grandTotal = 0;
        tokenList.forEach(token => {
            totalsRow += `,${tokenTotals[token].toFixed(6)}`;
            grandTotal += tokenTotals[token];
        });
        totalsRow += `,${grandTotal.toFixed(6)}`;
        csvRows.push(totalsRow);
        
        const csvContent = [csvHeader, exchangeRateHeader, ...csvRows].join('\n');
        const summaryFile = `validator_incentive_summary.csv`;
        fs.writeFileSync(summaryFile, csvContent);
        log(`\nIncentive summary saved to ${summaryFile}`);
        
        return summaryFile;
    }
    
    /**
     * Main execution function that orchestrates the complete validator analysis
     * 
     * This function builds the comprehensive validator performance analysis by compiling
     * data from multiple sources and generating detailed reports. It constructs the analysis by:
     * 1. Setting up date ranges and loading validator configuration
     * 2. Finding precise day boundaries for accurate daily analysis
     * 3. Scanning all blocks to identify proposers and empty blocks
     * 4. Collecting stake and boost data at day boundaries
     * 5. Indexing POL events to capture incentive flows
     * 6. Converting all amounts to USD using real-time exchange rates
     * 7. Calculating 4-dimensional scores and generating rankings
     * 8. Producing both detailed statistics and incentive matrix reports
     * 
     * The compilation process handles large datasets with chunked processing,
     * parallel execution, and BigInt arithmetic to ensure accuracy and performance.
     * 
     * @returns {Promise<void>} Completes analysis and writes output files
     * @throws {Error} If critical data cannot be obtained or processed
     */
async function main() {
    try {
        // Parse command line arguments
        const daysToAnalyze = parseInt(args.find(arg => arg.startsWith('--days='))?.split('=')[1]) || 45;
        const endDateArg = args.find(arg => arg.startsWith('--end-date='))?.split('=')[1];
            
        // Analysis mode
        log(`Analyzing ${daysToAnalyze} days of validator performance...`);
        if (endDateArg) {
            log(`End date specified: ${endDateArg}`);
        }
        
        // Generate dates to analyze (complete days, ending on specified date or yesterday)
        // Also include the day after the end date to find the boundary for the last analyzed day's end block
        let endDate;
        if (endDateArg) {
            // Parse and validate the provided end date
            const dateMatch = endDateArg.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!dateMatch) {
                throw new Error(`Invalid end date format: ${endDateArg}. Expected YYYY-MM-DD format.`);
            }
            endDate = new Date(endDateArg + 'T23:59:59.999Z'); // End of day in UTC
            endDate.setUTCDate(endDate.getUTCDate() + 1); // Move to start of next day for boundary calculation
        } else {
            // Default: use today (which means we analyze up to yesterday)
            endDate = new Date();
        }
        
        const dates = Array.from({ length: daysToAnalyze + 1 }, (_, i) => {
            const date = new Date(endDate);
            date.setDate(date.getDate() - (daysToAnalyze - i)); // i=0 -> first day to analyze, i=daysToAnalyze -> boundary day
            return date;
        });
        
        // Log the actual analysis period
        const firstDay = dates[0].toISOString().split('T')[0];
        const lastDay = dates[dates.length - 2].toISOString().split('T')[0]; // -2 because last date is boundary
        log(`Analysis period: ${firstDay} to ${lastDay} (${daysToAnalyze} days)`);
        
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
        
        // Index POL events per day (BGT to vaults, booster tokens)
        const { daily: polDaily } = await indexPolEvents(validators, dayRanges);
        
        // Force garbage collection after large data processing
        if (global.gc) {
            global.gc();
        }
        
        // Compute USD valuations for vaults and boosters per day
        const { dailyUsd, perTokenRates } = await computeUsdValuations(polDaily, validators, dayRanges);
        // Expose for CSV generation
        global.__DAILY_USD__ = dailyUsd;

        // Calculate statistics (unchanged scoring)
        log('\nCalculating statistics...');
        const statistics = calculateStatistics(blockResults, stakeBoostData, dayBoundaries, validators);
        
        // Generate report
        log('\nGenerating report...');
        const rankings = generateReport(statistics, validators, dayBoundaries);
        
        // Generate incentive summary CSV
        log('\nGenerating incentive summary...');
        try {
            generateSummaryCSV(statistics, validators, dayBoundaries, polDaily, tokenNameCache);
        } catch (error) {
            log(`Error in generateSummaryCSV: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
            throw error;
        }

        // Verbose per-day USD output per validator (if FULL_DETAIL)
        if (process.env.VERBOSE === 'true' || process.env.VERBOSE === '1') {
            const datesToAnalyze = Object.keys(dayRanges).sort();
            for (const v of rankings) {
                log(`\nEconomic output (USD) for ${v.name} (${v.validatorAddress})`);
                datesToAnalyze.forEach(date => {
                    const usd = dailyUsd[date]?.[v.validatorAddress];
                    if (usd) {
                        log(`${date}: vaultsUSD=$${usd.vaultsUSD.toFixed(6)}, boostersUSD=$${usd.boostersUSD.toFixed(6)}, totalUSD=$${usd.totalUSD.toFixed(6)}`);
                    }
                });
            }
        }

        // Summary: average total economic value per validator across days
        const datesAnalyzed = Object.keys(dayRanges).length;
        log('\nAverage daily economic value (USD) across analyzed days:');
        for (const v of rankings) {
            let sum = 0;
            for (const date of Object.keys(dayRanges)) {
                const usd = dailyUsd[date]?.[v.validatorAddress]?.totalUSD || 0;
                sum += usd;
            }
            const avg = datesAnalyzed > 0 ? sum / datesAnalyzed : 0;
            log(`${v.name}: $${avg.toFixed(6)} per day`);
        }

        // Print token exchange rates summary
        log('\nToken USD exchange rates used:');
        Object.entries(perTokenRates).forEach(([token, rate]) => {
            log(`${token} = $${Number(rate).toFixed(8)} per 1 token`);
        });
        
    } catch (error) {
        log('Fatal error: ' + error.message);
        // Let Node.js exit naturally instead of forcing exit
        throw error;
    }
}

// Run if this is the main thread
if (isMainThread) {
    main();
}
