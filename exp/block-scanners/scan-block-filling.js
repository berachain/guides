const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Define constants for table column names and sorting keys
const COL_PROPOSER = 'Proposer';
const COL_AVG_TXS_PER_BLOCK = 'Avg Txs/Block';
const COL_GAS_PERCENT_LIMIT = 'Avg Gas%';
const COL_PROPOSED_BLOCKS = 'Blocks';
const COL_EMPTY_BLOCKS = 'Empty Blocks';
const COL_SAMPLE_BLOCKS = 'Sample Blocks';
const COL_CLIENT = 'Client';

async function getProposerTitle(proposerAddress) {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(__dirname, 'validators.db');
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                // If database doesn't exist or can't be opened, just return the address
                resolve(proposerAddress);
                return;
            }

            db.get('SELECT name FROM validators WHERE address = ?', [proposerAddress], (err, row) => {
                db.close();
                if (err) {
                    resolve(proposerAddress);
                } else if (row && row.name) {
                    resolve(row.name);
                } else {
                    resolve(proposerAddress);
                }
            });
        });
    });
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

async function analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl, sortBy = COL_PROPOSER, sortOrder = 'asc') {
    const proposerStats = {};
    let totalBlocksScanned = 0;
    const GAS_LIMIT_REFERENCE = 36000000; 
    const batchSize = 14400;
    
    console.log(`Analyzing blocks ${startBlock} to ${endBlock} with batch size ${batchSize}...`);
    
    const totalItems = endBlock - startBlock + 1;

    // Process blocks in batches
    for (let i = startBlock; i <= endBlock; i += batchSize) {
        const batchEnd = Math.min(i + batchSize - 1, endBlock);
        const promises = [];
        
        for (let blockNum = i; blockNum <= batchEnd; blockNum++) {
            promises.push(
                provider.getBlock(blockNum)
                    .then(block => ({
                        blockNumber: blockNum,
                        transactionCount: block.transactions ? block.transactions.length : 0,
                        gasUsed: block.gasUsed,
                        nonce: block.nonce
                    }))
                    .catch(error => ({
                        blockNumber: blockNum,
                        error: error.message
                    }))
            );
        }
        
        const results = await Promise.all(promises);
        for (const result of results) {
            totalBlocksScanned++;
            if (result.error) {
                console.error(`Error fetching block ${result.blockNumber}: ${result.error}`);
            } else {
                const url = `${clRpcBaseUrl}/header?height=${result.blockNumber}`;
                try {
                    const response = await axios.get(url);
                    const proposerAddress = response.data.result.header.proposer_address;
                    const proposerTitle = await getProposerTitle(proposerAddress);
                    
                    if (!proposerStats[proposerTitle]) {
                        proposerStats[proposerTitle] = { 
                            totalTransactions: 0, 
                            blockCount: 0, 
                            totalGasUsed: BigInt(0),
                            emptyBlockCount: 0,
                            blockNumbers: []
                        };
                    }
                    
                    proposerStats[proposerTitle].totalTransactions += result.transactionCount;
                    proposerStats[proposerTitle].totalGasUsed += BigInt(result.gasUsed);
                    proposerStats[proposerTitle].blockCount++;
                    proposerStats[proposerTitle].blockNumbers.push(result.blockNumber);
                    if (result.transactionCount === 0) {
                        proposerStats[proposerTitle].emptyBlockCount++;
                    }
                } catch (error) {
                    console.error(`Error fetching header for block ${result.blockNumber}: ${error.message}`);
                }
            }
        }
        
        console.log(`Processed blocks ${i} to ${batchEnd} (${totalBlocksScanned}/${totalItems})`);
    }
    
    console.log(`Total blocks scanned: ${totalBlocksScanned}`);
    
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

        // Get extraData from the first sample block
        let extraDataDecoded = 'N/A';
        if (stats.blockNumbers.length > 0) {
            const firstSampleBlock = stats.blockNumbers[0];
            try {
                const block = await provider.getBlock(firstSampleBlock);
                if (block && block.extraData) {
                    extraDataDecoded = await decodeExtraDataAsAscii(block.extraData);
                }
            } catch (error) {
                extraDataDecoded = `Error: ${error.message}`;
            }
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
    } else {
        console.log("No proposer data collected to display in table.");
    }
}

// Example usage
async function main() {
    const BLOCKS_TO_SCAN_PRIOR = 30;
    const DEFAULT_SORT_BY = COL_GAS_PERCENT_LIMIT;
    const FIXED_SORT_ORDER = 'desc';

    const elRpcUrlEnv = process.env.EL_ETHRPC_URL;
    const elRpcPortEnv = process.env.EL_ETHRPC_PORT;
    const clRpcUrlEnv = process.env.CL_ETHRPC_URL;
    const clRpcPortEnv = process.env.CL_ETHRPC_PORT;
    var totalNonceChanges = 0;
    
    let rpcUrl; // For EL
    let clRpcBaseUrl; // For CL

    if (elRpcUrlEnv && elRpcUrlEnv.startsWith('http')) {
        rpcUrl = elRpcUrlEnv;
    } else if (elRpcPortEnv) {
        const port = parseInt(elRpcPortEnv);
        if (isNaN(port) || port <= 0 || port > 65535) {
            console.error('Error: Environment variable EL_ETHRPC_PORT is invalid. Must be a valid port number (1-65535) if EL_ETHRPC_URL is not set.');
            process.exit(1);
        }
        rpcUrl = `http://localhost:${port}`;
    } else {
        console.error('Error: Missing Execution Layer RPC configuration. Please set either EL_ETHRPC_URL or EL_ETHRPC_PORT environment variable.');
        process.exit(1);
    }

    if (clRpcUrlEnv && clRpcUrlEnv.startsWith('http')) {
        clRpcBaseUrl = clRpcUrlEnv;
    } else if (clRpcPortEnv) {
        const port = parseInt(clRpcPortEnv);
        if (isNaN(port) || port <= 0 || port > 65535) {
            console.error('Error: Environment variable CL_ETHRPC_PORT is invalid. Must be a valid port number (1-65535) if CL_ETHRPC_URL is not set.');
            process.exit(1);
        }
        clRpcBaseUrl = `http://localhost:${port}`;
    } else {
        console.error('Error: Missing Consensus Layer RPC configuration. Please set either CL_ETHRPC_URL or CL_ETHRPC_PORT environment variable.');
        process.exit(1);
    }
    
    let startBlock, endBlock;
    let useDefaultBlockRange = true;
    let sortBy = DEFAULT_SORT_BY;
    let sortOrder = FIXED_SORT_ORDER;

    const argv = yargs(hideBin(process.argv))
        .command('$0 [startBlock] [endBlock]', 'Scan blocks for proposer statistics. If startBlock and endBlock are omitted, scans the prior 43,200 blocks.', (yargs) => {
            yargs
                .positional('startBlock', {
                    describe: 'The first block in the range to scan',
                    type: 'number'
                })
                .positional('endBlock', {
                    describe: 'The last block in the range to scan',
                    type: 'number'
                });
        })
        .option('t', {
            describe: `Sort by ${COL_AVG_TXS_PER_BLOCK} (ascending)`,
            type: 'boolean',
            group: 'Sorting Options:',
            conflicts: ['g', 'b', 'e']
        })
        .option('g', {
            describe: `Sort by ${COL_GAS_PERCENT_LIMIT} (ascending)`,
            type: 'boolean',
            group: 'Sorting Options:',
            conflicts: ['t', 'b', 'e']
        })
        .option('b', {
            describe: `Sort by Number of Proposed Blocks (ascending)`,
            type: 'boolean',
            group: 'Sorting Options:',
            conflicts: ['t', 'g', 'e']
        })
        .option('e', {
            describe: `Sort by Empty Blocks (ascending)`,
            type: 'boolean',
            group: 'Sorting Options:',
            conflicts: ['t', 'g', 'b']
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
        .usage('Usage: node scan-all-blocks.js [startBlock endBlock] [-t | -g | -b | -e]')
        .epilogue(`Description:\n  Scans a range of blocks from an Ethereum-compatible blockchain to gather proposer statistics.\n  Relies on EL_ETHRPC_URL and CL_ETHRPC_URL environment variables for RPC endpoints (e.g., http://localhost:EL_ETHRPC_URL).\n  If startBlock and endBlock are omitted, scans the prior ${BLOCKS_TO_SCAN_PRIOR} blocks from the current block.\n  Batch size is fixed at 14,400 blocks.\n  Default sort: ${DEFAULT_SORT_BY} (ascending)\n\nRequired Environment Variables:\n  EL_ETHRPC_URL           EL RPC endpoint\n  EL_ETHRPC_PORT          EL RPC port on localhost\n  CL_ETHRPC_URL           CL RPC endpoint\n  CL_ETHRPC_PORT          CL RPC port on localhost\n`)
        .fail((msg, err, yargs) => {
            if (err) throw err; // Preserve stack
            console.error('Error:', msg);
            console.error("Run with --help for usage details.");
            process.exit(1);
        })
        .strict()
        .argv;

    if (argv.t) {
        sortBy = COL_AVG_TXS_PER_BLOCK;
    } else if (argv.g) {
        sortBy = COL_GAS_PERCENT_LIMIT;
    } else if (argv.b) {
        sortBy = COL_PROPOSED_BLOCKS;
    } else if (argv.e) {
        sortBy = COL_EMPTY_BLOCKS;
    }

    if (argv.startBlock !== undefined && argv.endBlock !== undefined) {
        startBlock = argv.startBlock;
        endBlock = argv.endBlock;
        useDefaultBlockRange = false;
    } else {
        useDefaultBlockRange = true;
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    if (useDefaultBlockRange) {
        console.log(`No specific block range provided. Fetching current block and scanning prior ${BLOCKS_TO_SCAN_PRIOR} blocks.`);
        try {
            const currentBlockNumber = await provider.getBlockNumber();
            endBlock = currentBlockNumber;
            startBlock = currentBlockNumber - BLOCKS_TO_SCAN_PRIOR;
            console.log(`Will scan from block ${startBlock} to ${endBlock} (current).`);
        } catch (error) {
            console.error('Error fetching current block number:', error.message);
            process.exit(1);
        }
    } else {
        console.log(`Using provided start block: ${startBlock}, end block: ${endBlock}.`);
    }
    
    try {
        console.log(`Analyzing proposers. Sort: ${sortBy} (${sortOrder}). EL RPC: ${rpcUrl}, CL RPC: ${clRpcBaseUrl}`);
        await analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl, sortBy, sortOrder);
    } catch (error) {
        console.error('Error during analysis execution:', error.message);
    }
}

main();

