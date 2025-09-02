/**
 * Scan Transactions by Client - Client Usage Analyzer
 * 
 * This script analyzes transaction patterns by execution client by examining
 * block extraData and transaction data. It provides insights into which
 * clients are being used by validators and how they perform.
 * 
 * Features:
 * - Decodes extraData to identify execution client types and versions
 * - Analyzes transaction patterns per client
 * - Tracks method call frequencies and gas usage
 * - Provides detailed client performance metrics
 * - Supports custom block ranges and batch processing
 * - Requires EL_ETHRPC_URL environment variable
 * - Useful for client diversity analysis and performance monitoring
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');

// Configuration
const BATCH_SIZE = 100; // Number of blocks to process in parallel
const BLOCKS_TO_SCAN_PRIOR = 43200; // Default number of blocks to scan if no range provided
const MIN_CALL_THRESHOLD = 50; // Minimum calls for a method to be included in reports

// Verify required environment variables
const requiredEnvVars = ['EL_ETHRPC_URL'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('Error: Missing required environment variables:');
    missingEnvVars.forEach(envVar => console.error(`- ${envVar}`));
    process.exit(1);
}

/**
 * Decode extraData to identify execution client
 * Extracted from scan-block-filling-crazy.js
 */
async function decodeExtraDataAsAscii(extraData) {
    if (!extraData || extraData === '0x') {
        return 'Reth?';
    }
    
    try {
        // Remove '0x' prefix if present
        const hexString = extraData.startsWith('0x') ? extraData.slice(2) : extraData;
        
        // Convert hex to bytes
        const bytes = [];
        for (let i = 0; i < hexString.length; i += 2) {
            bytes.push(parseInt(hexString.substr(i, 2), 16));
        }
        
        // Try to decode as RLP first
        const rlpDecoded = decodeRLP(bytes);
        if (rlpDecoded && Array.isArray(rlpDecoded)) {
            // Check if we have exactly 4 fields
            if (rlpDecoded.length === 4) {
                const firstField = rlpDecoded[0];
                const secondField = rlpDecoded[1];
                
                // Check if first field has length 3 or 4 (likely a version number)
                if (firstField && (firstField.length === 3 || firstField.length === 4)) {
                    // First field is binary values with version number
                    // Second field is client name as ASCII
                    if (secondField && typeof secondField === 'string' && secondField.trim().length > 0) {
                        const clientName = secondField.replace(/[\x00-\x1F\x7F]/g, '').trim();
                        if (clientName.length > 0) {
                            // Convert the raw bytes of firstField to version string
                            const versionBytes = Array.from(firstField).map(char => char.charCodeAt(0));
                            const versionString = versionBytes.join('.');
                            return `${clientName} v${versionString}`;
                        }
                    }
                }
            }
            
            // Fallback to original logic for other cases
            const cleanItems = rlpDecoded
                .map(item => item.replace(/[\x00-\x1F\x7F]/g, '').trim())
                .filter(item => item.length > 0);
            
            if (cleanItems.length >= 3) {
                const client = cleanItems[0] || 'unknown';
                
                // Only return if we have meaningful data
                if (client && client !== 'unknown') {
                    return `${client}`;
                }
            }
        }
        
        // Fallback: try direct ASCII conversion
        const asciiString = String.fromCharCode(...bytes);
        const isValidAscii = /^[\x20-\x7E]*$/.test(asciiString);
        
        if (isValidAscii && asciiString.trim().length > 0) {
            return asciiString.trim();
        } else {
            return `Hex: ${extraData}`;
        }
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

function decodeRLP(bytes) {
    if (bytes.length === 0) return null;
    
    const firstByte = bytes[0];
    
    // Single byte
    if (firstByte < 0x80) {
        return String.fromCharCode(firstByte);
    }
    
    // String with length < 56
    if (firstByte < 0xb8) {
        const length = firstByte - 0x80;
        if (length === 0) return '';
        const data = bytes.slice(1, 1 + length);
        return data.map(b => String.fromCharCode(b)).join('');
    }
    
    // String with length >= 56
    if (firstByte < 0xc0) {
        const lengthBytes = firstByte - 0xb7;
        const length = parseInt(bytes.slice(1, 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        const data = bytes.slice(1 + lengthBytes, 1 + lengthBytes + length);
        return data.map(b => String.fromCharCode(b)).join('');
    }
    
    // List with length < 56
    if (firstByte < 0xf8) {
        const length = firstByte - 0xc0;
        const data = bytes.slice(1, 1 + length);
        return decodeRLPList(data);
    }
    
    // List with length >= 56
    if (firstByte < 0x100) {
        const lengthBytes = firstByte - 0xf7;
        const length = parseInt(bytes.slice(1, 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        const data = bytes.slice(1 + lengthBytes, 1 + lengthBytes + length);
        return decodeRLPList(data);
    }
    
    return null;
}

function decodeRLPList(bytes) {
    const result = [];
    let offset = 0;
    
    while (offset < bytes.length) {
        const item = decodeRLP(bytes.slice(offset));
        if (item === null) break;
        
        // Find the length of this item
        const firstByte = bytes[offset];
        let itemLength = 1;
        
        if (firstByte >= 0x80 && firstByte < 0xb8) {
            itemLength = 1 + (firstByte - 0x80);
        } else if (firstByte >= 0xb8 && firstByte < 0xc0) {
            const lengthBytes = firstByte - 0xb7;
            itemLength = 1 + lengthBytes + parseInt(bytes.slice(offset + 1, offset + 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        } else if (firstByte >= 0xc0 && firstByte < 0xf8) {
            itemLength = 1 + (firstByte - 0xc0);
        } else if (firstByte >= 0xf8) {
            const lengthBytes = firstByte - 0xf7;
            itemLength = 1 + lengthBytes + parseInt(bytes.slice(offset + 1, offset + 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        }
        
        result.push(item);
        offset += itemLength;
    }
    
    return result;
}

/**
 * Scan blocks for contract calls and track execution clients
 */
async function scanContractCalls(provider, elRpcUrl, startBlock, endBlock, filterSelector = null) {
    const contractStats = new Map(); // contractAddress -> { methods: Map(selector -> { clientCounts: Map(client -> count), totalGasPrice: BigInt, callCount: number }), totalCalls: number, totalGasPrice: BigInt }
    let totalTransactionsScanned = 0;
    let totalContractCalls = 0;
    let totalBlocksScanned = 0;

    const selectorMsg = filterSelector ? ` matching selector ${filterSelector}` : '';
    console.log(`Scanning blocks ${startBlock} to ${endBlock} for contract calls${selectorMsg} in batches of ${BATCH_SIZE}`);

    const totalBlocks = endBlock - startBlock + 1;
    let processedBlocks = 0;

    for (let blockNum = startBlock; blockNum <= endBlock; blockNum += BATCH_SIZE) {
        const batchEnd = Math.min(blockNum + BATCH_SIZE - 1, endBlock);
        const promises = [];

        for (let i = blockNum; i <= batchEnd; i++) {
            promises.push(
                provider.getBlock(i, false) // Get block with transaction hashes only
                    .then(block => ({
                        blockNumber: i,
                        transactionHashes: block.transactions || [],
                        extraData: block.extraData
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
            totalBlocksScanned++;

            if (result.error) {
                console.error(`Error fetching block ${result.blockNumber}: ${result.error}`);
                continue;
            }

            totalTransactionsScanned += result.transactionHashes.length;

            // Decode client from extraData
            const client = await decodeExtraDataAsAscii(result.extraData);

            // Process each transaction hash by fetching the full transaction
            for (const txHash of result.transactionHashes) {
                try {
                    // Fetch transaction using direct RPC (same approach as scan-state-changes.js)
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

                    // Check if transaction has a 'to' address and input data (contract call)
                    if (tx.to && tx.input && tx.input.length >= 10) {
                        const txSelector = tx.input.substring(0, 10);
                        
                        // Apply selector filter if provided
                        if (filterSelector && txSelector.toLowerCase() !== filterSelector.toLowerCase()) {
                            continue;
                        }
                        
                        totalContractCalls++;
                        
                        const contractAddress = tx.to.toLowerCase();
                        const selector = txSelector;
                        const gasPrice = BigInt(tx.gasPrice || '0');

                        // Initialize contract stats if not exists
                        if (!contractStats.has(contractAddress)) {
                            contractStats.set(contractAddress, {
                                methods: new Map(),
                                totalCalls: 0,
                                totalGasPrice: BigInt(0)
                            });
                        }

                        const contractData = contractStats.get(contractAddress);
                        contractData.totalCalls++;
                        contractData.totalGasPrice += gasPrice;

                        // Initialize method stats if not exists
                        if (!contractData.methods.has(selector)) {
                            contractData.methods.set(selector, {
                                clientCounts: new Map(),
                                totalGasPrice: BigInt(0),
                                callCount: 0
                            });
                        }

                        const methodData = contractData.methods.get(selector);
                        methodData.callCount++;
                        methodData.totalGasPrice += gasPrice;
                        
                        // Increment client count for this method
                        const currentCount = methodData.clientCounts.get(client) || 0;
                        methodData.clientCounts.set(client, currentCount + 1);
                    }
                } catch (error) {
                    console.error(`Error fetching transaction ${txHash}:`, error.message);
                }
            }

            if (processedBlocks % (BATCH_SIZE * 1) === 0 || processedBlocks === totalBlocks) {
                console.log(`Progress: ${processedBlocks}/${totalBlocks} blocks processed`);
            }
        }
    }

    console.log(`\n============================================================`);
    console.log(`SCAN RESULTS`);
    console.log(`============================================================`);
    console.log(`Total blocks scanned: ${totalBlocksScanned}`);
    console.log(`Total transactions scanned: ${totalTransactionsScanned}`);
    console.log(`Total contract calls found: ${totalContractCalls}`);
    console.log(`Unique contracts found: ${contractStats.size}`);

    return contractStats;
}

/**
 * Filter contracts that have at least one method called 50+ times
 */
function filterContractsByThreshold(contractStats) {
    const filteredContracts = new Map();

    for (const [contractAddress, contractData] of contractStats) {
        let hasQualifyingMethod = false;

        // Check if any method meets the threshold
        for (const [selector, methodData] of contractData.methods) {
            const totalCalls = Array.from(methodData.clientCounts.values()).reduce((sum, count) => sum + count, 0);
            if (totalCalls >= MIN_CALL_THRESHOLD) {
                hasQualifyingMethod = true;
                break;
            }
        }

        if (hasQualifyingMethod) {
            filteredContracts.set(contractAddress, contractData);
        }
    }

    return filteredContracts;
}

/**
 * Generate summary CSV report (contract address -> client counts)
 */
function generateSummaryReport(contractStats, filename) {
    const allClients = new Set();
    
    // Collect all unique clients
    for (const [contractAddress, contractData] of contractStats) {
        for (const [selector, methodData] of contractData.methods) {
            for (const client of methodData.clientCounts.keys()) {
                allClients.add(client);
            }
        }
    }

    const sortedClients = Array.from(allClients).sort();
    
    // Create CSV content
    let csvContent = 'Contract Address,Total Calls,Average Gas Price (Gwei),' + sortedClients.join(',') + '\n';

    // Sort contracts by total calls (descending)
    const sortedContracts = Array.from(contractStats.entries())
        .sort(([,a], [,b]) => b.totalCalls - a.totalCalls);

    for (const [contractAddress, contractData] of sortedContracts) {
        const clientTotals = new Map();
        
        // Aggregate client counts across all methods for this contract
        for (const [selector, methodData] of contractData.methods) {
            for (const [client, count] of methodData.clientCounts) {
                const currentTotal = clientTotals.get(client) || 0;
                clientTotals.set(client, currentTotal + count);
            }
        }

        // Calculate average gas price for this contract (convert from wei to gwei)
        const avgGasPrice = contractData.totalCalls > 0 
            ? Number(contractData.totalGasPrice) / contractData.totalCalls / 1e9
            : 0;

        csvContent += `"${contractAddress}",${contractData.totalCalls},${avgGasPrice.toFixed(5)}`;
        
        for (const client of sortedClients) {
            const count = clientTotals.get(client) || 0;
            csvContent += `,${count}`;
        }
        
        csvContent += '\n';
    }

    fs.writeFileSync(filename, csvContent);
    console.log(`Summary report saved to: ${filename}`);
}

/**
 * Generate detailed CSV report (contract address + selector -> client counts)
 */
function generateDetailReport(contractStats, filename) {
    const allClients = new Set();
    
    // Collect all unique clients
    for (const [contractAddress, contractData] of contractStats) {
        for (const [selector, methodData] of contractData.methods) {
            for (const client of methodData.clientCounts.keys()) {
                allClients.add(client);
            }
        }
    }

    const sortedClients = Array.from(allClients).sort();
    
    // Create CSV content
    let csvContent = 'Contract Address,Method Selector,Total Calls,Average Gas Price (Gwei),' + sortedClients.join(',') + '\n';

    // Sort contracts by total calls, then methods by their call count
    const sortedContracts = Array.from(contractStats.entries())
        .sort(([,a], [,b]) => b.totalCalls - a.totalCalls);

    for (const [contractAddress, contractData] of sortedContracts) {
        // Sort methods by total calls (descending)
        const sortedMethods = Array.from(contractData.methods.entries())
            .map(([selector, methodData]) => {
                const totalCalls = Array.from(methodData.clientCounts.values()).reduce((sum, count) => sum + count, 0);
                return [selector, methodData, totalCalls];
            })
            .sort(([,, a], [,, b]) => b - a);

        for (const [selector, methodData, totalCalls] of sortedMethods) {
            // Calculate average gas price for this method (convert from wei to gwei)
            const avgGasPrice = methodData.callCount > 0 
                ? Number(methodData.totalGasPrice) / methodData.callCount / 1e9
                : 0;

            csvContent += `"${contractAddress}","${selector}",${totalCalls},${avgGasPrice.toFixed(5)}`;
            
            for (const client of sortedClients) {
                const count = methodData.clientCounts.get(client) || 0;
                csvContent += `,${count}`;
            }
            
            csvContent += '\n';
        }
    }

    fs.writeFileSync(filename, csvContent);
    console.log(`Detail report saved to: ${filename}`);
}

// Main execution function
async function main() {
    const RPC_URL = process.env.EL_ETHRPC_URL;
    
    let startBlock, endBlock, selector;
    let useDefaultBlockRange = true;

    const argv = yargs(hideBin(process.argv))
        .command('$0 [startBlock] [endBlock] [selector]', 'Scan blocks for contract calls and track execution clients. If startBlock and endBlock are omitted, scans the prior 43,200 blocks.', (yargs) => {
            yargs
                .positional('startBlock', {
                    describe: 'The first block in the range to scan',
                    type: 'number'
                })
                .positional('endBlock', {
                    describe: 'The last block in the range to scan',
                    type: 'number'
                })
                .positional('selector', {
                    describe: 'Optional function selector to filter by (e.g., 0xa9059cbb)',
                    type: 'string'
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
        .usage('Usage: node scan-transactions.js [startBlock endBlock] [selector]')
        .epilogue(`Description:\n  Scans a range of blocks for smart contract calls and tracks which execution clients sealed them.\n  Uses EL_ETHRPC_URL environment variable for RPC endpoint.\n  If startBlock and endBlock are omitted, scans the prior ${BLOCKS_TO_SCAN_PRIOR} blocks from the current block.\n  If selector is provided, only includes calls matching that function selector.\n  Only includes contracts where at least one method is called ${MIN_CALL_THRESHOLD}+ times.\n  Generates two CSV reports: summary (by contract) and detail (by contract + method).\n  Both reports include average gas price analysis in Gwei.\n\nRequired Environment Variables:\n  EL_ETHRPC_URL           EL RPC endpoint\n`)
        .fail((msg, err, yargs) => {
            if (err) throw err; // Preserve stack
            console.error('Error:', msg);
            console.error("Run with --help for usage details.");
            process.exit(1);
        })
        .strict()
        .argv;

    if (argv.startBlock !== undefined && argv.endBlock !== undefined) {
        startBlock = argv.startBlock;
        endBlock = argv.endBlock;
        useDefaultBlockRange = false;
    } else {
        useDefaultBlockRange = true;
    }

    selector = argv.selector || null;

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

        // Scan for contract calls
        const contractStats = await scanContractCalls(provider, RPC_URL, startBlock, endBlock, selector);

        // Filter contracts by threshold
        const filteredStats = filterContractsByThreshold(contractStats);
        
        console.log(`Contracts meeting threshold (${MIN_CALL_THRESHOLD}+ calls for any method): ${filteredStats.size}`);

        if (filteredStats.size === 0) {
            console.log('No contracts meet the minimum call threshold. No reports generated.');
            return;
        }

        // Generate reports
        const timestamp = new Date().toISOString().split('T')[0];
        const selectorSuffix = selector ? `_${selector.replace('0x', '')}` : '';
        const summaryFilename = `contract_calls_summary${selectorSuffix}_${timestamp}.csv`;
        const detailFilename = `contract_calls_detail${selectorSuffix}_${timestamp}.csv`;

        // Calculate and display gas price statistics
        let totalGasPrice = BigInt(0);
        let totalCalls = 0;
        let maxAvgGasPrice = 0;
        let minAvgGasPrice = Number.MAX_VALUE;
        let maxGasPriceContract = '';
        let minGasPriceContract = '';

        for (const [contractAddress, contractData] of filteredStats) {
            totalGasPrice += contractData.totalGasPrice;
            totalCalls += contractData.totalCalls;
            
            const avgGasPrice = contractData.totalCalls > 0 
                ? Number(contractData.totalGasPrice) / contractData.totalCalls / 1e9
                : 0;
                
            if (avgGasPrice > maxAvgGasPrice) {
                maxAvgGasPrice = avgGasPrice;
                maxGasPriceContract = contractAddress;
            }
            if (avgGasPrice < minAvgGasPrice) {
                minAvgGasPrice = avgGasPrice;
                minGasPriceContract = contractAddress;
            }
        }

        const overallAvgGasPrice = totalCalls > 0 ? Number(totalGasPrice) / totalCalls / 1e9 : 0;

        console.log(`\n============================================================`);
        console.log(`GAS PRICE ANALYSIS`);
        console.log(`============================================================`);
        console.log(`Overall average gas price: ${overallAvgGasPrice.toFixed(5)} Gwei`);
        console.log(`Highest average gas price: ${maxAvgGasPrice.toFixed(5)} Gwei (${maxGasPriceContract})`);
        console.log(`Lowest average gas price: ${minAvgGasPrice.toFixed(5)} Gwei (${minGasPriceContract})`);

        generateSummaryReport(filteredStats, summaryFilename);
        generateDetailReport(filteredStats, detailFilename);

        console.log(`\nReports generated for ${filteredStats.size} contracts.`);
        
    } catch (error) {
        console.error('Error in main execution:', error);
        process.exit(1);
    }
}

// Export the function for use in other modules
module.exports = {
    scanContractCalls,
    decodeExtraDataAsAscii
};

// Run the script if called directly
if (require.main === module) {
    main();
} 
