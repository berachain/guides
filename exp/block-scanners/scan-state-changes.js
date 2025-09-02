/**
 * Scan State Changes - Transaction Impact Analyzer
 * 
 * This script analyzes the impact of transactions by tracing their execution and
 * counting state changes. It provides insights into how transactions affect the
 * blockchain state and helps identify high-impact operations.
 * 
 * Features:
 * - Uses debug_traceTransaction to analyze transaction execution
 * - Counts state changes per transaction
 * - Provides histogram analysis of state change patterns
 * - Supports custom block ranges and batch processing
 * - Requires EL_ETHRPC_URL environment variable
 * - Useful for understanding transaction complexity and impact
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Configuration
const BATCH_SIZE = 100; // Number of blocks to process in parallel
const BLOCKS_TO_SCAN_PRIOR = 43200; // Default number of blocks to scan if no range provided

// Verify required environment variables
const requiredEnvVars = ['EL_ETHRPC_URL'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('Error: Missing required environment variables:');
    missingEnvVars.forEach(envVar => console.error(`- ${envVar}`));
    process.exit(1);
}

/**
 * Trace a transaction using the execution layer RPC
 * @param {string} elRpcUrl - The execution layer RPC URL
 * @param {string} txHash - The transaction hash to trace
 * @returns {Promise<Object|null>} - The trace result or null if failed
 */
async function traceTransaction(elRpcUrl, txHash) {
    try {
        const response = await axios.post(elRpcUrl, {
            jsonrpc: '2.0',
            method: 'debug_traceTransaction',
            params: [txHash, {
                tracer: 'prestateTracer',
                tracerConfig: {
                    diffMode: true
                }
            }],
            id: 1
        });

        if (response.data.error) {
            console.error(`Trace error for ${txHash}:`, response.data.error);
            return null;
        }

        return response.data.result;
    } catch (error) {
        console.error(`Failed to trace transaction ${txHash}:`, error.message);
        return null;
    }
}

/**
 * Count state changes from a transaction trace result
 * @param {Object} traceResult - The trace result from debug_traceTransaction
 * @param {Array} transactions - Array of transaction objects (should be single transaction)
 * @returns {Promise<Array>} - Array of state change counts, one per transaction
 */
async function countStateChanges(traceResult, transactions) {
    if (!traceResult || !transactions || transactions.length === 0) {
        return transactions.map(() => 0);
    }

    const stateChangeCounts = [];
    
    // Count the number of items in the 'post' object, which represents state changes
    let stateChangeCount = 0;
    
    if (traceResult && typeof traceResult === 'object') {
        if (traceResult.post && typeof traceResult.post === 'object') {
            // Count the number of addresses that had state changes
            stateChangeCount = Object.keys(traceResult.post).length;
        } else if (traceResult.length !== undefined) {
            // Fallback: if it has a length property, count it
            stateChangeCount = traceResult.length;
        } else if (Array.isArray(traceResult)) {
            stateChangeCount = traceResult.length;
        } else {
            // If it's an object but no post or length, count it as 1
            stateChangeCount = 1;
        }
    }
    
    // Return the same count for all transactions (should be just one)
    for (const tx of transactions) {
        stateChangeCounts.push(stateChangeCount);
    }
    
    return stateChangeCounts;
}

async function scanStateChanges(provider, elRpcUrl, selector, startBlock, endBlock) {
    const stateChangeCounts = new Map(); // Map to store histogram data with sample transaction
    let totalTransactionsFound = 0;
    let totalTransactionsTraced = 0;
    let totalTransactionsFailed = 0;
    let totalTransactionsScanned = 0;

    console.log(`Scanning blocks ${startBlock} to ${endBlock} for selector: ${selector} in batches of ${BATCH_SIZE}`);

    const totalBlocks = endBlock - startBlock + 1;
    let processedBlocks = 0;

    for (let blockNum = startBlock; blockNum <= endBlock; blockNum += BATCH_SIZE) {
        const batchEnd = Math.min(blockNum + BATCH_SIZE - 1, endBlock);
        const promises = [];

        for (let i = blockNum; i <= batchEnd; i++) {
            promises.push(
                provider.getBlock(i, false)
                    .then(block => ({
                        blockNumber: i,
                        transactionHashes: block.transactions || []
                    }))
                    .catch(error => ({
                        blockNumber: i,
                        error: error.message
                    }))
            );
        }

        const results = await Promise.all(promises);

        for (const result of results) {
            processedBlocks++;

            if (result.error) {
                console.error(`Error fetching block ${result.blockNumber}: ${result.error}`);
                continue;
            }

            totalTransactionsScanned += result.transactionHashes.length;

            // Collect matching transactions for this block
            const matchingTransactions = [];

            for (const txHash of result.transactionHashes) {
                try {
                    // Fetch transaction using direct RPC
                    const txResponse = await axios.post(elRpcUrl, {
                        jsonrpc: '2.0',
                        method: 'eth_getTransactionByHash',
                        params: [txHash],
                        id: 1
                    });
                    if (txResponse.data.error || !txResponse.data.result) {
                        console.error(`Failed to fetch transaction ${txHash} via RPC:`, txResponse.data.error || 'No result');
                        continue;
                    }
                    const tx = txResponse.data.result;

                    // Check if transaction has input data and matches selector
                    if (tx.input && tx.input.length >= 10) {
                        const txSelector = tx.input.substring(0, 10);
                        if (txSelector.toLowerCase() === selector.toLowerCase()) {
                            matchingTransactions.push(tx);
                            totalTransactionsFound++;
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching transaction ${txHash}:`, error.message);
                }
            }

            // Trace each matching transaction individually
            if (matchingTransactions.length > 0) {
                const perTransactionStateChanges = [];
                
                for (const tx of matchingTransactions) {
                    const traceResult = await traceTransaction(elRpcUrl, tx.hash);
                    
                    if (traceResult) {
                        const stateChangeCount = await countStateChanges(traceResult, [tx]);
                        perTransactionStateChanges.push(stateChangeCount[0]);
                    } else {
                        perTransactionStateChanges.push(0);
                        totalTransactionsFailed++;
                    }
                }
                
                totalTransactionsTraced += matchingTransactions.length;
                perTransactionStateChanges.forEach((count, index) => {
                    if (stateChangeCounts.has(count)) {
                        const existing = stateChangeCounts.get(count);
                        stateChangeCounts.set(count, {
                            count: existing.count + 1,
                            sampleTx: matchingTransactions[index].hash // Use the most recent transaction
                        });
                    } else {
                        stateChangeCounts.set(count, {
                            count: 1,
                            sampleTx: matchingTransactions[index].hash
                        });
                    }
                });
            }

            if (processedBlocks % (BATCH_SIZE * 1) === 0 || processedBlocks === totalBlocks) {
                console.log(`Progress: ${processedBlocks}/${totalBlocks} blocks processed`);
            }
        }
    }

    // Print histogram of state changes
    console.log(`\n============================================================`);
    console.log(`STATE CHANGES HISTOGRAM`);
    console.log(`============================================================`);
    console.log(`State Changes | Count | Sample Transaction`);
    console.log(`-------------|-------|-------------------`);
    
    const sortedCounts = Array.from(stateChangeCounts.entries()).sort((a, b) => a[0] - b[0]);
    for (const [count, data] of sortedCounts) {
        console.log(`${count.toString().padStart(12)} | ${data.count.toString().padStart(5)} | ${data.sampleTx}`);
    }

    console.log(`\n============================================================`);
    console.log(`FINAL RESULTS`);
    console.log(`============================================================`);
    console.log(`Total transactions scanned: ${totalTransactionsScanned}`);
    console.log(`Matching transactions found: ${totalTransactionsFound}`);
    console.log(`Successfully traced: ${totalTransactionsTraced}`);
    console.log(`Failed to trace: ${totalTransactionsFailed}`);
    console.log(`\n`);

    return {
        stateChangeCounts,
        totalTransactionsFound,
        totalTransactionsTraced,
        totalTransactionsFailed,
        totalTransactionsScanned
    };
}

// Main execution function
async function main() {
    const RPC_URL = process.env.EL_ETHRPC_URL;
    
    let startBlock, endBlock;
    let useDefaultBlockRange = true;
    let selector;

    const argv = yargs(hideBin(process.argv))
        .command('$0 <selector> [startBlock] [endBlock]', 'Scan blocks for transactions matching a selector. If startBlock and endBlock are omitted, scans the prior 1000 blocks.', (yargs) => {
            yargs
                .positional('selector', {
                    describe: 'The function selector to search for (e.g., 0xa9059cbb)',
                    type: 'string',
                    demandOption: true
                })
                .positional('startBlock', {
                    describe: 'The first block in the range to scan',
                    type: 'number'
                })
                .positional('endBlock', {
                    describe: 'The last block in the range to scan',
                    type: 'number'
                });
        })
        .check((argv) => {
            const { startBlock: sb, endBlock: eb } = argv;
            if (sb !== undefined && eb === undefined) {
                throw new Error('If startBlock is provided, endBlock must also be provided.');
            }
            if (sb === undefined && eb !== undefined) {
                throw new Error('If endBlock is provided, startBlock must also be provided.');
            }
            if (sb !== undefined && eb !== undefined) {
                if (sb < 0) {
                    throw new Error('startBlock cannot be negative.');
                }
                if (eb < sb) {
                    throw new Error('endBlock must be greater than or equal to startBlock.');
                }
            }
            return true;
        })
        .alias('h', 'help')
        .usage('Usage: node scan-state-changes.js <selector> [startBlock endBlock]')
        .epilogue(`Description:\n  Scans a range of blocks for transactions matching a specific function selector.\n  Uses EL_ETHRPC_URL environment variable for RPC endpoint.\n  If startBlock and endBlock are omitted, scans the prior ${BLOCKS_TO_SCAN_PRIOR} blocks from the current block.\n  Batch size is fixed at ${BATCH_SIZE} blocks.\n\nRequired Environment Variables:\n  EL_ETHRPC_URL           EL RPC endpoint\n`)
        .fail((msg, err, yargs) => {
            if (err) throw err; // Preserve stack
            console.error('Error:', msg);
            console.error("Run with --help for usage details.");
            process.exit(1);
        })
        .strict()
        .argv;

    selector = argv.selector;

    if (argv.startBlock !== undefined && argv.endBlock !== undefined) {
        startBlock = argv.startBlock;
        endBlock = argv.endBlock;
        useDefaultBlockRange = false;
    } else {
        useDefaultBlockRange = true;
    }

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        
        if (useDefaultBlockRange) {
            console.log(`No specific block range provided. Fetching current block and scanning prior ${BLOCKS_TO_SCAN_PRIOR} blocks.`);
            try {
                const currentBlockNumber = await provider.getBlockNumber();
                endBlock = currentBlockNumber;
                startBlock = currentBlockNumber - BLOCKS_TO_SCAN_PRIOR;
            } catch (error) {
                console.error('Error fetching current block number:', error.message);
                process.exit(1);
            }
        } else {
            console.log(`Using provided start block: ${startBlock}, end block: ${endBlock}.`);
        }
                
        const results = await scanStateChanges(provider, RPC_URL, selector, startBlock, endBlock);
        
    } catch (error) {
        console.error('Error in main execution:', error);
        process.exit(1);
    }
}

// Export the function for use in other modules
module.exports = {
    scanStateChanges,
    traceTransaction,
    countStateChanges
};

// Run the script if called directly
if (require.main === module) {
    main();
} 
