#!/usr/bin/env node

import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { isMainThread } from 'worker_threads';
import { BlockFetcher, ValidatorFetcher, ValidatorNameDB, ConfigHelper } from '../block-scanners/lib/shared-utils.js';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path for validator scoring data - use shared config
const VALIDATOR_DB_PATH = ConfigHelper.getValidatorDbPath();

// Environment variables with config helper fallbacks
const EL_ETHRPC_URL = process.env.EL_ETHRPC_URL || ConfigHelper.getRpcUrl('el', 'mainnet');
const CL_ETHRPC_URL = process.env.CL_ETHRPC_URL || ConfigHelper.getRpcUrl('cl', 'mainnet');
// Optional alternate RPCs. Primary remains as-is; alternates default to provided IPs if unset
const EL_ETHRPC_URL_ALT = process.env.EL_ETHRPC_URL_ALT || 'http://37.27.231.195:59810';
const CL_ETHRPC_URL_ALT = process.env.CL_ETHRPC_URL_ALT || 'http://37.27.231.195:59800';
const HAS_ALTERNATE_RPCS = Boolean(EL_ETHRPC_URL_ALT && CL_ETHRPC_URL_ALT && (EL_ETHRPC_URL_ALT !== EL_ETHRPC_URL || CL_ETHRPC_URL_ALT !== CL_ETHRPC_URL));
const HONEY_TOKEN = process.env.HONEY_TOKEN || '0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce';

// Configuration constants
const CHUNK_SIZE = 2000; // Block scanning chunk size
const BLOCKS_PER_DAY = 43200; // Approximate, used for binary search estimates
const EMPTY_BLOCK_THRESHOLD = 1; // A block is considered empty if it has <= 1 transactions (i.e., 0 or 1)
const GENESIS_TIMESTAMP = 1737382451; // 2025-01-20 14:14:11 UTC
const BGT_CONTRACT = '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba';
const BERACHEF_CONTRACT = '0xdf960E8F3F19C481dDE769edEDD439ea1a63426a';
const ACTIVATE_EVENT_SIG = '0x09fed3850dff4fef07a5284847da937f94021882ecab1c143fcacd69e5451bd8';
const KYBER_ROUTE_URL = 'https://gateway.mainnet.berachain.com/proxy/kyberswap/berachain/api/v1/routes';

// BeraChef interface for contract calls
const BERACHEF_IFACE = new ethers.Interface([
    'function getActiveRewardAllocation(bytes valPubkey) view returns (tuple(uint64 startBlock, tuple(address receiver, uint96 percentageNumerator)[] weights))',
    'function getDefaultRewardAllocation() view returns (tuple(uint64 startBlock, tuple(address receiver, uint96 percentageNumerator)[] weights))'
]);

// Concurrency and performance constants
const LOG_CHUNK_SIZE = 2000; // Size of each log fetching chunk in blocks
const BASE_WORKER_COUNT = 6; // Reduced from 12 to avoid overwhelming consensus layer API
const MAX_WORKER_COUNT = HAS_ALTERNATE_RPCS ? BASE_WORKER_COUNT * 2 : BASE_WORKER_COUNT; // Double total when splitting across primary+alternate

/**
 * Generic pipeline system that maintains maximum parallelism
 * Processes work items as workers become available, keeping all workers busy
 * @template TInput - Input work item type
 * @template TOutput - Output result type
 */
class Pipeline {
    /**
     * Creates a new pipeline
     * @param {number} maxConcurrency - Maximum number of parallel workers
     * @param {Function} workerFn - Async function that processes a work item
     * @param {string} description - Description for progress logging
     */
    constructor(maxConcurrency, workerFn, description = 'Processing') {
        this.maxConcurrency = maxConcurrency;
        this.workerFn = workerFn;
        this.description = description;
    }
    
    /**
     * Processes all work items in parallel pipeline with maximum parallelism
     * All items are mapped upfront and semaphores ensure workers stay busy
     * @param {Array<TInput>} workItems - Array of work items to process
     * @param {Function} getProvider - Optional function (item, index) => provider to select provider per item
     * @param {boolean} showProgress - Whether to show progress bar
     * @returns {Promise<Array<TOutput>>} Array of results in same order as work items
     */
    async process(workItems, getProvider = null, showProgress = true) {
        const total = workItems.length;
        const progress = showProgress ? createProgressBar(total, this.description) : null;
        
        // Semaphore to control concurrency - ensures max workers busy at all times
        const semaphore = {
            count: this.maxConcurrency,
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
        
        const results = new Array(total);
        let completed = 0;
        
        // Process all items - semaphores automatically throttle and keep workers busy
        const promises = workItems.map(async (item, index) => {
            await semaphore.acquire();
            try {
                const provider = getProvider ? getProvider(item, index) : null;
                const result = await this.workerFn(item, index, provider);
                results[index] = result;
                completed++;
                if (progress) {
                    progress.update(completed);
                }
                return result;
            } catch (error) {
                log(`Error processing ${this.description} item ${index + 1}/${total}: ${error.message}`);
                results[index] = null;
                completed++;
                if (progress) {
                    progress.update(completed);
                }
                return null;
            } finally {
                semaphore.release();
            }
        });
        
        // Wait for all to complete
        await Promise.all(promises);
        
        if (progress) {
            progress.finish();
        }
        
        return results;
    }
}

/**
 * Multi-provider pipeline that splits work across primary and alternate providers
 * Automatically balances load between providers for maximum throughput
 */
class MultiProviderPipeline {
    /**
     * Creates a multi-provider pipeline
     * @param {number} maxConcurrency - Maximum total concurrent workers (split across providers)
     * @param {Function} workerFn - Async function (item, index, provider) => result
     * @param {Object} primaryProvider - Primary provider instance
     * @param {Object} alternateProvider - Alternate provider instance (optional)
     * @param {string} description - Description for progress logging
     */
    constructor(maxConcurrency, workerFn, primaryProvider, alternateProvider = null, description = 'Processing') {
        this.maxConcurrency = maxConcurrency;
        this.workerFn = workerFn;
        this.primaryProvider = primaryProvider;
        this.alternateProvider = alternateProvider;
        this.description = description;
        this.useAlternate = Boolean(alternateProvider);
        
        // Split workers between providers
        if (this.useAlternate) {
            this.primaryWorkers = Math.floor(maxConcurrency / 2);
            this.alternateWorkers = maxConcurrency - this.primaryWorkers;
        } else {
            this.primaryWorkers = maxConcurrency;
            this.alternateWorkers = 0;
        }
    }
    
    /**
     * Processes all work items with automatic provider selection
     * @param {Array} workItems - Work items to process
     * @param {boolean} showProgress - Whether to show progress bar
     * @returns {Promise<Array>} Results in same order as work items
     */
    async process(workItems, showProgress = true) {
        const total = workItems.length;
        const progress = showProgress ? createProgressBar(total, this.description) : null;
        
        // Separate semaphores for each provider
        const primarySemaphore = {
            count: this.primaryWorkers,
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
        
        const alternateSemaphore = this.useAlternate ? {
            count: this.alternateWorkers,
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
        } : null;
        
        const results = new Array(total);
        let completed = 0;
        
        // Process item with automatic provider selection
        const processItem = async (item, index) => {
            // Round-robin provider selection (alternates between providers)
            const usePrimary = !this.useAlternate || (index % 2 === 0);
            const sem = usePrimary ? primarySemaphore : alternateSemaphore;
            const provider = usePrimary ? this.primaryProvider : this.alternateProvider;
            
            await sem.acquire();
            try {
                const result = await this.workerFn(item, index, provider);
                results[index] = result;
                completed++;
                if (progress) {
                    progress.update(completed);
                }
                return result;
            } catch (error) {
                log(`Error processing ${this.description} item ${index + 1}/${total}: ${error.message}`);
                results[index] = null;
                completed++;
                if (progress) {
                    progress.update(completed);
                }
                return null;
            } finally {
                sem.release();
            }
        };
        
        // Start all items - semaphores will throttle automatically
        const promises = workItems.map((item, index) => processItem(item, index));
        
        // Wait for all to complete
        await Promise.all(promises);
        
        if (progress) {
            progress.finish();
        }
        
        return results;
    }
}

// Event signatures
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
async function withRetry(operation, maxRetries = 3, initialDelay = 1000, timeoutMs = 30000) {
    let lastError;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Wrap operation with timeout to prevent indefinite hangs
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            
            return await Promise.race([operation(), timeoutPromise]);
        } catch (error) {
            lastError = error;
            const errorMsg = error.message.toLowerCase();
            // Retry network-related errors including "aborted" and timeouts
            const isRetryable = errorMsg.includes('fetch failed') || 
                              errorMsg.includes('etimedout') || 
                              errorMsg.includes('econnreset') ||
                              errorMsg.includes('aborted') ||
                              errorMsg.includes('network') ||
                              errorMsg.includes('timeout') ||
                              errorMsg.includes('econnrefused') ||
                              errorMsg.includes('timed out');
            
            if (isRetryable) {
                if (attempt < maxRetries) {
                    log(`Attempt ${attempt} failed (${error.message}), retrying in ${delay/1000}s...`);
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
async function getBlockProposer(blockHeight, clUrl = CL_ETHRPC_URL) {
    return withRetry(async () => {
        const response = await fetch(`${clUrl}/header?height=${blockHeight}`);
        const data = await response.json();
        if (!data.result?.header?.proposer_address) {
            throw new Error(`No proposer found for block ${blockHeight}`);
        }
        return data.result.header.proposer_address;
    });
}


/**
* Gets validator voting power data from consensus layer using shared utilities
* @param {number} blockHeight - Block height to query validator set
* @returns {Promise<Object|null>} Validator data object or null if no validators found
* @returns {Object} validators - Map of validator address to {address, voting_power, pub_key}
*/
async function getValidatorVotingPower(blockHeight) {
    return withRetry(async () => {
        // Convert "latest" to actual block number for CL API
        let actualBlockHeight = blockHeight;
        if (blockHeight === 'latest') {
            const { execSync } = await import('child_process');
            const blockNumOutput = execSync(`cast block-number --rpc-url ${EL_ETHRPC_URL}`, { encoding: 'utf8' });
            actualBlockHeight = parseInt(blockNumOutput.trim());
        }
        
        const validatorFetcher = new ValidatorFetcher(CL_ETHRPC_URL);
        const validators = await validatorFetcher.getValidators(actualBlockHeight);
        
        if (process.env.VERBOSE && validators) {
            log(`Total validators found: ${Object.keys(validators).length}`);
        }
            
        return validators;
    });
}

/**
* Gets the BGT boost amount for a validator at a specific block
* @param {string} validatorPubkey - Validator public key (with or without 0x prefix, will be normalized)
* @param {number} blockNumber - Block number to query
* @returns {Promise<number>} BGT boost amount (0 if none or error)
*/
async function getValidatorBoost(validatorPubkey, blockNumber) {
    try {
        // Normalize pubkey format - ensure it has 0x prefix for cast call
        // Cast can handle it either way, but let's be explicit
        const normalizedPubkey = validatorPubkey && !validatorPubkey.startsWith('0x') 
            ? '0x' + validatorPubkey 
            : validatorPubkey;
        
        const result = await callContractFunction(
            BGT_CONTRACT,
            "boostees(bytes)", // BGT contract function to get boost amount
            [normalizedPubkey],
            blockNumber
        );
        
        if (result && result !== '0x' && result !== '0x0') {
            // Use BigInt to handle large values without precision loss
            const rawValue = BigInt(result); // Parse hex result as BigInt
            const boostAmount = Number(rawValue) / 1e18; // Convert wei to BGT (18 decimals)
            if (process.env.VERBOSE && boostAmount > 0) {
                log(`  Validator ${normalizedPubkey.substring(0, 20)}... has boost: ${boostAmount.toFixed(2)} BGT`);
            }
            return boostAmount;
        }
        return 0;
    } catch (error) {
        // Log error but don't fail silently - this could indicate a real issue
        log(`⚠️  Error getting boost for validator ${validatorPubkey?.substring(0, 20)}... at block ${blockNumber}: ${error.message}`);
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
* Loads genesis validator information from genesis_validators.csv file
* @returns {Array<Object>} Array of genesis validator objects with name, proposer, pubkey, operatorAddress
* @throws {Error} If CSV file cannot be read or parsed
*/
function loadGenesisValidators() {
    const csvContent = fs.readFileSync('genesis_validators.csv', 'utf8');
    const lines = csvContent.split('\n');
    const validators = [];
    
    // Skip header row (i=1)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
            const [cometAddress, name, pubkey, operatorAddress] = line.split(',');
            // Ensure pubkey always has 0x prefix - never remove it
            const normalizedPubkey = pubkey && !pubkey.startsWith('0x') 
                ? '0x' + pubkey 
                : pubkey;
            validators.push({
                name,
                proposer: cometAddress, // Consensus layer address
                pubkey: normalizedPubkey,
                operatorAddress // Execution layer address
            });
        }
    }
    
    return validators;
}

/**
* Loads all validators from the shared validator database
* @returns {Promise<Array<Object>>} Array of all current validator objects from database
*/
async function loadAllValidatorsFromDB() {
    try {
        log('Loading all active validators from database...');
        const validatorDB = new ValidatorNameDB();
        const dbValidators = await validatorDB.getAllValidators();
        
        if (!dbValidators || dbValidators.length === 0) {
            throw new Error('No validators found in database');
        }
        
        const validators = dbValidators.map(dbValidator => ({
            name: dbValidator.name || 'Unknown',
            proposer: dbValidator.proposer_address,
            pubkey: dbValidator.pubkey || '',
            operatorAddress: dbValidator.operator || dbValidator.address || dbValidator.proposer_address
        }));
        
        log(`Loaded ${validators.length} validators from database`);
        return validators;
    } catch (error) {
        log(`Error loading validators from database: ${error.message}`);
        throw error;
    }
}

/**
* Loads validator information based on configuration
* @param {boolean} ignoreGenesis - If true, load all validators from database and ignore CSV entirely
* @returns {Promise<Array<Object>>} Array of validator objects with name, proposer, pubkey, operatorAddress
* @throws {Error} If validators cannot be loaded
*/
async function loadValidators(ignoreGenesis = false) {
    if (ignoreGenesis) {
        log('Ignoring genesis CSV, loading ALL current validators from database...');
        return await loadAllValidatorsFromDB();
    } else {
        log('Loading genesis validators from CSV file...');
        return loadGenesisValidators();
    }
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
async function scanBlockChunk(chunkStart, chunkEnd, validators, validatorMap, elRpcUrl = EL_ETHRPC_URL, clRpcUrl = CL_ETHRPC_URL) {
    const provider = new ethers.JsonRpcProvider(elRpcUrl);
    const chunkResults = new Map();
    
    // Scan each block in the chunk
    for (let blockNum = chunkStart; blockNum <= chunkEnd; blockNum++) {
        try {
            // Get the proposer of this block from consensus layer (already has retry logic)
            const proposer = await getBlockProposer(blockNum, clRpcUrl);
            
            // Only process blocks from validators we're tracking
            if (validatorMap.has(proposer)) {
                // Get block data from execution layer to check if empty (wrap in retry)
                const block = await withRetry(async () => {
                    return await provider.getBlock(blockNum);
                });
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
* Scans a range of blocks in parallel using pipeline system for maximum parallelism
* Divides the work into chunks and processes them concurrently, keeping all workers busy
* @param {number} startBlock - Starting block number (inclusive)
* @param {number} endBlock - Ending block number (inclusive)
* @param {Array<Object>} validators - Array of validator objects
* @param {Map} validatorMap - Map of proposer addresses to validator objects
* @param {boolean} showProgress - Whether to show progress bar (default: true)
* @returns {Promise<Map>} Merged results from all chunks
*/
async function scanBlocksParallel(startBlock, endBlock, validators, validatorMap, showProgress = true) {
    // Divide the block range into chunks
    const chunks = [];
    for (let chunkStart = startBlock; chunkStart <= endBlock; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, endBlock);
        chunks.push({ chunkStart, chunkEnd });
    }
    
    const useAlternate = HAS_ALTERNATE_RPCS;
    
    // Worker function that processes a single chunk
    const workerFn = async (chunk, index, providerInfo) => {
        const isAlternate = useAlternate && (index % 2 === 1);
        const elUrl = isAlternate ? EL_ETHRPC_URL_ALT : EL_ETHRPC_URL;
        const clUrl = isAlternate ? CL_ETHRPC_URL_ALT : CL_ETHRPC_URL;
        return await scanBlockChunk(chunk.chunkStart, chunk.chunkEnd, validators, validatorMap, elUrl, clUrl);
    };
    
    // Create pipeline - splits work across providers automatically
    const pipeline = new MultiProviderPipeline(
        MAX_WORKER_COUNT,
        workerFn,
        { el: EL_ETHRPC_URL, cl: CL_ETHRPC_URL },
        useAlternate ? { el: EL_ETHRPC_URL_ALT, cl: CL_ETHRPC_URL_ALT } : null,
        'Scanning block chunks'
    );
    
    // Process all chunks with maximum parallelism
    const results = await pipeline.process(chunks, showProgress);
    
    // Merge results from all chunks
    const mergedResults = new Map();
    results.forEach(chunkResult => {
        if (!chunkResult) return; // Skip null results from errors
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
 * BGTBoosterIncentivesProcessed events across specified day ranges. These events represent
 * booster token incentives distributed by validators to users.
 * 
 * The function processes events in chunks to prevent memory issues, then aggregates
 * all token amounts (stored as BigInt for precision) by validator and date.
 * 
 * @param {Array<Object>} validators - Array of validator objects with pubkey for filtering
 * @param {Object} dayRanges - Object mapping dates to {startBlock, endBlock} ranges
 * @returns {Promise<Object>} Object with compiled daily aggregated data
 * @returns {Object} daily - Structure: date -> proposer -> {vaultBgtBI: BigInt, boosters: {token: BigInt}}
 *   - vaultBgtBI: Always 0n (kept for compatibility, Distributed events not scanned)
 *   - boosters: Map of token addresses to BigInt amounts of booster incentives
 */
async function indexPolEvents(validators, dayRanges) {
    const providerPrimary = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    const providerAlternate = HAS_ALTERNATE_RPCS ? new ethers.JsonRpcProvider(EL_ETHRPC_URL_ALT) : null;
    const iface = new ethers.Interface([
        'event BGTBoosterIncentivesProcessed(bytes indexed pubkey, address indexed token, uint256 bgtEmitted, uint256 amount)'
    ]);
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
    async function processLogsChunked(fromBlock, toBlock, filter, eventType, chunkSize = LOG_CHUNK_SIZE, batchSize = MAX_WORKER_COUNT) {
        // Create chunk ranges
        const chunks = [];
        let currentBlock = fromBlock;
        
        while (currentBlock <= toBlock) {
            const chunkEnd = Math.min(currentBlock + chunkSize - 1, toBlock);
            chunks.push({ start: currentBlock, end: chunkEnd });
            currentBlock = chunkEnd + 1;
        }
        
        log(`Processing ${chunks.length} chunks for ${eventType} events with max ${batchSize} concurrent requests...`);
        
        // Worker function that processes a single chunk
        const workerFn = async (chunk, index, provider) => {
            try {
                // Use retry logic for getLogs calls to handle network errors
                const chunkLogs = await withRetry(
                    () => provider.getLogs({
                        ...filter,
                        fromBlock: chunk.start,
                        toBlock: chunk.end
                    }),
                    5, // max retries
                    1000 // initial delay
                );
                let processedCount = 0;
                for (const log of chunkLogs) {
                    const topicPub = (log.topics?.[1] || '').toLowerCase();
                    if (!pubTopicSet.has(topicPub)) continue;
                    const proposer = topicToProposer.get(topicPub);
                    const date = getDateForBlock(log.blockNumber);
                    if (!date) continue;
                    const parsed = iface.parseLog(log);
                    if (!daily[date][proposer]) daily[date][proposer] = { vaultBgtBI: 0n, boosters: {} };
                    // Only process BGTBoosterIncentivesProcessed events (Distributed events not used in scoring)
                    if (eventType === 'BGTBoosterIncentivesProcessed') {
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
            }
        };
        
        // Use MultiProviderPipeline for maximum parallelism across providers
        const pipeline = new MultiProviderPipeline(
            batchSize,
            workerFn,
            providerPrimary,
            providerAlternate,
            `Indexing ${eventType} chunks`
        );
        
        // Process all chunks - pipeline maintains max parallelism at all times
        const processedCounts = await pipeline.process(chunks, true);
        const totalProcessed = processedCounts.reduce((sum, count) => sum + (count || 0), 0);
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
    
        log(`Indexing POL events for all ${Object.keys(dayRanges).length} days (${totalBlocks} total blocks in parallel batches of ${MAX_WORKER_COUNT}x${LOG_CHUNK_SIZE})...`);
    
    // Helper function to determine which date a block belongs to
    function getDateForBlock(blockNumber) {
        for (const [date, range] of Object.entries(dayRanges)) {
            if (blockNumber >= range.startBlock && blockNumber <= range.endBlock) {
                return date;
            }
        }
        return null;
    }
    
    // Process BGTBoosterIncentivesProcessed events (used for stake-scaled booster scoring)
    // Note: Distributed events (vault BGT emissions) are not used in scoring, only in reporting
    try {
        await processLogsChunked(overallStartBlock, overallEndBlock, {
            topics: [boosterTopic0]
        }, 'BGTBoosterIncentivesProcessed');
    } catch (e) {
        log(`Error processing BGTBoosterIncentivesProcessed events: ${e.message}`);
    }
    
    
    return { daily };
}

/**
 * Helper to decode RewardAllocation from contract call result
 * @param {string} resultHex - Hex string result from contract call
 * @returns {Object|null} Decoded allocation or null on error
 */
function decodeRewardAllocation(resultHex) {
    try {
        const decoded = BERACHEF_IFACE.decodeFunctionResult('getDefaultRewardAllocation', resultHex);
        const alloc = decoded[0];
        return {
            startBlock: Number(alloc.startBlock.toString()),
            weights: alloc.weights.map(w => ({ 
                receiver: (w.receiver || w[0]).toLowerCase(), 
                percentageNumerator: BigInt(w.percentageNumerator || w[1]) 
            }))
        };
    } catch {
        try {
            const decoded = BERACHEF_IFACE.decodeFunctionResult('getActiveRewardAllocation', resultHex);
            const alloc = decoded[0];
            return {
                startBlock: Number(alloc.startBlock.toString()),
                weights: alloc.weights.map(w => ({ 
                    receiver: (w.receiver || w[0]).toLowerCase(), 
                    percentageNumerator: BigInt(w.percentageNumerator || w[1]) 
                }))
            };
        } catch {
            return null;
        }
    }
}

/**
 * Helper to compare two allocations ignoring order of weights
 * @param {Object} a - First allocation
 * @param {Object} b - Second allocation
 * @returns {boolean} True if allocations are equal (ignoring order)
 */
function allocationsEqualIgnoringOrder(a, b) {
    if (!a || !b) return false;
    if (a.weights.length !== b.weights.length) return false;
    
    const sortedA = [...a.weights].sort((x, y) => {
        const addrCmp = x.receiver.localeCompare(y.receiver);
        return addrCmp !== 0 ? addrCmp : Number(x.percentageNumerator - y.percentageNumerator);
    });
    const sortedB = [...b.weights].sort((x, y) => {
        const addrCmp = x.receiver.localeCompare(y.receiver);
        return addrCmp !== 0 ? addrCmp : Number(x.percentageNumerator - y.percentageNumerator);
    });
    
    return sortedA.every((w, i) => 
        w.receiver.toLowerCase() === sortedB[i].receiver.toLowerCase() &&
        w.percentageNumerator === sortedB[i].percentageNumerator
    );
}

/**
 * Gets ISO week number for a date
 * @param {Date} date - Date object
 * @returns {string} ISO week string (YYYY-WW)
 */
function getISOWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Groups dates by ISO week
 * @param {Array<string>} dates - Array of date strings (YYYY-MM-DD)
 * @returns {Object} Object mapping ISO week strings to arrays of dates
 */
function groupDatesByWeek(dates) {
    const weekGroups = {};
    for (const dateStr of dates) {
        const date = new Date(dateStr + 'T00:00:00Z');
        const week = getISOWeek(date);
        if (!weekGroups[week]) {
            weekGroups[week] = [];
        }
        weekGroups[week].push(dateStr);
    }
    return weekGroups;
}

/**
 * Scans for BeraChef ActivateRewardAllocation events
 * @param {Array<Object>} validators - Array of validator objects with pubkeys
 * @param {Object} dayRanges - Object mapping dates to {startBlock, endBlock}
 * @returns {Promise<Object>} Object with activation data by validator and week
 */
async function scanBeraChefActivations(validators, dayRanges) {
    const providerPrimary = new ethers.JsonRpcProvider(EL_ETHRPC_URL);
    const providerAlternate = HAS_ALTERNATE_RPCS ? new ethers.JsonRpcProvider(EL_ETHRPC_URL_ALT) : null;
    
    const activateTopic0 = ACTIVATE_EVENT_SIG;
    const { set: pubTopicSet, topicToProposer } = buildPubkeyTopicSet(validators);
    
    // Map of validator pubkey -> array of activation dates
    const activationsByValidator = {};
    for (const v of validators) {
        const pk = v.pubkey.startsWith('0x') ? v.pubkey : `0x${v.pubkey}`;
        activationsByValidator[pk.toLowerCase()] = [];
    }
    
    // Calculate overall block range
    const allRanges = Object.values(dayRanges);
    const overallStartBlock = Math.min(...allRanges.map(r => r.startBlock));
    const overallEndBlock = Math.max(...allRanges.map(r => r.endBlock));
    
    // Helper to get date for a block
    function getDateForBlock(blockNumber) {
        for (const [date, range] of Object.entries(dayRanges)) {
            if (blockNumber >= range.startBlock && blockNumber <= range.endBlock) {
                return date;
            }
        }
        return null;
    }
    
    log('Scanning BeraChef ActivateRewardAllocation events...');
    
    // Process logs in chunks
    const chunkSize = LOG_CHUNK_SIZE;
    const chunks = [];
    for (let currentBlock = overallStartBlock; currentBlock <= overallEndBlock; currentBlock += chunkSize) {
        const chunkEnd = Math.min(currentBlock + chunkSize - 1, overallEndBlock);
        chunks.push({ start: currentBlock, end: chunkEnd });
    }
    
    // Worker function that processes a single chunk
    const workerFn = async (chunk, index, provider) => {
        try {
            const filter = {
                address: BERACHEF_CONTRACT,
                topics: [activateTopic0]
            };
            const chunkLogs = await provider.getLogs({
                ...filter,
                fromBlock: chunk.start,
                toBlock: chunk.end
            });
            
            let processedCount = 0;
            for (const log of chunkLogs) {
                const topicPub = (log.topics?.[1] || '').toLowerCase();
                if (!pubTopicSet.has(topicPub)) continue;
                
                const proposer = topicToProposer.get(topicPub);
                if (!proposer) continue;
                
                const validator = validators.find(v => v.proposer === proposer);
                if (!validator) continue;
                
                const blockNumber = typeof log.blockNumber === 'number' ? log.blockNumber : parseInt(log.blockNumber.toString(), 10);
                const date = getDateForBlock(blockNumber);
                if (date) {
                    const pk = validator.pubkey.startsWith('0x') ? validator.pubkey : `0x${validator.pubkey}`;
                    if (activationsByValidator[pk.toLowerCase()]) {
                        activationsByValidator[pk.toLowerCase()].push(date);
                    }
                }
                processedCount++;
            }
            return processedCount;
        } catch (e) {
            log(`Error processing BeraChef activation logs for chunk ${index + 1}/${chunks.length}: ${e.message}`);
            return 0;
        }
    };
    
    // Use MultiProviderPipeline for maximum parallelism across providers
    const pipeline = new MultiProviderPipeline(
        MAX_WORKER_COUNT,
        workerFn,
        providerPrimary,
        providerAlternate,
        'Scanning BeraChef activations'
    );
    
    // Process all chunks - pipeline maintains max parallelism at all times
    const processedCounts = await pipeline.process(chunks, true);
    const totalProcessed = processedCounts.reduce((sum, count) => sum + (count || 0), 0);
    log(`Processed ${totalProcessed} BeraChef activation events`);
    
    return activationsByValidator;
}

/**
 * Gets default reward allocation from BeraChef contract
 * @returns {Promise<Object|null>} Default allocation or null on error
 */
async function getDefaultRewardAllocation(blockNumber = 'latest') {
    try {
        const data = BERACHEF_IFACE.encodeFunctionData('getDefaultRewardAllocation', []);
        const resultHex = await callContractFunction(BERACHEF_CONTRACT, 'getDefaultRewardAllocation()', [], blockNumber);
        return decodeRewardAllocation(resultHex);
    } catch (error) {
        log(`Error getting default reward allocation: ${error.message}`);
        return null;
    }
}

/**
 * Checks if validator is using default allocation (requires contract call)
 * Compares the validator's active allocation at the specified block with the default allocation at that same block
 * @param {string} validatorPubkey - Validator pubkey (with or without 0x prefix)
 * @param {Object} defaultAllocation - Default allocation to compare against
 * @param {number|string} blockNumber - Block number to query at (default: 'latest')
 * @returns {Promise<boolean|null>} True if using default, false if custom, null on error
 */
async function isUsingDefaultAllocation(validatorPubkey, defaultAllocation, blockNumber = 'latest') {
    if (!defaultAllocation) return null;
    
    try {
        const pk = validatorPubkey.startsWith('0x') ? validatorPubkey : `0x${validatorPubkey}`;
        const data = BERACHEF_IFACE.encodeFunctionData('getActiveRewardAllocation', [pk]);
        const resultHex = await callContractFunction(BERACHEF_CONTRACT, 'getActiveRewardAllocation(bytes)', [pk], blockNumber);
        const activeAllocation = decodeRewardAllocation(resultHex);
        if (!activeAllocation) return null;
        return allocationsEqualIgnoringOrder(activeAllocation, defaultAllocation);
    } catch (error) {
        return null;
    }
}

/**
 * Execute SQL against the validator database
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Optional parameters for prepared statements
 * @returns {Promise<Object>} Result object with ok flag and output
 */
async function executeSQL(sql, params = []) {
    return new Promise((resolve, reject) => {
        let finalSql = sql;
        if (params.length > 0) {
            for (let i = 0; i < params.length; i++) {
                const param = params[i] == null ? 'NULL' : `'${params[i].toString().replace(/'/g, "''")}'`;
                finalSql = finalSql.replace(/\?/g, (match, offset) => {
                    // Only replace the first ? that hasn't been replaced yet
                    const idx = finalSql.substring(0, offset).split('?').length - 1;
                    return idx < params.length ? param : match;
                });
            }
            // Simple replacement for first occurrence per param (better approach)
            let paramIndex = 0;
            finalSql = sql.replace(/\?/g, () => {
                if (paramIndex < params.length) {
                    const param = params[paramIndex] == null ? 'NULL' : `'${params[paramIndex].toString().replace(/'/g, "''")}'`;
                    paramIndex++;
                    return param;
                }
                return '?';
            });
        }
        
        const sqlite = spawn('sqlite3', [VALIDATOR_DB_PATH, finalSql]);
        let output = '';
        let error = '';
        
        sqlite.stdout.on('data', (data) => { output += data.toString(); });
        sqlite.stderr.on('data', (data) => { error += data.toString(); });
        
        sqlite.on('close', (code) => {
            if (code === 0) {
                resolve({ ok: true, output });
            } else {
                reject(new Error(`SQLite error: ${error || 'Unknown error'}`));
            }
        });
    });
}

/**
 * Initialize the scoring schema in the database
 * Creates validator_scores table and evaluation_metadata table
 */
async function initializeScoringSchema() {
    log('📝 Initializing scoring schema in database...');
    
    // Create validator_scores table (rewritten on each evaluation)
    await executeSQL(`
        CREATE TABLE IF NOT EXISTS validator_scores (
            pubkey TEXT PRIMARY KEY,
            proposer_address TEXT,
            name TEXT,
            uptime_score REAL,
            pol_score REAL,
            stake_scaled_booster_score REAL,
            pol_participation_score REAL,
            total_score REAL,
            is_using_default_cutting_board INTEGER,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Create validator_notes table (one-to-many relationship)
    await executeSQL(`
        CREATE TABLE IF NOT EXISTS validator_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            validator_pubkey TEXT NOT NULL,
            note_type TEXT NOT NULL,
            note_message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (validator_pubkey) REFERENCES validator_scores(pubkey)
        )
    `);
    
    // Add column if it doesn't exist (for existing databases)
    try {
        await executeSQL('SELECT is_using_default_cutting_board FROM validator_scores LIMIT 1');
    } catch (error) {
        log('📝 Adding is_using_default_cutting_board column to validator_scores table...');
        await executeSQL('ALTER TABLE validator_scores ADD COLUMN is_using_default_cutting_board INTEGER');
        log('✅ Column added successfully');
    }
    
    // Create evaluation_metadata table (single row, updated on each run)
    await executeSQL(`
        CREATE TABLE IF NOT EXISTS evaluation_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            evaluation_timestamp TIMESTAMP,
            start_date TEXT,
            end_date TEXT,
            days_analyzed INTEGER,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Ensure the metadata row exists
    await executeSQL(`
        INSERT OR IGNORE INTO evaluation_metadata (id, evaluation_timestamp, start_date, end_date, days_analyzed)
        VALUES (1, CURRENT_TIMESTAMP, NULL, NULL, 0)
    `);
    
    // Create validator_daily_stats table for VERBOSE daily breakdown data
    await executeSQL(`
        CREATE TABLE IF NOT EXISTS validator_daily_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            validator_pubkey TEXT NOT NULL,
            proposer_address TEXT NOT NULL,
            date TEXT NOT NULL,
            total_blocks INTEGER,
            empty_blocks INTEGER,
            empty_block_percentage REAL,
            uptime_score REAL,
            pol_score REAL,
            stake_scaled_booster_score REAL,
            stake REAL,
            boost REAL,
            pol_ratio REAL,
            vaults_usd REAL,
            boosters_usd REAL,
            stake_scaled_booster_value REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (validator_pubkey) REFERENCES validator_scores(pubkey),
            UNIQUE(validator_pubkey, date)
        )
    `);
    
    // Create index for faster queries
    await executeSQL(`
        CREATE INDEX IF NOT EXISTS idx_validator_daily_stats_pubkey_date 
        ON validator_daily_stats(validator_pubkey, date)
    `);
    
    log('✅ Scoring schema initialized');
}

/**
 * Generate notes for a validator based on performance anomalies
 * @param {Object} validator - Validator ranking object with scores and metrics
 * @param {Object} statistics - Daily statistics
 * @param {Object} totalVotingPowerByDate - Total voting power per date
 * @param {Array<string>} sortedDates - Sorted array of dates
 * @returns {Array<Object>} Array of note objects with type and message
 */
function generateValidatorNotes(validator, statistics, totalVotingPowerByDate, sortedDates) {
    const notes = [];
    const datesToAnalyze = sortedDates.slice(0, sortedDates.length - 1); // Exclude boundary date
    
    // Check for unexpectedly low block production share
    let lowBlockProductionDays = 0;
    let totalDaysChecked = 0;
    
    for (const date of datesToAnalyze) {
        const dayStats = statistics[date]?.[validator.validatorAddress];
        const totalVotingPower = totalVotingPowerByDate[date];
        
        if (dayStats && totalVotingPower > 0) {
            totalDaysChecked++;
            const votingPower = dayStats.stake || 0;
            const votingPowerPercentage = (votingPower / totalVotingPower) * 100;
            const actualBlocks = dayStats.totalBlocks || 0;
            const actualBlocksPercentage = (actualBlocks / BLOCKS_PER_DAY) * 100;
            
            // If voting power > 0 but actual blocks % is significantly lower (< 90% of expected)
            if (votingPowerPercentage > 0 && actualBlocksPercentage > 0) {
                const ratio = actualBlocksPercentage / votingPowerPercentage;
                if (ratio < 0.9) { // Less than 90% of expected blocks
                    lowBlockProductionDays++;
                }
            } else if (votingPowerPercentage > 0 && actualBlocks === 0) {
                // Has voting power but produced zero blocks
                lowBlockProductionDays++;
            }
        }
    }
    
    // Note for low block production if it happened on most days
    if (totalDaysChecked > 0 && (lowBlockProductionDays / totalDaysChecked) >= 0.5) {
        notes.push({
            type: 'low_block_production',
            message: `Unexpectedly low share of block production (produced fewer blocks than expected based on voting power on ${lowBlockProductionDays} of ${totalDaysChecked} analyzed days)`
        });
    }
    
    // Note for using default cutting board
    if (validator.isUsingDefaultCuttingBoard === true) {
        notes.push({
            type: 'default_cutting_board',
            message: 'Using default cutting board configuration (40% penalty applied to POL Participation score)'
        });
    }
    
    // Note for zero POL participation activations
    if (validator.polParticipationScore <= 20) {
        notes.push({
            type: 'no_pol_activations',
            message: 'No BeraChef reward allocation activations detected during the analysis period'
        });
    }
    
    return notes;
}

/**
 * Write scoring data to database, replacing existing scores
 * @param {Array} rankings - Array of validator ranking objects from generateReport
 * @param {string} startDate - Start date of evaluation (YYYY-MM-DD)
 * @param {string} endDate - End date of evaluation (YYYY-MM-DD)
 * @param {number} daysAnalyzed - Number of days analyzed
 * @param {Object} statistics - Daily statistics for note generation
 * @param {Object} totalVotingPowerByDate - Total voting power per date
 * @param {Array<string>} sortedDates - Sorted array of dates
 */
async function writeScoresToDatabase(rankings, startDate, endDate, daysAnalyzed, statistics, totalVotingPowerByDate, sortedDates) {
    log('💾 Writing scores to database...');
    
    const isVerbose = process.env.VERBOSE === 'true' || process.env.VERBOSE === '1';
    
    // Clear existing scores and notes
    await executeSQL('DELETE FROM validator_scores');
    await executeSQL('DELETE FROM validator_notes');
    
    // Clear daily stats if storing new ones
    if (isVerbose) {
        await executeSQL('DELETE FROM validator_daily_stats');
    }
    
    // Insert new scores
    let inserted = 0;
    let dailyStatsInserted = 0;
    const datesToAnalyze = sortedDates.slice(0, sortedDates.length - 1); // Exclude boundary date
    
    for (const validator of rankings) {
        try {
                    // Ensure pubkey has 0x prefix to match validators table format
                    const normalizedPubkey = validator.pubkey && !validator.pubkey.startsWith('0x') 
                        ? '0x' + validator.pubkey 
                        : validator.pubkey;
                    
                    await executeSQL(
                        `INSERT INTO validator_scores 
                        (pubkey, proposer_address, name, uptime_score, pol_score, stake_scaled_booster_score, pol_participation_score, total_score, is_using_default_cutting_board)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            normalizedPubkey,
                            validator.validatorAddress,
                            validator.name,
                            validator.avgUptimeScore.toFixed(2),
                            validator.avgPolScore.toFixed(2),
                            validator.avgStakeScaledBoosterScore.toFixed(2),
                            validator.polParticipationScore.toFixed(2),
                            validator.totalScore.toFixed(2),
                            validator.isUsingDefaultCuttingBoard === true ? 1 : (validator.isUsingDefaultCuttingBoard === false ? 0 : null)
                        ]
                    );
            inserted++;
            
            // Store daily stats if VERBOSE
            if (isVerbose) {
                for (const date of datesToAnalyze) {
                    const dayStats = statistics[date]?.[validator.validatorAddress];
                    if (dayStats) {
                        try {
                            await executeSQL(
                                `INSERT INTO validator_daily_stats 
                                (validator_pubkey, proposer_address, date, total_blocks, empty_blocks, empty_block_percentage, 
                                 uptime_score, pol_score, stake_scaled_booster_score, stake, boost, pol_ratio, 
                                 vaults_usd, boosters_usd, stake_scaled_booster_value)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    normalizedPubkey,
                                    validator.validatorAddress,
                                    date,
                                    dayStats.totalBlocks || 0,
                                    dayStats.emptyBlocks || 0,
                                    dayStats.emptyBlockPercentage || 0,
                                    dayStats.uptimeScore || 0,
                                    dayStats.polScore || 0,
                                    dayStats.stakeScaledBoosterScore || 0,
                                    dayStats.stake || 0,
                                    dayStats.boost || 0,
                                    dayStats.polRatio || 0,
                                    dayStats.vaultsUSD || 0,
                                    dayStats.boostersUSD || 0,
                                    dayStats.stakeScaledBoosterValue || 0
                                ]
                            );
                            dailyStatsInserted++;
                        } catch (error) {
                            log(`⚠️  Failed to insert daily stats for ${validator.name} on ${date}: ${error.message}`);
                        }
                    }
                }
            }
            
            // Generate and insert notes for this validator
            const notes = generateValidatorNotes(validator, statistics, totalVotingPowerByDate, sortedDates);
            for (const note of notes) {
                try {
                        // Use normalized pubkey for notes as well
                        const normalizedPubkey = validator.pubkey && !validator.pubkey.startsWith('0x') 
                            ? '0x' + validator.pubkey 
                            : validator.pubkey;
                        await executeSQL(
                            'INSERT INTO validator_notes (validator_pubkey, note_type, note_message) VALUES (?, ?, ?)',
                            [normalizedPubkey, note.type, note.message]
                        );
                } catch (error) {
                    log(`⚠️  Failed to insert note for ${validator.name}: ${error.message}`);
                }
            }
        } catch (error) {
            log(`⚠️  Failed to insert scores for ${validator.name}: ${error.message}`);
        }
    }
    
    // Update metadata
    await executeSQL(
        `UPDATE evaluation_metadata 
        SET evaluation_timestamp = CURRENT_TIMESTAMP,
            start_date = ?,
            end_date = ?,
            days_analyzed = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1`,
        [startDate, endDate, daysAnalyzed]
    );
    
    log(`✅ Written scores for ${inserted} validators to database`);
    if (isVerbose) {
        log(`✅ Written ${dailyStatsInserted} daily stat records to database`);
    }
}

/**
 * Calculates POL Participation scores for all validators
 * Score starts at 100, -10 points per week without activation, -40 points if using default cutting board
 * @param {Object} activationsByValidator - Map of pubkey -> array of activation dates
 * @param {Array<string>} datesToAnalyze - Array of date strings to analyze
 * @param {Array<Object>} validators - Array of validator objects
 * @param {Object} defaultAllocation - Default allocation for comparison (optional)
 * @returns {Promise<Object>} Map of proposer -> POL Participation score
 */
async function calculatePolParticipationScores(activationsByValidator, datesToAnalyze, validators, defaultAllocation = null, lastBlockNumber = 'latest') {
    const scores = {};
    const defaultCuttingBoardFlags = {}; // Map of proposer -> boolean/null
    
    // Group dates by ISO week
    const weekGroups = groupDatesByWeek(datesToAnalyze);
    const weeks = Object.keys(weekGroups).sort();
    
    log(`Calculating POL Participation scores for ${validators.length} validators across ${weeks.length} weeks...`);
    
    // Check default cutting board status for all validators at the last block of the analysis period
    // Fetch default allocation at that same block, then compare each validator's active allocation
    if (defaultAllocation && lastBlockNumber !== 'latest') {
        log(`Checking default cutting board status for ${validators.length} validators at block ${lastBlockNumber}...`);
        
        // First, fetch the default allocation at the last block (it might have changed)
        const defaultAllocationAtLastBlock = await getDefaultRewardAllocation(lastBlockNumber);
        if (!defaultAllocationAtLastBlock) {
            log(`⚠️  Warning: Could not fetch default allocation at block ${lastBlockNumber}, using provided default allocation`);
        }
        const allocationToCompare = defaultAllocationAtLastBlock || defaultAllocation;
        
        const concurrency = 50;
        let checked = 0;
        
        for (let i = 0; i < validators.length; i += concurrency) {
            const batch = validators.slice(i, i + concurrency);
            const batchPromises = batch.map(async (validator) => {
                try {
                    // Check at the last block of the analysis period
                    const isDefault = await isUsingDefaultAllocation(validator.pubkey, allocationToCompare, lastBlockNumber);
                    defaultCuttingBoardFlags[validator.proposer] = isDefault;
                } catch (error) {
                    defaultCuttingBoardFlags[validator.proposer] = null;
                }
            });
            await Promise.all(batchPromises);
            checked += batch.length;
            if (checked % 10 === 0 || checked === validators.length) {
                log(`  Checked ${checked}/${validators.length} validators...`);
            }
        }
    } else if (defaultAllocation) {
        log(`⚠️  Warning: lastBlockNumber not provided, using 'latest' for default cutting board check`);
        // Fallback to latest if block number not provided
        const concurrency = 50;
        let checked = 0;
        
        for (let i = 0; i < validators.length; i += concurrency) {
            const batch = validators.slice(i, i + concurrency);
            const batchPromises = batch.map(async (validator) => {
                try {
                    const isDefault = await isUsingDefaultAllocation(validator.pubkey, defaultAllocation, 'latest');
                    defaultCuttingBoardFlags[validator.proposer] = isDefault;
                } catch (error) {
                    defaultCuttingBoardFlags[validator.proposer] = null;
                }
            });
            await Promise.all(batchPromises);
            checked += batch.length;
            if (checked % 10 === 0 || checked === validators.length) {
                log(`  Checked ${checked}/${validators.length} validators...`);
            }
        }
    }
    
    for (const validator of validators) {
        const pk = validator.pubkey.startsWith('0x') ? validator.pubkey : `0x${validator.pubkey}`;
        const activations = activationsByValidator[pk.toLowerCase()] || [];
        const activationDates = new Set(activations);
        
        // Debug logging for validators with unexpected activations
        if (validator.name.toLowerCase().includes('figment') && activations.length > 0) {
            log(`⚠️  DEBUG: ${validator.name} has ${activations.length} activations detected: ${JSON.stringify([...activations].sort())}`);
            log(`   Pubkey: ${pk}, Lowercase: ${pk.toLowerCase()}`);
        }
        
        // Count weeks with at least one activation
        let weeksWithActivation = 0;
        for (const week of weeks) {
            const weekDates = weekGroups[week];
            const hasActivation = weekDates.some(date => activationDates.has(date));
            if (hasActivation) {
                weeksWithActivation++;
            }
        }
        
        // Calculate base score: 100 - (10 * weeks without activation)
        const weeksWithoutActivation = weeks.length - weeksWithActivation;
        let score = 100 - (weeksWithoutActivation * 10);
        
        // Apply 40 point penalty if using default cutting board
        // If detection failed (null) but validator has 0 activations, assume default
        const isUsingDefault = defaultCuttingBoardFlags[validator.proposer];
        const shouldApplyPenalty = isUsingDefault === true || 
            (isUsingDefault === null && activations.length === 0 && weeksWithActivation === 0);
        
        if (shouldApplyPenalty) {
            score = Math.max(0, score - 40);
            if (process.env.VERBOSE || activations.length > 0) {
                const reason = isUsingDefault === true ? 'detected' : 'assumed (0 activations + detection failed)';
                log(`  ${validator.name}: Using default cutting board (${reason}), activations: ${activations.length}, weeks with activation: ${weeksWithActivation}/${weeks.length}, final score: ${score.toFixed(2)}`);
            }
        } else if (process.env.VERBOSE && activations.length === 0) {
            log(`  ${validator.name}: No activations detected, but not using default cutting board (detected: ${isUsingDefault}), score: ${score.toFixed(2)}`);
        }
        
        score = Math.max(0, score); // Clamp to 0 minimum
        
        scores[validator.proposer] = {
            score,
            isUsingDefault: shouldApplyPenalty ? true : (isUsingDefault === false ? false : null)
        };
    }
    
    return scores;
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
    // collect tokens (only booster tokens, BGT vault emissions not used in scoring)
    const tokenSet = new Set();
    for (const date of Object.keys(dayRanges)) {
        const perDate = dailyAgg[date] || {};
        for (const proposer of Object.keys(perDate)) {
            const boosters = perDate[proposer]?.boosters || {};
            Object.keys(boosters).forEach(t => tokenSet.add(t));
        }
    }
    
    // Fetch decimals, names, and rates in parallel using pipeline
    const tokenList = Array.from(tokenSet);
    
    log(`Fetching decimals for ${tokenList.length} unique tokens...`);
    const decimalsWorkerFn = async (token, index, provider) => {
        await getTokenDecimals(provider, token);
        return token;
    };
    const decimalsPipeline = new Pipeline(MAX_WORKER_COUNT, decimalsWorkerFn, 'Fetching token decimals');
    await decimalsPipeline.process(tokenList, () => provider, false);
    
    log(`Fetching names for ${tokenList.length} unique tokens...`);
    const namesWorkerFn = async (token, index, provider) => {
        await getTokenName(provider, token);
        return token;
    };
    const namesPipeline = new Pipeline(MAX_WORKER_COUNT, namesWorkerFn, 'Fetching token names');
    await namesPipeline.process(tokenList, () => provider, false);
    
    log(`Fetching USD rates for ${tokenList.length} unique tokens...`);
    // For API rate limiting, use smaller concurrency for USD rates
    const rateWorkerFn = async (token, index, provider) => {
        const tokenName = tokenNameCache.get(token) || token.substring(0, 8) + '...';
        log(`Fetching rate for token ${index + 1}/${tokenList.length}: ${tokenName} (${token})`);
        await getUsdRatePerToken(token);
        // Small delay to be respectful to the API (done per worker)
        await new Promise(resolve => setTimeout(resolve, 50));
        return token;
    };
    // Use smaller concurrency for API calls (rate limiting)
    const ratesPipeline = new Pipeline(Math.min(MAX_WORKER_COUNT, 6), rateWorkerFn, 'Fetching USD rates');
    await ratesPipeline.process(tokenList, null, true);
    
    const perTokenRates = {};
    for (const token of tokenSet) perTokenRates[token] = tokenUsdRateCache.get(token) ?? 0;
    
    // compute per day per validator USD using BigInt math
    // Note: vaultsUSD is always 0 since Distributed events are not scanned (not used in scoring)
    const dailyUsd = {}; // date -> proposer -> { vaultsUSD, boostersUSD, totalUSD }
    for (const [date, perDate] of Object.entries(dailyAgg)) {
        dailyUsd[date] = {};
        for (const [proposer, data] of Object.entries(perDate)) {
            const boosters = data.boosters || {};
            
            // vaultsUSD is always 0 (Distributed events not scanned)
            const vaultsUSD = 0;
            
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
const ignoreGenesis = args.includes('--ignore-genesis');

// Show help if requested
if (showHelp) {
    console.log(`
Validator POL Performance Study
        
Usage:
  node validator-scoring.js [options]
        
  Options:
    --days=N          Number of days to analyze (default: 45)
    --end-date=DATE  End date for analysis in YYYY-MM-DD format (default: yesterday)
    --to-date=DATE    Alias for --end-date (for consistency with other scripts)
    --ignore-genesis  Ignore genesis CSV and evaluate ALL current validators from database
    --help, -h        Show this help message
         
  Examples:
    node score-validators.js --days=1                         # Quick test: analyze yesterday only
    node score-validators.js --days=7                         # Analyze last 7 days ending yesterday
    node score-validators.js --days=7 --end-date=2025-01-25   # Analyze 7 days ending on Jan 25, 2025
    node score-validators.js --days=7 --to-date=2025-01-25    # Same as above, using --to-date alias
    node score-validators.js --end-date=2025-01-20            # Analyze 45 days ending on Jan 20, 2025
    node score-validators.js --ignore-genesis                 # Analyze ALL current validators from database
    node score-validators.js                                  # Full analysis: last 45 days (default)
        
Environment Variables:
  EL_ETHRPC_URL         Execution layer RPC endpoint (primary)
  CL_ETHRPC_URL         Consensus layer RPC endpoint (primary)
  EL_ETHRPC_URL_ALT     Execution layer RPC endpoint (alternate)
  CL_ETHRPC_URL_ALT     Consensus layer RPC endpoint (alternate)
                        If alternates are set and differ from primaries, total workers double
                        and half of chunked tasks go to alternates
  VERBOSE               Set to 'true' for verbose logs and detailed CSV output
        
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
        const latestBlockInfo = await provider.getBlock(latestBlock);
        const latestTimestamp = latestBlockInfo.timestamp;
        const boundaries = {};
        const progress = createProgressBar(dates.length, 'Finding boundaries');
        
        for (let i = 0; i < dates.length; i++) {
            const date = dates[i];
            const midnight = new Date(date);
            midnight.setUTCHours(0, 0, 0, 0);
            const targetTimestamp = Math.floor(midnight.getTime() / 1000);
            
            // Check if target date is in the future relative to latest block
            if (targetTimestamp > latestTimestamp) {
                log(`Warning: Date ${date.toISOString().split('T')[0]} is in the future (target: ${targetTimestamp}, latest: ${latestTimestamp}). Using latest block as boundary.`);
                boundaries[date.toISOString().split('T')[0]] = latestBlock;
                progress.update(i + 1);
                continue;
            }
            
            // Use iterative approach like find_day_boundaries.js
            let estimatedBlock;
            if (i === 0) {
                // For the first date, calculate from genesis using block time
                const secondsSinceGenesis = targetTimestamp - GENESIS_TIMESTAMP;
                if (secondsSinceGenesis < 0) {
                    // Date is before genesis, use block 1
                    log(`Warning: Date ${date.toISOString().split('T')[0]} is before genesis. Using block 1 as boundary.`);
                    boundaries[date.toISOString().split('T')[0]] = 1;
                    progress.update(i + 1);
                    continue;
                }
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
            
            // If estimated block is beyond latest block, recalculate from latest block
            if (estimatedBlock > latestBlock) {
                log(`Estimated block ${estimatedBlock} is beyond latest block ${latestBlock}, recalculating from latest block...`);
                // Calculate how many seconds before latest block the target is
                const secondsBeforeLatest = latestTimestamp - targetTimestamp;
                if (secondsBeforeLatest < 0) {
                    // Target is after latest block (shouldn't happen due to earlier check, but handle it)
                    boundaries[date.toISOString().split('T')[0]] = latestBlock;
                    progress.update(i + 1);
                    continue;
                }
                // Estimate blocks before latest (2 second block time)
                const blocksBeforeLatest = Math.floor(secondsBeforeLatest / 2);
                estimatedBlock = Math.max(1, latestBlock - blocksBeforeLatest);
            }
            
            // Use binary search with proper bounds tracking
            let low = 1;
            let high = latestBlock;
            let candidateBlock = estimatedBlock;
            let attempts = 0;
            const maxAttempts = 100; // Binary search should converge much faster
            
            // Clamp initial estimate to valid range
            candidateBlock = Math.max(1, Math.min(latestBlock, candidateBlock));
            
            while (attempts < maxAttempts && low <= high) {
                attempts++;
                numGuesses++;
                
                try {
                    // Use binary search midpoint if we haven't found a good candidate yet
                    if (candidateBlock < low || candidateBlock > high) {
                        candidateBlock = Math.floor((low + high) / 2);
                    }
                    
                    // Ensure candidateBlock is within current bounds
                    candidateBlock = Math.max(low, Math.min(high, candidateBlock));
                    
                    // Get current block and previous block timestamps
                    const currentBlock = await provider.getBlock(candidateBlock);
                    if (!currentBlock) {
                        // If we can't get this block, narrow the search range
                        low = candidateBlock + 1;
                        candidateBlock = Math.floor((low + high) / 2);
                        continue;
                    }
                    
                    const currentTimestamp = currentBlock.timestamp;
                    
                    // Handle edge case where candidateBlock is 1
                    if (candidateBlock === 1) {
                        if (currentTimestamp >= targetTimestamp) {
                            boundaries[date.toISOString().split('T')[0]] = 1;
                            break;
                        }
                        // Block 1 is before target, so we need to search forward
                        low = 2;
                        candidateBlock = Math.floor((low + high) / 2);
                        continue;
                    }
                    
                    // Get previous block
                    const prevBlock = await provider.getBlock(candidateBlock - 1);
                    if (!prevBlock) {
                        low = candidateBlock + 1;
                        candidateBlock = Math.floor((low + high) / 2);
                        continue;
                    }
                    
                    const prevTimestamp = prevBlock.timestamp;
                    
                    // Check if we have the correct boundary
                    if (currentTimestamp >= targetTimestamp && prevTimestamp < targetTimestamp) {
                        boundaries[date.toISOString().split('T')[0]] = candidateBlock;
                        break;
                    }
                    
                    // Update binary search bounds
                    if (currentTimestamp < targetTimestamp) {
                        // Current block is before target, need to search higher
                        low = candidateBlock + 1;
                    } else {
                        // Current block is at or after target, need to search lower
                        high = candidateBlock - 1;
                    }
                    
                    // Calculate next candidate using binary search
                    candidateBlock = Math.floor((low + high) / 2);
                    
                } catch (error) {
                    log(`Error getting block ${candidateBlock}: ${error.message}`);
                    // On error, try to narrow the search range
                    if (candidateBlock > 1) {
                        high = candidateBlock - 1;
                        candidateBlock = Math.floor((low + high) / 2);
                    } else {
                        low = candidateBlock + 1;
                        candidateBlock = Math.floor((low + high) / 2);
                    }
                }
            }
            
            // If binary search didn't find it, try a linear search in the narrowed range
            if (!boundaries[date.toISOString().split('T')[0]] && low <= high) {
                log(`Binary search didn't find boundary, trying linear search from block ${low} to ${high}...`);
                for (let block = low; block <= high && block <= latestBlock; block++) {
                    try {
                        const currentBlock = await provider.getBlock(block);
                        const prevBlock = block > 1 ? await provider.getBlock(block - 1) : null;
                        
                        if (currentBlock && prevBlock) {
                            if (currentBlock.timestamp >= targetTimestamp && prevBlock.timestamp < targetTimestamp) {
                                boundaries[date.toISOString().split('T')[0]] = block;
                                break;
                            }
                        }
                    } catch (error) {
                        // Continue to next block
                    }
                }
            }
            
            if (!boundaries[date.toISOString().split('T')[0]]) {
                // Provide more diagnostic information
                const dateStr = date.toISOString().split('T')[0];
                log(`Failed to find boundary for ${dateStr} after ${attempts} attempts. Target timestamp: ${targetTimestamp}, Latest block: ${latestBlock}, Latest timestamp: ${latestTimestamp}`);
                throw new Error(`No boundary block found for date: ${dateStr} after ${attempts} attempts. Target timestamp: ${targetTimestamp}, latest block timestamp: ${latestTimestamp}`);
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
    const totalVotingPowerByDate = {};
    
    // Create work items for each date
    const dateWorkItems = Object.entries(dayBoundaries).map(([date, blockNumber]) => ({
        date,
        blockNumber
    }));
    
    // Worker function that processes a single date
    const dateWorkerFn = async (workItem, index, provider) => {
        const { date, blockNumber } = workItem;
        stakeBoostData[date] = {};
        
        try {
            // Get voting power for all validators at this block
            const votingPowerData = await getValidatorVotingPower(blockNumber);
            
            // Calculate total voting power across ALL validators (not just the ones we're tracking)
            let totalVotingPower = 0;
            if (votingPowerData) {
                totalVotingPower = Object.values(votingPowerData).reduce((sum, v) => sum + (v.voting_power || 0), 0);
                totalVotingPowerByDate[date] = totalVotingPower;
            } else {
                totalVotingPowerByDate[date] = 0;
            }
            
            if (votingPowerData && process.env.VERBOSE) {
                log(`Collected voting power data for ${Object.keys(votingPowerData).length} validators at block ${blockNumber}`);
                log(`Total stake at block ${blockNumber}: ${totalVotingPower.toLocaleString()} BERA`);
            } else if (!votingPowerData) {
                log(`No voting power data collected for block ${blockNumber}`);
            }
            
            // Get boost data for all validators in parallel for this date
            const validatorWorkItems = validators.map(validator => ({
                validator,
                blockNumber,
                votingPowerData,
                date
            }));
            
            const validatorWorkerFn = async (validatorWorkItem, idx, provider) => {
                const { validator, blockNumber: bn, votingPowerData: vpd } = validatorWorkItem;
                return {
                    proposer: validator.proposer,
                    data: await collectValidatorData(validator, bn, vpd)
                };
            };
            
            // Use pipeline to process validators in parallel for this date
            const pipeline = new Pipeline(MAX_WORKER_COUNT, validatorWorkerFn, `Collecting boost for ${date}`);
            const validatorResults = await pipeline.process(validatorWorkItems, null, false);
            
            // Store results
            validatorResults.forEach(result => {
                if (result && result.proposer) {
                    stakeBoostData[date][result.proposer] = result.data;
                }
            });
            
            // Log collected stake data summary (only in verbose mode)
            if (process.env.VERBOSE) {
                const totalStake = Object.values(stakeBoostData[date]).reduce((sum, data) => sum + data.stake, 0);
                log(`Stake data collected for ${date}: total stake = ${totalStake.toLocaleString()} BERA`);
            }
            
            return { success: true };
        } catch (error) {
            log(`Error collecting voting power data for ${date}: ${error.message}`);
            totalVotingPowerByDate[date] = 0;
            // Set default values for all validators on this date
            for (const validator of validators) {
                stakeBoostData[date][validator.proposer] = {
                    stake: 0,
                    boost: 0,
                    ratio: 0
                };
            }
            return { success: false };
        }
    };
    
    // Process all dates sequentially to avoid overwhelming consensus layer API
    // Each date worker calls getValidatorVotingPower which can cause socket hang ups if too concurrent
    const pipeline = new Pipeline(1, dateWorkerFn, 'Collecting stake/boost');
    await pipeline.process(dateWorkItems, null, true);
    
    return { stakeBoostData, totalVotingPowerByDate };
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
    
    // Create a set of study validator proposers for fast lookup
    const studyValidatorProposers = new Set(validators.map(v => v.proposer));
    
    // Filter blockResults to only include study validators
    const filteredBlockResults = new Map();
    for (const [proposer, validatorData] of blockResults) {
        if (studyValidatorProposers.has(proposer)) {
            filteredBlockResults.set(proposer, validatorData);
        }
    }
    
    // Calculate PER-DAY maximums for proper normalization
    // Each day is normalized independently so the best validator each day gets 100%
    // IMPORTANT: Only consider study validators (genesis or all, depending on --ignore-genesis flag)
    const dayMaxRatios = {}; // date -> max ratio for that day
    const dayMaxStakeScaledBoosterReturns = {}; // date -> max stake-scaled booster returns for that day
    
    // First pass: find per-day maximums (only among study validators)
    for (const date of datesToProcess) {
        // Filter ratios to only study validators
        const dayRatios = validators.map(validator => {
            const data = stakeBoostData[date]?.[validator.proposer];
            return data?.ratio || 0;
        });
        dayMaxRatios[date] = Math.max(...dayRatios, 0);
        
        const dayUsd = global.__DAILY_USD__?.[date] || {};
        const dayStakeScaledBoosterReturnsList = validators.map(validator => {
            const stake = stakeBoostData[date]?.[validator.proposer]?.stake || 0;
            const boosterValue = dayUsd[validator.proposer]?.boostersUSD || 0;
            return stake > 0 ? boosterValue / stake : 0;
        });
        dayMaxStakeScaledBoosterReturns[date] = Math.max(...dayStakeScaledBoosterReturnsList, 0);
    }
    
    // Second pass: calculate per-day statistics using per-day maximums
    for (let i = 0; i < datesToProcess.length; i++) {
        const date = datesToProcess[i];
        const nextDate = sortedDates[i + 1];
        const dayStartBlock = dayBoundaries[date];
        if (!nextDate) {
            throw new Error(`No next day block found for date ${date}. This script refuses to guess the end block. If you want to analyze the last day, please provide a complete day range.`);
        }
        const dayEndBlock = dayBoundaries[nextDate] - 1;
        
            // Get economic data for this day
            const dayUsd = global.__DAILY_USD__?.[date] || {};
        
        statistics[date] = {};
        
        // Process each validator's data for this day (only study validators)
        for (const [proposer, validatorData] of filteredBlockResults) {
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
            const dayMaxRatio = dayMaxRatios[date] || 0;
            const polScore = dayMaxRatio > 0 ? (polRatio / dayMaxRatio) * 100 : 0;
                
                // Stake-scaled booster incentive scoring
                const economicData = dayUsd[proposer] || { vaultsUSD: 0, boostersUSD: 0 };
                const stake = stakeBoostData[date]?.[proposer]?.stake || 0;
                const stakeScaledBoosterValue = stake > 0 ? economicData.boostersUSD / stake : 0;
                const dayMaxStakeScaledBooster = dayMaxStakeScaledBoosterReturns[date] || 0;
                const stakeScaledBoosterScore = dayMaxStakeScaledBooster > 0 ? (stakeScaledBoosterValue / dayMaxStakeScaledBooster) * 100 : 0;
            
            statistics[date][proposer] = {
                totalBlocks,
                emptyBlocks: dayEmptyBlocks,
                emptyBlockPercentage,
                uptimeScore,
                polScore,
                    stakeScaledBoosterScore,
                stake: stakeBoostData[date]?.[proposer]?.stake || 0,
                boost: stakeBoostData[date]?.[proposer]?.boost || 0,
                    polRatio,
                    vaultsUSD: economicData.vaultsUSD,
                    boostersUSD: economicData.boostersUSD,
                    stakeScaledBoosterValue
            };
        }
        
        // Add validators that weren't found in blockResults (they had 0 blocks)
        for (const validator of validators) {
            if (!statistics[date][validator.proposer]) {
                const polRatio = stakeBoostData[date]?.[validator.proposer]?.ratio || 0;
                const dayMaxRatio = dayMaxRatios[date] || 0;
                const polScore = dayMaxRatio > 0 ? (polRatio / dayMaxRatio) * 100 : 0;
                    
                    const economicData = dayUsd[validator.proposer] || { vaultsUSD: 0, boostersUSD: 0 };
                    const stake = stakeBoostData[date]?.[validator.proposer]?.stake || 0;
                    const stakeScaledBoosterValue = stake > 0 ? economicData.boostersUSD / stake : 0;
                    const dayMaxStakeScaledBooster = dayMaxStakeScaledBoosterReturns[date] || 0;
                    const stakeScaledBoosterScore = dayMaxStakeScaledBooster > 0 ? (stakeScaledBoosterValue / dayMaxStakeScaledBooster) * 100 : 0;
                
                statistics[date][validator.proposer] = {
                    totalBlocks: 0,
                    emptyBlocks: 0,
                    emptyBlockPercentage: 0,
                    uptimeScore: 100, // Perfect uptime if no blocks
                    polScore,
                        stakeScaledBoosterScore,
                    stake: stakeBoostData[date]?.[validator.proposer]?.stake || 0,
                    boost: stakeBoostData[date]?.[validator.proposer]?.boost || 0,
                        polRatio,
                        vaultsUSD: economicData.vaultsUSD,
                        boostersUSD: economicData.boostersUSD,
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
     * @param {Object} polParticipationScores - Map of proposer -> POL Participation score
     * @returns {Array<Object>} Compiled validator rankings sorted by total score
     * @returns {Object} rankings - Array of validator objects with averaged scores:
     *   - name, addresses, pubkey, all averaged scores, stake, daily breakdowns
     */
function generateReport(statistics, validators, dayBoundaries, polParticipationScores) {
    const sortedDates = Object.keys(dayBoundaries).sort();
    // Only process dates that were actually analyzed (exclude boundary date)
    const datesToAnalyze = sortedDates.slice(0, sortedDates.length - 1);
    const validatorMap = new Map(validators.map(v => [v.proposer, v]));
    
    // Calculate averages for each validator
    const validatorAverages = {};
    
    for (const validator of validators) {
        const uptimeScores = [];
        const polScores = [];
            const stakeScaledBoosterScores = [];
        
        for (const date of datesToAnalyze) {
            const dayStats = statistics[date]?.[validator.proposer];
            if (dayStats) {
                uptimeScores.push(dayStats.uptimeScore);
                polScores.push(dayStats.polScore);
                    stakeScaledBoosterScores.push(dayStats.stakeScaledBoosterScore);
            }
        }
        
        const avgUptimeScore = uptimeScores.length > 0 ? 
            uptimeScores.reduce((sum, score) => sum + score, 0) / uptimeScores.length : 0;
        const avgPolScore = polScores.length > 0 ? 
            polScores.reduce((sum, score) => sum + score, 0) / polScores.length : 0;
            const avgStakeScaledBoosterScore = stakeScaledBoosterScores.length > 0 ? 
            stakeScaledBoosterScores.reduce((sum, score) => sum + score, 0) / stakeScaledBoosterScores.length : 0;
            const polParticipationData = polParticipationScores[validator.proposer] || { score: 0, isUsingDefault: null };
            const polParticipationScore = typeof polParticipationData === 'object' ? polParticipationData.score : polParticipationData;
            const isUsingDefaultCuttingBoard = typeof polParticipationData === 'object' ? polParticipationData.isUsingDefault : null;
            
            // Equal weighting of all 4 metrics
            const totalScore = (avgUptimeScore + avgPolScore + polParticipationScore + avgStakeScaledBoosterScore) / 4;
        
        // Get most recent stake from the last analyzed date
        const lastAnalyzedDate = datesToAnalyze[datesToAnalyze.length - 1];
        const mostRecentStake = statistics[lastAnalyzedDate]?.[validator.proposer]?.stake || 0;
        
        validatorAverages[validator.proposer] = {
            name: validator.name,
            validatorAddress: validator.proposer,
            operatorAddress: validator.operatorAddress,
            pubkey: validator.pubkey,
            avgUptimeScore,
            avgPolScore,
                polParticipationScore,
                avgStakeScaledBoosterScore,
            totalScore,
            stake: mostRecentStake,
            days: datesToAnalyze.map(date => ({
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
            'POL Part.'.padEnd(12) +
            'Incentive/Stake'.padEnd(16) +
        'Stake (BERA)'
    );
        log('-'.repeat(140));
    
    rankings.forEach((validator, index) => {
            const line = `${(index + 1).toString().padEnd(6)}${validator.name.padEnd(30)}${validator.totalScore.toFixed(2).padEnd(8)}${validator.avgUptimeScore.toFixed(2).padEnd(8)}${validator.avgPolScore.toFixed(2).padEnd(12)}${validator.polParticipationScore.toFixed(2).padEnd(12)}${validator.avgStakeScaledBoosterScore.toFixed(2).padEnd(16)}${validator.stake.toLocaleString()}`;
        log(line);
    });
        log('='.repeat(140));
    
    // CSV output
        let csvHeader = 'Validator name,Pubkey,Proposer,Operator,Stake,Uptime Score,Boost/Stake Ratio Score,Incentive→User/Stake Score,POL Participation Score,Total Score';
    
        if (showFullDetail) {
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
            let row = `${validator.name},${validator.pubkey},${validator.validatorAddress},${validator.operatorAddress},${validator.stake.toFixed(6)},${validator.avgUptimeScore.toFixed(2)},${validator.avgPolScore.toFixed(2)},${validator.avgStakeScaledBoosterScore.toFixed(2)},${validator.polParticipationScore.toFixed(2)},${validator.totalScore.toFixed(2)}`;
        
            if (showFullDetail) {
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
                    // Add booster tokens (BGT vault emissions not scanned, so vaultBgtBI is always 0)
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
            const rate = tokenUsdRateCache.get(token) || 0;
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
        // Support both --end-date=DATE and --to-date=DATE formats
        const endDateArg = args.find(arg => arg.startsWith('--end-date='))?.split('=')[1] ||
                          args.find(arg => arg.startsWith('--to-date='))?.split('=')[1];
            
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
        const validators = await loadValidators(ignoreGenesis);
        if (validators.length === 0) {
            throw new Error('No validators loaded');
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
        const { stakeBoostData, totalVotingPowerByDate } = await collectStakeAndBoost(validators, dayBoundaries);
        
        // Index POL events per day (BGT to vaults, booster tokens)
        const { daily: polDaily } = await indexPolEvents(validators, dayRanges);
        
        // Scan BeraChef activations for POL Participation scoring
        log('\nScanning BeraChef activations for POL Participation...');
        const activationsByValidator = await scanBeraChefActivations(validators, dayRanges);
        
        // Get dates to analyze for POL Participation
        const datesForPolParticipation = Object.keys(dayRanges).sort();
        
        // Get the last block of the analysis period (last day's end block)
        const lastDate = datesForPolParticipation[datesForPolParticipation.length - 1];
        const lastBlockNumber = dayRanges[lastDate]?.endBlock || 'latest';
        
        // Fetch default allocation at the last block to compare against validators' current allocations
        const defaultAllocation = await getDefaultRewardAllocation(lastBlockNumber);
        const polParticipationScores = await calculatePolParticipationScores(activationsByValidator, datesForPolParticipation, validators, defaultAllocation, lastBlockNumber);
        
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
        const rankings = generateReport(statistics, validators, dayBoundaries, polParticipationScores);
        
        // Write scores to database
        log('\nWriting scores to database...');
        try {
            await initializeScoringSchema();
            const firstDay = dates[0].toISOString().split('T')[0];
            const lastDay = dates[dates.length - 2].toISOString().split('T')[0]; // -2 because last date is boundary
            await writeScoresToDatabase(rankings, firstDay, lastDay, daysToAnalyze, statistics, totalVotingPowerByDate, sortedDates);
        } catch (error) {
            log(`⚠️  Warning: Failed to write to database: ${error.message}`);
            log(`Stack trace: ${error.stack}`);
            // Don't fail the entire script if DB write fails
        }
        
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
