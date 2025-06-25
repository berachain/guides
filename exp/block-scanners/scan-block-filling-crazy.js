const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Define constants for table column names and sorting keys
const COL_PROPOSER = 'Proposer';
const COL_CLIENT = 'Client';

// Weekly block count (7,200 blocks/day * 7 days)
const BLOCKS_PER_WEEK = 50400;

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

async function analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl) {
    const allProposerStats = {};
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
                        nonce: block.nonce,
                        timestamp: block.timestamp,
                        extraData: block.extraData
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
                    
                    if (!allProposerStats[proposerTitle]) {
                        allProposerStats[proposerTitle] = { 
                            blockData: [],
                            extraData: result.extraData
                        };
                    }
                    
                    allProposerStats[proposerTitle].blockData.push({
                        blockNumber: result.blockNumber,
                        transactionCount: result.transactionCount,
                        gasUsed: result.gasUsed,
                        timestamp: result.timestamp,
                        isEmpty: result.transactionCount === 0
                    });
                } catch (error) {
                    console.error(`Error fetching header for block ${result.blockNumber}: ${error.message}`);
                }
            }
        }
        
        console.log(`Processed blocks ${i} to ${batchEnd} (${totalBlocksScanned}/${totalItems})`);
    }
    
    console.log(`Total blocks scanned: ${totalBlocksScanned}`);
    
    // Break into weekly ranges
    const weeklyRanges = [];
    for (let i = startBlock; i <= endBlock; i += BLOCKS_PER_WEEK) {
        const weekEnd = Math.min(i + BLOCKS_PER_WEEK - 1, endBlock);
        weeklyRanges.push({ start: i, end: weekEnd });
    }
    
    // Get week dates and process weekly data
    const weeklyData = [];
    for (const range of weeklyRanges) {
        try {
            const firstBlock = await provider.getBlock(range.start);
            const lastBlock = await provider.getBlock(range.end);
            
            // Skip if we can't get the blocks
            if (!firstBlock || !lastBlock) {
                console.warn(`Skipping week range ${range.start}-${range.end}: Could not fetch blocks`);
                continue;
            }
            
            const weekStartDate = new Date(firstBlock.timestamp * 1000);
            const weekEndDate = new Date(lastBlock.timestamp * 1000);
            
            const weekStats = {
                startBlock: range.start,
                endBlock: range.end,
                startDate: weekStartDate,
                endDate: weekEndDate,
                dateLabel: `${weekStartDate.toISOString().split('T')[0]} to ${weekEndDate.toISOString().split('T')[0]}`,
                proposerStats: {}
            };
            
            // Filter stats for this week
            for (const [proposer, stats] of Object.entries(allProposerStats)) {
                const weekBlocks = stats.blockData.filter(block => 
                    block.blockNumber >= range.start && block.blockNumber <= range.end
                );
                
                if (weekBlocks.length > 0) {
                    const totalTransactions = weekBlocks.reduce((sum, block) => sum + block.transactionCount, 0);
                    const totalGasUsed = weekBlocks.reduce((sum, block) => sum + Number(block.gasUsed), 0);
                    const emptyBlocks = weekBlocks.filter(block => block.isEmpty).length;
                    
                    weekStats.proposerStats[proposer] = {
                        blocks: weekBlocks.length,
                        emptyBlocks: emptyBlocks,
                        emptyBlockPercent: weekBlocks.length > 0 ? (emptyBlocks / weekBlocks.length) * 100 : 0,
                        avgTxsPerBlock: weekBlocks.length > 0 ? totalTransactions / weekBlocks.length : 0,
                        avgGasPercent: weekBlocks.length > 0 ? (totalGasUsed / weekBlocks.length / GAS_LIMIT_REFERENCE) * 100 : 0,
                        sampleBlock: weekBlocks[weekBlocks.length - 1].blockNumber, // Last block in range
                        client: await decodeExtraDataAsAscii(stats.extraData)
                    };
                }
            }
            
            weeklyData.push(weekStats);
        } catch (error) {
            console.error(`Error processing week range ${range.start}-${range.end}: ${error.message}`);
        }
    }
    
    // Generate CSV output
    generateCSVOutput(weeklyData, allProposerStats);
}

function generateCSVOutput(weeklyData, allProposerStats) {
    if (weeklyData.length === 0) {
        console.log("No weekly data to export.");
        return;
    }
    
    // Get all unique proposers across all weeks
    const allProposers = new Set();
    weeklyData.forEach(week => {
        Object.keys(week.proposerStats).forEach(proposer => allProposers.add(proposer));
    });
    
    const sortedProposers = Array.from(allProposers).sort();
    
    // Create CSV content
    let csvContent = '';
    
    // Header row 1: Week dates spanning multiple columns
    csvContent += 'Proposer,Client,';
    weeklyData.forEach((week, index) => {
        const columnsPerWeek = 6; // blocks, empty blocks, empty%, avg txs, avg gas%, sample block
        csvContent += `"${week.dateLabel}",`.repeat(columnsPerWeek - 1);
        csvContent += `"${week.dateLabel}"`;
        if (index < weeklyData.length - 1) csvContent += ',';
    });
    csvContent += '\n';
    
    // Header row 2: Column names
    csvContent += 'Proposer,Client,';
    weeklyData.forEach((week, weekIndex) => {
        csvContent += 'Blocks,Empty Blocks,Empty Block%,Avg Txs/Block,Avg Gas%,Sample Block';
        if (weekIndex < weeklyData.length - 1) csvContent += ',';
    });
    csvContent += '\n';
    
    // Data rows
    sortedProposers.forEach(proposer => {
        csvContent += `"${proposer}",`;
        
        // Get client info from first week where this proposer appears
        let client = 'N/A';
        for (const week of weeklyData) {
            if (week.proposerStats[proposer]) {
                client = week.proposerStats[proposer].client;
                break;
            }
        }
        csvContent += `"${client}",`;
        
        // Add data for each week
        weeklyData.forEach((week, weekIndex) => {
            const stats = week.proposerStats[proposer];
            if (stats) {
                csvContent += `${stats.blocks},${stats.emptyBlocks},${stats.emptyBlockPercent.toFixed(2)},${stats.avgTxsPerBlock.toFixed(2)},${stats.avgGasPercent.toFixed(2)},${stats.sampleBlock}`;
            } else {
                csvContent += ',,,,,'; // Empty cells for weeks when proposer didn't participate
            }
            if (weekIndex < weeklyData.length - 1) csvContent += ',';
        });
        csvContent += '\n';
    });
    
    // Write to file
    const filename = `proposer_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    fs.writeFileSync(filename, csvContent);
    console.log(`\nCSV report saved to: ${filename}`);
    console.log(`\nReport includes ${weeklyData.length} weeks and ${sortedProposers.length} proposers.`);
}

// Example usage
async function main() {
    const elRpcUrlEnv = process.env.EL_ETHRPC_URL;
    const elRpcPortEnv = process.env.EL_ETHRPC_PORT;
    const clRpcUrlEnv = process.env.CL_ETHRPC_URL;
    const clRpcPortEnv = process.env.CL_ETHRPC_PORT;
    
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
        .usage('Usage: node scan-block-filling-crazy.js [startBlock endBlock]')
        .epilogue(`Description:\n  Scans a range of blocks from an Ethereum-compatible blockchain to gather proposer statistics.\n  Relies on EL_ETHRPC_URL and CL_ETHRPC_URL environment variables for RPC endpoints.\n  If startBlock and endBlock are omitted, scans the prior 43,200 blocks.\n  Outputs results as CSV with weekly breakdowns.\n\nRequired Environment Variables:\n  EL_ETHRPC_URL           EL RPC endpoint\n  EL_ETHRPC_PORT          EL RPC port on localhost\n  CL_ETHRPC_URL           CL RPC endpoint\n  CL_ETHRPC_PORT          CL RPC port on localhost\n`)
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

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    if (useDefaultBlockRange) {
        console.log(`No specific block range provided. Fetching current block and scanning prior 43,200 blocks.`);
        try {
            const currentBlockNumber = await provider.getBlockNumber();
            endBlock = currentBlockNumber;
            startBlock = currentBlockNumber - 43200;
            console.log(`Will scan from block ${startBlock} to ${endBlock} (current).`);
        } catch (error) {
            console.error('Error fetching current block number:', error.message);
            process.exit(1);
        }
    } else {
        console.log(`Using provided start block: ${startBlock}, end block: ${endBlock}.`);
    }
    
    try {
        console.log(`Analyzing proposers. EL RPC: ${rpcUrl}, CL RPC: ${clRpcBaseUrl}`);
        await analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl);
    } catch (error) {
        console.error('Error during analysis execution:', error.message);
    }
}

main();

