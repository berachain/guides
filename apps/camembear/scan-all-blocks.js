const { ethers } = require('ethers');
const axios = require('axios');

// Define constants for table column names and sorting keys
const COL_PROPOSER = 'Proposer';
const COL_AVG_TXS_PER_BLOCK = 'Avg Txs/Block';
const COL_GAS_PERCENT_LIMIT = 'Gas % of 30M Limit';
const COL_BLOCKS_IN_SAMPLE = '% Blocks in Sample';

async function analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl, batchSize = 100, sortBy = COL_PROPOSER, sortOrder = 'asc') {
    const proposerStats = {};
    let totalBlocksScanned = 0;
    const GAS_LIMIT_REFERENCE = 30000000; // 30 million gas reference
    
    console.log(`Analyzing blocks ${startBlock} to ${endBlock}...`);
    
    // Process blocks in batches to avoid overwhelming the RPC
    for (let i = startBlock; i <= endBlock; i += batchSize) {
        const batchEnd = Math.min(i + batchSize - 1, endBlock);
        const promises = [];
        
        // Create promises for each block in the batch
        for (let blockNum = i; blockNum <= batchEnd; blockNum++) {
            promises.push(
                provider.getBlock(blockNum)
                    .then(block => ({
                        blockNumber: blockNum,
                        transactionCount: block.transactions ? block.transactions.length : 0,
                        gasUsed: block.gasUsed // Added gasUsed
                    }))
                    .catch(error => ({
                        blockNumber: blockNum,
                        error: error.message
                    }))
            );
        }
        
        // Wait for all promises in the batch to resolve
        const results = await Promise.all(promises);
        
        // Process results
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
                            totalGasUsed: BigInt(0) // Initialize totalGasUsed as BigInt
                        };
                    }
                    
                    proposerStats[proposerAddress].totalTransactions += result.transactionCount;
                    proposerStats[proposerAddress].totalGasUsed += result.gasUsed; // Add BigInt gasUsed
                    proposerStats[proposerAddress].blockCount++;
                } catch (error) {
                    console.error(`Error fetching header for block ${result.blockNumber}: ${error.message}`);
                }
            }
        }
        
        // Progress update
        console.log(`Processed blocks ${i} to ${batchEnd}`);
    }
    
    console.log(`Total blocks scanned: ${totalBlocksScanned}`);
    
    // Calculate statistics and prepare data for the table
    const tableData = [];
    for (const [proposer, stats] of Object.entries(proposerStats)) {
        const averageTransactions = stats.blockCount > 0 ? stats.totalTransactions / stats.blockCount : 0;
        const averageGasUsedForPercentage = stats.blockCount > 0 ? Number(stats.totalGasUsed) / stats.blockCount : 0;
        const gasPercentageOfLimit = (averageGasUsedForPercentage / GAS_LIMIT_REFERENCE) * 100;
        const blocksInSamplePercentage = totalBlocksScanned > 0 ? (stats.blockCount / totalBlocksScanned) * 100 : 0;

        tableData.push({
            [COL_PROPOSER]: proposer,
            [COL_AVG_TXS_PER_BLOCK]: parseFloat(averageTransactions.toFixed(2)),
            [COL_GAS_PERCENT_LIMIT]: parseFloat(gasPercentageOfLimit.toFixed(2)),
            [COL_BLOCKS_IN_SAMPLE]: parseFloat(blocksInSamplePercentage.toFixed(2))
        });
    }

    // Sort tableData based on sortBy and sortOrder
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
    
    // Prepare for padding: Convert numbers to strings and find max lengths for relevant columns
    const columnsToPad = [COL_AVG_TXS_PER_BLOCK, COL_GAS_PERCENT_LIMIT, COL_BLOCKS_IN_SAMPLE];
    const maxLengths = {};

    columnsToPad.forEach(column => {
        maxLengths[column] = 0;
        tableData.forEach(row => {
            const valueAsString = row[column].toFixed(2);
            if (valueAsString.length > maxLengths[column]) {
                maxLengths[column] = valueAsString.length;
            }
        });
    });

    // Format numbers to strings with padding for alignment
    const formattedTableData = tableData.map(row => {
        const newRow = { [COL_PROPOSER]: row[COL_PROPOSER] };
        columnsToPad.forEach(column => {
            const valueAsString = row[column].toFixed(2);
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
    const DEFAULT_BATCH_SIZE = 3600;
    const BLOCKS_TO_SCAN_PRIOR = 43200; // 3 days worth of blocks assuming 6s block time
    const DEFAULT_SORT_BY = COL_AVG_TXS_PER_BLOCK;
    const DEFAULT_SORT_ORDER = 'desc';

    // Read and validate environment variables for RPC ports
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
    
    let startBlock, endBlock, batchSize;
    let useDefaultBlockRange = false;
    let sortBy = DEFAULT_SORT_BY;
    let sortOrder = DEFAULT_SORT_ORDER;

    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log('Usage: node scan-all-blocks.js [startBlock endBlock] [batchSize] [--sort-by <column>] [--sort-order <asc|desc>]');
        console.log('\nDescription:');
        console.log('  Scans a range of blocks from an Ethereum-compatible blockchain to gather proposer statistics.');
        console.log('  Relies on EL_ETHRPC_PORT and CL_ETHRPC_PORT environment variables for RPC endpoints (e.g., http://localhost:EL_ETHRPC_PORT).');
        console.log('  If startBlock and endBlock are omitted, scans the prior 43,200 blocks from the current block.');
        console.log('\nArguments (Optional):');
        console.log('  [startBlock endBlock]   Specific block range to scan.');
        console.log('  [batchSize]             Number of blocks to process in each batch. Defaults to 3600.');
        console.log('                          If startBlock/endBlock are omitted, this can be the first argument.');
        console.log('                          If startBlock/endBlock are provided, this is the third argument.');
        console.log('\nSorting Options:');
        console.log(`  --sort-by <column>      Column to sort the results by. Defaults to "${DEFAULT_SORT_BY}".`);
        console.log(`                          Valid columns: ${COL_PROPOSER}, ${COL_AVG_TXS_PER_BLOCK}, ${COL_GAS_PERCENT_LIMIT}, ${COL_BLOCKS_IN_SAMPLE}`);
        console.log(`  --sort-order <asc|desc> Sort order. Defaults to "${DEFAULT_SORT_ORDER}" for the default sort column, or "asc" for ${COL_PROPOSER} if chosen, "desc" for other numeric columns if chosen and order not specified.`);
        console.log('\nRequired Environment Variables:');
        console.log('  EL_ETHRPC_PORT          Port for the Execution Layer (EL) RPC endpoint (e.g., 8545).');
        console.log('  CL_ETHRPC_PORT          Port for the Consensus Layer (CL) RPC endpoint for header data (e.g., 50200).');
        console.log('\nExamples:');
        console.log('  EL_ETHRPC_PORT=8545 CL_ETHRPC_PORT=50200 node scan-all-blocks.js');
        console.log('  EL_ETHRPC_PORT=8545 CL_ETHRPC_PORT=50200 node scan-all-blocks.js 50');
        console.log('  EL_ETHRPC_PORT=8545 CL_ETHRPC_PORT=50200 node scan-all-blocks.js 1000 2000 50');
        console.log('  EL_ETHRPC_PORT=8545 CL_ETHRPC_PORT=50200 node scan-all-blocks.js --sort-by GasPercentOfLimit --sort-order desc');
        process.exit(0);
    }

    // provider initialization now uses the rpcUrl derived from env var
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    let argIndex = 0;
    // Initialize defaults for block range and batch size
    batchSize = DEFAULT_BATCH_SIZE;
    useDefaultBlockRange = true;

    const isFlag = (arg) => arg && arg.startsWith('--');
    const isNumeric = (arg) => arg && !isNaN(parseInt(arg));

    // Try to parse positional arguments for block range and/or batch size
    if (args[argIndex] && isNumeric(args[argIndex])) { // First arg is numeric
        if (args[argIndex+1] && isNumeric(args[argIndex+1])) { // Second arg is also numeric: startBlock, endBlock
            startBlock = parseInt(args[argIndex++]);
            endBlock = parseInt(args[argIndex++]);
            useDefaultBlockRange = false;
            // Check for optional batchSize as the third numeric argument
            if (args[argIndex] && isNumeric(args[argIndex]) && !isFlag(args[argIndex+1])) {
                 batchSize = parseInt(args[argIndex++]);
            }
            // If no third numeric arg, batchSize remains DEFAULT_BATCH_SIZE (already set)
        } else { // First arg is numeric, but second is not (or doesn't exist) or is a flag -> batchSize
            batchSize = parseInt(args[argIndex++]);
            // useDefaultBlockRange remains true (already set)
        }
    } else if (args[argIndex] && !isFlag(args[argIndex])) { // First arg exists, is not numeric, and not a flag -> error
        console.error(`Error: Invalid argument for block number or batch size: ${args[argIndex]}. Must be a number or a flag.`);
        console.error("Run with --help for usage details.");
        process.exit(1);
    }
    // If args[argIndex] is undefined (no args) or is a flag, defaults are used (already set).
    // argIndex has been advanced if positional args were consumed.
    
    // Parse flags like --sort-by and --sort-order
    for (let i = argIndex; i < args.length; i++) {
        if (args[i] === '--sort-by') {
            if (i + 1 < args.length && !isFlag(args[i+1])) {
                const userSortBy = args[++i];
                const columnMap = {
                    'proposer': COL_PROPOSER,
                    'avgtxsperblock': COL_AVG_TXS_PER_BLOCK,
                    'gaspercentoflimit': COL_GAS_PERCENT_LIMIT,
                    'blocksinasamplepercent': COL_BLOCKS_IN_SAMPLE
                };
                const normalizedUserSortBy = userSortBy.toLowerCase().replace(/[^a-z0-9]/gi, '');
                if (columnMap[normalizedUserSortBy]) {
                    sortBy = columnMap[normalizedUserSortBy];
                } else {
                    console.warn(`Warning: Invalid --sort-by value "${userSortBy}". Using default "${DEFAULT_SORT_BY}". Valid options: ${COL_PROPOSER}, ${COL_AVG_TXS_PER_BLOCK}, ${COL_GAS_PERCENT_LIMIT}, ${COL_BLOCKS_IN_SAMPLE}`);
                }
            } else {
                console.warn('Warning: --sort-by flag requires a value. Using default.');
            }
        } else if (args[i] === '--sort-order') {
            if (i + 1 < args.length && !isFlag(args[i+1])) {
                const userSortOrder = args[++i].toLowerCase();
                if (userSortOrder === 'asc' || userSortOrder === 'desc') {
                    sortOrder = userSortOrder;
                } else {
                    console.warn(`Warning: Invalid --sort-order value "${userSortOrder}". Must be "asc" or "desc". Using default.`);
                }
            } else {
                console.warn('Warning: --sort-order flag requires a value. Using default.');
            }
        } else if (!isNumeric(args[i])) { // If it's not a number (already processed) and not a recognized flag
             console.warn(`Warning: Unrecognized argument or flag: ${args[i]}. Ignoring.`);
        }
    }
    
    // Set default sortOrder for numeric columns if not specified by user AND it wasn't already set by default for a numeric default column.
    // The primary default (DEFAULT_SORT_ORDER) handles the default case.
    // This condition adjusts if the user *changes* sortBy to a numeric column without specifying order.
    if (sortBy !== COL_PROPOSER && sortBy !== DEFAULT_SORT_BY && process.argv.indexOf('--sort-order') === -1) {
        sortOrder = 'desc';
    } else if (sortBy === COL_PROPOSER && process.argv.indexOf('--sort-order') === -1) {
        // If user explicitly sorts by Proposer and doesn't specify order, it should be 'asc'
        sortOrder = 'asc';
    }
    // Otherwise, the initially set DEFAULT_SORT_ORDER (which is 'desc' if DEFAULT_SORT_BY is numeric) is used.

    if (useDefaultBlockRange) {
        console.log(`No specific block range provided. Fetching current block and scanning prior ${BLOCKS_TO_SCAN_PRIOR} blocks.`);
        try {
            const currentBlockNumber = await provider.getBlockNumber();
            endBlock = currentBlockNumber;
            startBlock = currentBlockNumber - BLOCKS_TO_SCAN_PRIOR;
            // Ensure startBlock is not negative, especially if chain is young
            if (startBlock < 0) {
                startBlock = 0;
            }
            console.log(`Will scan from block ${startBlock} to ${endBlock} (current). Using batch size: ${batchSize}`);
        } catch (error) {
            console.error('Error fetching current block number:', error.message);
            process.exit(1);
        }
    } else {
        // startBlock, endBlock, and batchSize are already parsed for custom range
        console.log(`Using provided start block: ${startBlock}, end block: ${endBlock}. Using batch size: ${batchSize}`);
    }

    // Final validations for all scenarios
    if (startBlock < 0) { // Should be handled by Math.max or specific check, but good as a final safety.
        console.warn(`Corrected start block from ${startBlock} to 0 as block numbers cannot be negative.`);
        startBlock = 0;
    }

    if (endBlock < startBlock) {
        console.error(`Error: End block (${endBlock}) must be greater than or equal to start block (${startBlock}).`);
        process.exit(1);
    }
    
    if (batchSize <=0) {
        console.error(`Error: Batch size (${batchSize}) must be a positive number.`);
        process.exit(1);
    }

    try {
        console.log(`Using EL RPC: ${rpcUrl}, CL RPC Base: ${clRpcBaseUrl}`);
        console.log('Starting analysis...');
        await analyzeBlockProposers(provider, startBlock, endBlock, clRpcBaseUrl, batchSize, sortBy, sortOrder);
    } catch (error) {
        console.error('Error during analysis execution:', error.message);
        // console.error('Full error details:', error); // For more detailed debugging if needed
    }
}

main();

