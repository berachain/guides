const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Define constants for table column names and sorting keys
const COL_PROPOSER = 'Proposer';
const COL_AVG_TXS_PER_BLOCK = 'Avg Txs/Block';
const COL_GAS_PERCENT_LIMIT = 'Gas % of 30M Limit';
const COL_PROPOSED_BLOCKS = 'Proposed Blocks (# (%))';

async function analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl, sortBy = COL_PROPOSER, sortOrder = 'asc') {
    const proposerStats = {};
    let totalBlocksScanned = 0;
    const GAS_LIMIT_REFERENCE = 30000000; // 30 million gas reference
    const batchSize = 14400;
    
    console.log(`Analyzing blocks ${startBlock} to ${endBlock} with batch size ${batchSize}...`);
    
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
                        gasUsed: block.gasUsed
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
                    
                    if (!proposerStats[proposerAddress]) {
                        proposerStats[proposerAddress] = { 
                            totalTransactions: 0, 
                            blockCount: 0, 
                            totalGasUsed: BigInt(0)
                        };
                    }
                    
                    proposerStats[proposerAddress].totalTransactions += result.transactionCount;
                    proposerStats[proposerAddress].totalGasUsed += result.gasUsed;
                    proposerStats[proposerAddress].blockCount++;
                } catch (error) {
                    console.error(`Error fetching header for block ${result.blockNumber}: ${error.message}`);
                }
            }
        }
        
        console.log(`Processed blocks ${i} to ${batchEnd}`);
    }
    
    console.log(`Total blocks scanned: ${totalBlocksScanned}`);
    
    const tableData = [];
    for (const [proposer, stats] of Object.entries(proposerStats)) {
        const averageTransactions = stats.blockCount > 0 ? stats.totalTransactions / stats.blockCount : 0;
        const averageGasUsedForPercentage = stats.blockCount > 0 ? Number(stats.totalGasUsed) / stats.blockCount : 0;
        const gasPercentageOfLimit = (averageGasUsedForPercentage / GAS_LIMIT_REFERENCE) * 100;

        tableData.push({
            [COL_PROPOSER]: proposer,
            [COL_AVG_TXS_PER_BLOCK]: parseFloat(averageTransactions.toFixed(2)),
            [COL_GAS_PERCENT_LIMIT]: parseFloat(gasPercentageOfLimit.toFixed(2)),
            [COL_PROPOSED_BLOCKS]: stats.blockCount
        });
    }

    tableData.sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];

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
    
    const columnsToPad = [COL_AVG_TXS_PER_BLOCK, COL_GAS_PERCENT_LIMIT, COL_PROPOSED_BLOCKS];
    const maxLengths = {};

    columnsToPad.forEach(column => {
        maxLengths[column] = 0;
        tableData.forEach(row => {
            let valueAsString;
            if (column === COL_PROPOSED_BLOCKS) {
                const blockCount = row[column];
                const percentage = totalBlocksScanned > 0 ? (blockCount / totalBlocksScanned) * 100 : 0;
                valueAsString = `${blockCount} (${percentage.toFixed(2)}%)`;
            } else {
                valueAsString = row[column].toFixed(2);
            }
            if (valueAsString.length > maxLengths[column]) {
                maxLengths[column] = valueAsString.length;
            }
        });
    });

    const formattedTableData = tableData.map(row => {
        const newRow = { [COL_PROPOSER]: row[COL_PROPOSER] };
        columnsToPad.forEach(column => {
            let valueAsString;
            if (column === COL_PROPOSED_BLOCKS) {
                const blockCount = row[column];
                const percentage = totalBlocksScanned > 0 ? (blockCount / totalBlocksScanned) * 100 : 0;
                valueAsString = `${blockCount} (${percentage.toFixed(2)}%)`;
            } else {
                valueAsString = row[column].toFixed(2);
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
    const BLOCKS_TO_SCAN_PRIOR = 43200;
    const DEFAULT_SORT_BY = COL_AVG_TXS_PER_BLOCK;
    const FIXED_SORT_ORDER = 'asc';

    const elRpcPort = process.env.EL_ETHRPC_PORT;
    const clRpcPort = process.env.CL_ETHRPC_PORT;

    if (!elRpcPort || isNaN(parseInt(elRpcPort)) || parseInt(elRpcPort) <= 0 || parseInt(elRpcPort) > 65535) {
        console.error('Error: Environment variable EL_ETHRPC_PORT is not set or is invalid. Please set it to a valid port number (1-65535).');
        process.exit(1);
    }
    if (!clRpcPort || isNaN(parseInt(clRpcPort)) || parseInt(clRpcPort) <= 0 || parseInt(clRpcPort) > 65535) {
        console.error('Error: Environment variable CL_ETHRPC_PORT is not set or is invalid. Please set it to a valid port number (1-65535).');
        process.exit(1);
    }

    const rpcUrl = `http://localhost:${elRpcPort}`;
    const clRpcBaseUrl = `http://localhost:${clRpcPort}`;
    
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
            conflicts: ['g', 'b']
        })
        .option('g', {
            describe: `Sort by ${COL_GAS_PERCENT_LIMIT} (ascending)`,
            type: 'boolean',
            group: 'Sorting Options:',
            conflicts: ['t', 'b']
        })
        .option('b', {
            describe: `Sort by Number of Proposed Blocks (ascending)`,
            type: 'boolean',
            group: 'Sorting Options:',
            conflicts: ['t', 'g']
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
        .usage('Usage: node scan-all-blocks.js [startBlock endBlock] [-t | -g | -b]')
        .epilogue(`Description:\n  Scans a range of blocks from an Ethereum-compatible blockchain to gather proposer statistics.\n  Relies on EL_ETHRPC_PORT and CL_ETHRPC_PORT environment variables for RPC endpoints (e.g., http://localhost:EL_ETHRPC_PORT).\n  If startBlock and endBlock are omitted, scans the prior ${BLOCKS_TO_SCAN_PRIOR} blocks from the current block.\n  Batch size is fixed at 14,400 blocks.\n  Default sort: ${DEFAULT_SORT_BY} (ascending)\n\nRequired Environment Variables:\n  EL_ETHRPC_PORT          Port for the Execution Layer (EL) RPC endpoint (e.g., 8545).\n  CL_ETHRPC_PORT          Port for the Consensus Layer (CL) RPC endpoint for header data (e.g., 50200).\n\nExamples:\n  EL_ETHRPC_PORT=8545 CL_ETHRPC_PORT=50200 node scan-all-blocks.js\n  EL_ETHRPC_PORT=8545 CL_ETHRPC_PORT=50200 node scan-all-blocks.js 1000 2000\n  EL_ETHRPC_PORT=8545 CL_ETHRPC_PORT=50200 node scan-all-blocks.js -g`)
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

