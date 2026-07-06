/**
 * Scan Block Filling - Block Utilization Analyzer
 * 
 * This script analyzes how well validators are utilizing block space by examining
 * transaction counts, gas usage, and block filling patterns. It provides insights
 * into validator performance and network efficiency.
 * 
 * Features:
 * - Analyzes block utilization and transaction density
 * - Identifies client types from extraData decoding
 * - Tracks validator performance metrics
 * - Provides detailed block filling statistics
 * - Integrates with validator database for naming
 * - Supports custom block range analysis
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const { ValidatorNameDB, ConfigHelper } = require('./lib/shared-utils');

// Define constants for table column names and sorting keys
const COL_PROPOSER = 'Proposer';
const COL_AVG_TXS_PER_BLOCK = 'Avg Txs/Block';
const COL_GAS_PERCENT_LIMIT = 'Avg Gas%';
const COL_PROPOSED_BLOCKS = 'Blocks';
const COL_EMPTY_BLOCKS = 'Empty Blocks';
const COL_SAMPLE_BLOCKS = 'Sample Blocks';
const COL_CLIENT = 'Client';

// Initialize the validator database once
const validatorDB = new ValidatorNameDB();

async function getProposerTitle(proposerAddress) {
    try {
        const name = await validatorDB.getValidatorName(proposerAddress);
        return name || proposerAddress;
    } catch (error) {
        // If there's any error, just return the address
        return proposerAddress;
    }
}

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

// Simple progress bar implementation
function createProgressBar(total, width = 40) {
    let current = 0;
    
    const update = (value) => {
        current = value;
        const percent = Math.round((current / total) * 100);
        const filled = Math.round((width * current) / total);
        const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
        process.stderr.write(`\r    Progress: [${bar}] ${percent}% (${current}/${total})`);
    };
    
    const finish = () => {
        process.stderr.write('\n');
    };
    
    return { update, finish };
}

// Function to get block data with proposer info
async function getBlockDataWithProposer(provider, blockNumber, clRpcBaseUrl) {
    try {
        const [block, headerResponse] = await Promise.all([
            provider.getBlock(blockNumber),
            axios.get(`${clRpcBaseUrl}/header?height=${blockNumber}`)
        ]);
        
        if (!block) {
            throw new Error(`Block ${blockNumber} not found`);
        }
        
        const proposerAddress = headerResponse.data.result.header.proposer_address;
        const proposerTitle = await getProposerTitle(proposerAddress);
        
        return {
            blockNumber: blockNumber,
            transactionCount: block.transactions ? block.transactions.length : 0,
            gasUsed: block.gasUsed,
            proposerAddress: proposerAddress,
            proposerTitle: proposerTitle,
            extraData: block.extraData
        };
    } catch (error) {
        return {
            blockNumber: blockNumber,
            error: error.message
        };
    }
}

// Function to process blocks in chunks with controlled concurrency
async function processBlocksInChunks(provider, blockNumbers, clRpcBaseUrl, concurrency, batchSize) {
    const results = [];
    
    // Split blocks into chunks of batchSize
    const chunks = [];
    for (let i = 0; i < blockNumbers.length; i += batchSize) {
        chunks.push(blockNumbers.slice(i, i + batchSize));
    }
    
    const progressBar = createProgressBar(blockNumbers.length);
    let processedBlocks = 0;
    
    // Process chunks with controlled concurrency
    for (let i = 0; i < chunks.length; i += concurrency) {
        const chunkBatch = chunks.slice(i, i + concurrency);
        const chunkPromises = chunkBatch.map(chunk => 
            Promise.all(chunk.map(blockNum => getBlockDataWithProposer(provider, blockNum, clRpcBaseUrl)))
        );
        
        const chunkResults = await Promise.all(chunkPromises);
        
        // Flatten and merge results
        chunkResults.forEach(chunkResult => {
            results.push(...chunkResult);
        });
        
        // Update progress bar
        processedBlocks += chunkBatch.reduce((sum, chunk) => sum + chunk.length, 0);
        progressBar.update(Math.min(processedBlocks, blockNumbers.length));
    }
    
    progressBar.finish();
    return results;
}

async function analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl, sortBy = COL_PROPOSER, sortOrder = 'asc', concurrency = 16, batchSize = 1000) {
    const proposerStats = {};
    let totalBlocksScanned = 0;
    const GAS_LIMIT_REFERENCE = 36000000; 
    
    const blockNumbers = [];
    for (let i = startBlock; i <= endBlock; i++) {
        blockNumbers.push(i);
    }
    
    console.log(`Analyzing blocks ${startBlock} to ${endBlock} with concurrency ${concurrency} and batch size ${batchSize}...`);
    
    // Process blocks in parallel chunks
    const results = await processBlocksInChunks(provider, blockNumbers, clRpcBaseUrl, concurrency, batchSize);
    
    // Process results and build stats
    for (const result of results) {
        totalBlocksScanned++;
        if (result.error) {
            console.error(`Error processing block ${result.blockNumber}: ${result.error}`);
        } else {
            const proposerTitle = result.proposerTitle;
            
            if (!proposerStats[proposerTitle]) {
                proposerStats[proposerTitle] = { 
                    totalTransactions: 0, 
                    blockCount: 0, 
                    totalGasUsed: BigInt(0),
                    emptyBlockCount: 0,
                    blockNumbers: [],
                    extraData: result.extraData
                };
            }
            
            proposerStats[proposerTitle].totalTransactions += result.transactionCount;
            proposerStats[proposerTitle].totalGasUsed += BigInt(result.gasUsed);
            proposerStats[proposerTitle].blockCount++;
            proposerStats[proposerTitle].blockNumbers.push(result.blockNumber);
            if (result.transactionCount <= 1) {
                proposerStats[proposerTitle].emptyBlockCount++;
            }
            
            // Store extraData from first encountered block
            if (!proposerStats[proposerTitle].extraData) {
                proposerStats[proposerTitle].extraData = result.extraData;
            }
        }
    }
    
    console.log(`Total blocks scanned: ${totalBlocksScanned}`);
    
    // Calculate overall averages
    let totalTransactionsAcrossAll = 0;
    let totalGasUsedAcrossAll = BigInt(0);
    let totalBlocksAcrossAll = 0;
    
    for (const stats of Object.values(proposerStats)) {
        totalTransactionsAcrossAll += stats.totalTransactions;
        totalGasUsedAcrossAll += stats.totalGasUsed;
        totalBlocksAcrossAll += stats.blockCount;
    }
    
    const overallAvgTxsPerBlock = totalBlocksAcrossAll > 0 ? totalTransactionsAcrossAll / totalBlocksAcrossAll : 0;
    const overallAvgGasUsed = totalBlocksAcrossAll > 0 ? Number(totalGasUsedAcrossAll) / totalBlocksAcrossAll : 0;
    const overallAvgGasPercent = (overallAvgGasUsed / GAS_LIMIT_REFERENCE) * 100;
    
    const tableData = [];
    for (const [proposer, stats] of Object.entries(proposerStats)) {
        const totalGasUsedNumber = Number(stats.totalGasUsed);
        const averageGasUsedForPercentage = stats.blockCount > 0 ? totalGasUsedNumber / stats.blockCount : 0;
        const gasPercentageOfLimit = (averageGasUsedForPercentage / GAS_LIMIT_REFERENCE) * 100;
        const averageTxsPerBlock = stats.blockCount > 0 ? stats.totalTransactions / stats.blockCount : 0;

        // Select three random blocks
        const sampleBlocks = stats.blockNumbers.length > 0 
            ? stats.blockNumbers
                .sort(() => Math.random() - 0.5)
                .slice(0, 3)
                .join(', ')
            : 'N/A';

        // Decode extraData
        let extraDataDecoded = 'N/A';
        if (stats.extraData) {
            extraDataDecoded = await decodeExtraDataAsAscii(stats.extraData);
        }

        tableData.push({
            [COL_CLIENT]: extraDataDecoded,
            [COL_PROPOSER]: proposer,
            [COL_AVG_TXS_PER_BLOCK]: parseFloat(averageTxsPerBlock.toFixed(2)),
            [COL_GAS_PERCENT_LIMIT]: parseFloat(gasPercentageOfLimit.toFixed(2)),
            [COL_PROPOSED_BLOCKS]: stats.blockCount,
            [COL_EMPTY_BLOCKS]: `${stats.emptyBlockCount}`,
            [COL_SAMPLE_BLOCKS]: sampleBlocks,
            _emptyBlockCount: stats.emptyBlockCount
        });
    }

    tableData.sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];

        if (sortBy === COL_EMPTY_BLOCKS) {
            valA = a._emptyBlockCount;
            valB = b._emptyBlockCount;
        }
        if (sortBy === COL_PROPOSER) {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }
        
        let comparison = 0;
        if (valA > valB) {
            comparison = 1;
        } else if (valA < valB) {
            comparison = -1;
        }
        return sortOrder === 'desc' ? comparison * -1 : comparison;
    });
    
    const columnsToPad = [COL_PROPOSED_BLOCKS, COL_EMPTY_BLOCKS, COL_AVG_TXS_PER_BLOCK, COL_GAS_PERCENT_LIMIT, COL_SAMPLE_BLOCKS];
    const maxLengths = {};

    columnsToPad.forEach(column => {
        maxLengths[column] = 0;
        tableData.forEach(row => {
            let valueAsString;
            if (column === COL_PROPOSED_BLOCKS) {
                valueAsString = row[column].toString();
            } else if (column === COL_EMPTY_BLOCKS) {
                valueAsString = row[column].toString();
            } else {
                valueAsString = row[column].toString();
            }
            if (valueAsString.length > maxLengths[column]) {
                maxLengths[column] = valueAsString.length;
            }
        });
    });

    const formattedTableData = tableData.map(row => {
        // Client first, then Proposer, then other columns
        const newRow = { 
            [COL_CLIENT]: row[COL_CLIENT],
            [COL_PROPOSER]: row[COL_PROPOSER]
        };
        columnsToPad.forEach(column => {
            let valueAsString;
            if (column === COL_PROPOSED_BLOCKS) {
                valueAsString = row[column].toString();
            } else if (column === COL_EMPTY_BLOCKS) {
                valueAsString = row[column].toString();
            } else {
                valueAsString = row[column].toString();
            }
            newRow[column] = valueAsString.padStart(maxLengths[column], ' ');
        });
        return newRow;
    });

    if (formattedTableData.length > 0) {
        console.log("\nProposer Statistics Table:");
        console.table(formattedTableData);
        
        console.log("\n📊 Overall Sample Averages:");
        console.log(`   Average Transactions per Block: ${overallAvgTxsPerBlock.toFixed(2)}`);
        console.log(`   Average Gas Usage: ${overallAvgGasPercent.toFixed(2)}% of block limit`);
        console.log(`   Total Blocks Analyzed: ${totalBlocksAcrossAll}`);
        console.log(`   Total Transactions: ${totalTransactionsAcrossAll.toLocaleString()}`);
    } else {
        console.log("No proposer data collected to display in table.");
    }
}

const SORT_COLUMNS = {
    gas: COL_GAS_PERCENT_LIMIT,
    txs: COL_AVG_TXS_PER_BLOCK,
    blocks: COL_PROPOSED_BLOCKS,
    empty: COL_EMPTY_BLOCKS,
    proposer: COL_PROPOSER,
};

async function resolveBlockRange(provider, { blocks, start, end }) {
    const latest = await provider.getBlockNumber();
    const defaultCount = ConfigHelper.getDefaultBlockCount();

    if (start !== undefined && end !== undefined) {
        if (start < 1) {
            throw new Error('--start must be >= 1');
        }
        if (end < start) {
            throw new Error('--end must be >= --start');
        }
        return {
            startBlock: start,
            endBlock: end,
            blockCount: end - start + 1,
        };
    }

    const count = blocks ?? defaultCount;
    const endBlock = latest;
    const startBlock = Math.max(1, endBlock - count + 1);
    return {
        startBlock,
        endBlock,
        blockCount: endBlock - startBlock + 1,
    };
}

function showHelp() {
    const defaultBlocks = ConfigHelper.getDefaultBlockCount();
    console.log(`
Block Filling Analyzer - proposer utilization statistics

Usage: node analyze-block-filling.js [options]

Range (choose one):
  --blocks=N             Analyze last N blocks from head (default: ${defaultBlocks})
  --start=N              Start block (inclusive). Requires --end
  --end=N                End block (inclusive). Requires --start

Other:
  -c, --chain=NAME       Network: mainnet|bepolia (default: mainnet)
  -s, --sort=COLUMN      Sort results: gas|txs|blocks|empty|proposer (default: gas)
  --concurrency=N        Parallel requests (default: 16)
  --batch-size=N         Blocks per batch (default: 500)
  -h, --help             Show help

Environment (via ../config.js):
  MAINNET_EL_URL / MAINNET_CL_URL     Mainnet RPC endpoints
  BEPOLIA_EL_URL / BEPOLIA_CL_URL     Bepolia RPC endpoints

Examples:
  node analyze-block-filling.js
  node analyze-block-filling.js --blocks=2000
  node analyze-block-filling.js --start=10100000 --end=10101000
  node analyze-block-filling.js --chain=bepolia --sort=txs
`);
}

async function analyzeBlockFilling(chainName = 'mainnet', options = {}) {
    const {
        blocks,
        start,
        end,
        sort = 'gas',
        concurrency = 16,
        batchSize = 500,
    } = options;

    const sortBy = SORT_COLUMNS[sort];
    if (!sortBy) {
        throw new Error(`Invalid sort column: ${sort}`);
    }
    const sortOrder = 'desc';

    const rpcUrl = ConfigHelper.getRpcUrl('el', chainName);
    const clRpcBaseUrl = ConfigHelper.getBlockScannerUrl(chainName);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const { startBlock, endBlock, blockCount } = await resolveBlockRange(provider, { blocks, start, end });
    console.log(`Analyzing ${blockCount.toLocaleString()} blocks (${startBlock.toLocaleString()} to ${endBlock.toLocaleString()})`);
    console.log(`Sort: ${sortBy} (${sortOrder}). EL RPC: ${rpcUrl}, CL RPC: ${clRpcBaseUrl}`);
    console.log(`Performance settings: concurrency=${concurrency}, batch-size=${batchSize}`);

    await analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl, sortBy, sortOrder, concurrency, batchSize);
}

// CLI handling
if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .option('blocks', {
            alias: 'b',
            type: 'number',
            description: `Number of blocks to analyze from head (default: ${ConfigHelper.getDefaultBlockCount()})`,
        })
        .option('start', {
            type: 'number',
            description: 'Start block (inclusive). Requires --end',
        })
        .option('end', {
            type: 'number',
            description: 'End block (inclusive). Requires --start',
        })
        .option('chain', {
            alias: 'c',
            type: 'string',
            default: 'mainnet',
            choices: ['mainnet', 'bepolia'],
            description: 'Network: mainnet|bepolia',
        })
        .option('sort', {
            alias: 's',
            type: 'string',
            default: 'gas',
            choices: Object.keys(SORT_COLUMNS),
            description: 'Sort results by column',
        })
        .option('concurrency', {
            type: 'number',
            default: 16,
            description: 'Number of concurrent requests',
        })
        .option('batch-size', {
            type: 'number',
            default: 500,
            description: 'Number of blocks to process in each batch',
        })
        .option('help', {
            alias: 'h',
            type: 'boolean',
            description: 'Show help',
        })
        .check((argv) => {
            if (argv.start !== undefined && argv.end === undefined) {
                throw new Error('--end is required when --start is provided');
            }
            if (argv.end !== undefined && argv.start === undefined) {
                throw new Error('--start is required when --end is provided');
            }
            return true;
        })
        .strict()
        .help(false)
        .argv;

    if (argv.help) {
        showHelp();
        process.exit(0);
    }

    analyzeBlockFilling(argv.chain, {
        blocks: argv.blocks,
        start: argv.start,
        end: argv.end,
        sort: argv.sort,
        concurrency: argv.concurrency,
        batchSize: argv['batch-size'],
    })
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Error:', error.message);
            process.exit(1);
        });
}

module.exports = { analyzeBlockFilling, analyzeBlockProposers };

