const https = require('https');
const http = require('http');
const Table = require('cli-table3');

// Configuration
const RPC_URL = 'http://192.168.2.69:40003';
const START_BLOCK = 933558;
const START_TIMESTAMP = 1739205914; // 2025-02-10 16:45:14 UTC (Monday)
const BLOCK_TIME = 2; // 2 seconds per block

// Command line argument parsing
function parseArgs() {
    const args = process.argv.slice(2);
    let startDate = null;
    let endDate = null;
    let batchSize = 100;
    let concurrency = 10;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--start-date' && i + 1 < args.length) {
            startDate = args[i + 1];
            i++;
        } else if (args[i] === '--end-date' && i + 1 < args.length) {
            endDate = args[i + 1];
            i++;
        } else if (args[i] === '--batch-size' && i + 1 < args.length) {
            batchSize = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === '--concurrency' && i + 1 < args.length) {
            concurrency = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log('Usage: node empty_blocks_scanner.js [options]');
            console.log('Options:');
            console.log('  --start-date YYYY-MM-DD  Start date for scanning (default: 30 days ago)');
            console.log('  --end-date YYYY-MM-DD    End date for scanning (default: today)');
            console.log('  --batch-size N           Number of blocks to process in each batch (default: 100)');
            console.log('  --concurrency N          Number of concurrent requests (default: 10)');
            console.log('  --help, -h               Show this help message');
            console.log('');
            console.log('If no dates provided, scans the last 30 days');
            process.exit(0);
        }
    }
    
    // Default to 30 days ago if no start date provided
    if (!startDate) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        startDate = thirtyDaysAgo.toISOString().split('T')[0];
    }
    
    // Default to today if no end date provided
    if (!endDate) {
        endDate = new Date().toISOString().split('T')[0];
    }
    
    return { startDate, endDate, batchSize, concurrency };
}

// Function to make JSON-RPC call
async function makeRpcCall(method, params) {
    return new Promise((resolve, reject) => {
        const url = new URL(RPC_URL);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const postData = JSON.stringify({
            jsonrpc: '2.0',
            method: method,
            params: params,
            id: 1
        });

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response);
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// Function to make batch RPC calls
async function makeBatchRpcCall(requests) {
    return new Promise((resolve, reject) => {
        const url = new URL(RPC_URL);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const postData = JSON.stringify(requests);

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response);
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// Function to get latest block number
async function getLatestBlock() {
    try {
        const response = await makeRpcCall('eth_blockNumber', []);
        if (response.result) {
            return parseInt(response.result, 16);
        }
        return null;
    } catch (error) {
        console.error('Error getting latest block:', error.message);
        return null;
    }
}

// Function to get block data (including transaction count and gas usage)
async function getBlockData(blockNumber) {
    try {
        const response = await makeRpcCall('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]);
        if (response.result) {
            return {
                number: parseInt(response.result.number, 16),
                timestamp: parseInt(response.result.timestamp, 16),
                transactionCount: response.result.transactions ? response.result.transactions.length : 0,
                gasUsed: parseInt(response.result.gasUsed, 16),
                gasLimit: parseInt(response.result.gasLimit, 16)
            };
        }
        return null;
    } catch (error) {
        console.error(`Error getting block ${blockNumber}:`, error.message);
        return null;
    }
}

// Function to get multiple blocks data in parallel
async function getBlockDataBatch(blockNumbers) {
    const requests = blockNumbers.map((blockNumber, index) => ({
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: [`0x${blockNumber.toString(16)}`, false],
        id: index
    }));

    try {
        const responses = await makeBatchRpcCall(requests);
        const results = {};
        
        // Handle both array and single object responses
        const responseArray = Array.isArray(responses) ? responses : [responses];
        
        responseArray.forEach((response, index) => {
            if (response.result) {
                const blockNumber = blockNumbers[response.id];
                results[blockNumber] = {
                    number: parseInt(response.result.number, 16),
                    timestamp: parseInt(response.result.timestamp, 16),
                    transactionCount: response.result.transactions ? response.result.transactions.length : 0,
                    gasUsed: parseInt(response.result.gasUsed, 16),
                    gasLimit: parseInt(response.result.gasLimit, 16)
                };
            }
        });
        
        return results;
    } catch (error) {
        console.error(`Error getting batch block data:`, error.message);
        return {};
    }
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

// Function to process blocks in chunks with controlled concurrency
async function processBlocksInChunks(blockNumbers, concurrency, batchSize) {
    const results = {};
    
    // Split blocks into chunks of batchSize
    const chunks = [];
    for (let i = 0; i < blockNumbers.length; i += batchSize) {
        chunks.push(blockNumbers.slice(i, i + batchSize));
    }
    
    const progressBar = createProgressBar(blockNumbers.length);
    
    // Process chunks with controlled concurrency
    for (let i = 0; i < chunks.length; i += concurrency) {
        const chunkBatch = chunks.slice(i, i + concurrency);
        const chunkPromises = chunkBatch.map(chunk => getBlockDataBatch(chunk));
        
        const chunkResults = await Promise.all(chunkPromises);
        
        // Merge results
        chunkResults.forEach(chunkResult => {
            Object.assign(results, chunkResult);
        });
        
        // Update progress bar
        const processed = Math.min((i + concurrency) * batchSize, blockNumbers.length);
        progressBar.update(processed);
    }
    
    progressBar.finish();
    return results;
}

// Function to find the exact boundary where block is after midnight, previous is before midnight
async function findBoundaryBlock(targetTimestamp, latestBlock) {
    // Calculate estimated block based on 2-second block time
    const estimatedBlocks = Math.floor((targetTimestamp - START_TIMESTAMP) / BLOCK_TIME);
    const estimatedBlock = START_BLOCK + estimatedBlocks;
    
    // If estimated block is beyond latest block, we can't find it
    if (estimatedBlock > latestBlock) {
        return null;
    }
    
    let candidateBlock = estimatedBlock;
    let attempts = 0;
    const maxAttempts = 100; // Prevent infinite loops
    
    while (attempts < maxAttempts) {
        attempts++;
        
        // Get current block and previous block data in parallel
        const blockData = await getBlockDataBatch([candidateBlock, candidateBlock - 1]);
        const currentBlock = blockData[candidateBlock];
        const prevBlock = blockData[candidateBlock - 1];
        
        if (!currentBlock || !prevBlock) {
            return null;
        }
        
        // Check if we have the correct boundary
        if (currentBlock.timestamp >= targetTimestamp && prevBlock.timestamp < targetTimestamp) {
            return candidateBlock;
        }
        
        // Check if previous block is exactly at midnight (edge case)
        if (prevBlock.timestamp === targetTimestamp) {
            return candidateBlock - 1;
        }
        
        // Calculate how far off we are and adjust
        if (currentBlock.timestamp < targetTimestamp) {
            // Current block is before target, need to go forward
            const blocksToAdd = Math.ceil((targetTimestamp - currentBlock.timestamp) / BLOCK_TIME);
            candidateBlock += blocksToAdd;
        } else if (prevBlock.timestamp >= targetTimestamp) {
            // Previous block is after target, need to go backward
            const blocksToSubtract = Math.ceil((prevBlock.timestamp - targetTimestamp) / BLOCK_TIME);
            candidateBlock -= blocksToSubtract;
        } else {
            // We're in the right range but not at the boundary
            candidateBlock += 1;
        }
        
        // Safety check
        if (candidateBlock <= 0 || candidateBlock > latestBlock) {
            return null;
        }
    }
    
    return candidateBlock;
}

// Function to get the timestamp for midnight UTC on a given date
function getMidnightTimestamp(dateString) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    return Math.floor(date.getTime() / 1000);
}

// Function to get date string from timestamp
function timestampToDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0];
}

// Function to count empty blocks and calculate gas statistics
async function countEmptyBlocksInRange(startBlock, endBlock, batchSize, concurrency) {
    const blockNumbers = [];
    for (let i = startBlock; i <= endBlock; i++) {
        blockNumbers.push(i);
    }
    
    const startTime = Date.now();
    const blockData = await processBlocksInChunks(blockNumbers, concurrency, batchSize);
    const endTime = Date.now();
    
    let emptyCount = 0;
    let totalCount = 0;
    let totalGasUsed = 0;
    let totalGasLimit = 0;
    let minGasUsed = Infinity;
    let maxGasUsed = 0;
    
    blockNumbers.forEach(blockNumber => {
        const block = blockData[blockNumber];
        if (block) {
            totalCount++;
            totalGasUsed += block.gasUsed;
            totalGasLimit += block.gasLimit;
            
            if (block.gasUsed < minGasUsed) minGasUsed = block.gasUsed;
            if (block.gasUsed > maxGasUsed) maxGasUsed = block.gasUsed;
            
            if (block.transactionCount === 0) {
                emptyCount++;
            }
        }
    });
    
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const blocksPerSecond = (totalCount / (duration || 1)).toFixed(2);
    
    // Calculate gas statistics
    const avgGasUsed = totalCount > 0 ? Math.round(totalGasUsed / totalCount) : 0;
    const avgGasLimit = totalCount > 0 ? Math.round(totalGasLimit / totalCount) : 0;
    const avgGasUtilization = avgGasLimit > 0 ? ((avgGasUsed / avgGasLimit) * 100).toFixed(2) : 0;
    
    // Handle edge case where no blocks were processed
    if (minGasUsed === Infinity) minGasUsed = 0;
    
    return { 
        emptyCount, 
        totalCount, 
        duration, 
        blocksPerSecond,
        totalGasUsed,
        avgGasUsed,
        minGasUsed,
        maxGasUsed,
        avgGasUtilization
    };
}

// Function to format table output using cli-table3
function formatTable(results, totalEmpty, totalBlocks) {
    const table = new Table({
        head: ['Date', 'Empty Blocks', 'Total Blocks', 'Empty %', 'Gas Utilization %'],
        colWidths: [12, 14, 14, 9, 19],
        style: {
            head: ['cyan', 'bold'],
            border: ['gray']
        },
        chars: {
            'mid': '',
            'left-mid': '',
            'mid-mid': '',
            'right-mid': ''
        }
    });

    results.forEach(result => {
        table.push([
            result.date,
            result.emptyCount.toLocaleString(),
            result.totalCount.toLocaleString(),
            result.percentage + '%',
            result.avgGasUtilization + '%'
        ]);
    });

    // Add total row
    const overallPercentage = totalBlocks > 0 ? ((totalEmpty / totalBlocks) * 100).toFixed(2) : 0;
    table.push([
        '**TOTAL**',
        totalEmpty.toLocaleString(),
        totalBlocks.toLocaleString(),
        overallPercentage + '%',
        ''
    ]);

    console.error('\n' + table.toString());
}

// Main function
async function scanEmptyBlocks() {
    const { startDate, endDate, batchSize, concurrency } = parseArgs();
    
    console.error(`🔍 Scanning for empty blocks from ${startDate} to ${endDate}`);
    console.error(`⚡ Performance settings: batch size=${batchSize}, concurrency=${concurrency}`);
    
    // Get latest block number
    const latestBlock = await getLatestBlock();
    if (!latestBlock) {
        console.error('❌ Could not get latest block number');
        return;
    }
    
    console.error(`📦 Latest block: ${latestBlock.toLocaleString()}`);
    
    const results = [];
    const startDateTime = new Date(`${startDate}T00:00:00.000Z`);
    const endDateTime = new Date(`${endDate}T23:59:59.999Z`);
    
    let currentDate = new Date(startDateTime);
    let dayCount = 0;
    
    while (currentDate <= endDateTime) {
        const dateString = currentDate.toISOString().split('T')[0];
        const nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + 1);
        
        dayCount++;
        console.error(`\n📅 Day ${dayCount}: ${dateString}`);
        
        const startTimestamp = getMidnightTimestamp(dateString);
        const endTimestamp = getMidnightTimestamp(nextDate.toISOString().split('T')[0]);
        
        // Find the block at the start of the day
        const startBlock = await findBoundaryBlock(startTimestamp, latestBlock);
        if (!startBlock) {
            console.error(`❌ Could not find start block for ${dateString}`);
            break;
        }
        
        // Find the block at the start of the next day (end of current day)
        const endBlock = await findBoundaryBlock(endTimestamp, latestBlock);
        if (!endBlock) {
            console.error(`❌ Could not find end block for ${dateString}`);
            break;
        }
        
        const blockCount = endBlock - startBlock;
        console.error(`    Scanning ${blockCount.toLocaleString()} blocks (${startBlock.toLocaleString()} to ${(endBlock - 1).toLocaleString()})`);
        
        // Count empty blocks for this day
        const { emptyCount, totalCount, duration, blocksPerSecond, totalGasUsed, avgGasUsed, minGasUsed, maxGasUsed, avgGasUtilization } = await countEmptyBlocksInRange(startBlock, endBlock - 1, batchSize, concurrency);
        
        const result = {
            date: dateString,
            startBlock: startBlock,
            endBlock: endBlock - 1,
            emptyCount: emptyCount,
            totalCount: totalCount,
            percentage: totalCount > 0 ? ((emptyCount / totalCount) * 100).toFixed(2) : 0,
            duration: duration,
            blocksPerSecond: blocksPerSecond,
            totalGasUsed: totalGasUsed,
            avgGasUsed: avgGasUsed,
            minGasUsed: minGasUsed,
            maxGasUsed: maxGasUsed,
            avgGasUtilization: avgGasUtilization
        };
        
        results.push(result);
        
        console.error(`    ✅ Found ${emptyCount} empty blocks (${result.percentage}%) | Gas utilization: ${avgGasUtilization}%`);
        
        // Check if we've reached the latest block
        if (endBlock >= latestBlock) {
            console.error(`    ⚠️  Reached latest block, stopping`);
            break;
        }
        
        currentDate = nextDate;
    }
    
    // Calculate totals
    let totalEmpty = 0;
    let totalBlocks = 0;
    let grandTotalGasUsed = 0;
    
    results.forEach(result => {
        totalEmpty += result.emptyCount;
        totalBlocks += result.totalCount;
        grandTotalGasUsed += result.totalGasUsed;
    });
    
    // Output summary table
    console.error('\n🏁 SCAN COMPLETE');
    formatTable(results, totalEmpty, totalBlocks);
    
    const overallPercentage = totalBlocks > 0 ? ((totalEmpty / totalBlocks) * 100).toFixed(2) : 0;
    const overallAvgGas = totalBlocks > 0 ? Math.round(grandTotalGasUsed / totalBlocks) : 0;
    console.error(`📊 Overall Summary: ${totalEmpty.toLocaleString()} empty blocks out of ${totalBlocks.toLocaleString()} total (${overallPercentage}%)`);
    console.error(`⛽ Gas Summary: ${overallAvgGas.toLocaleString()} average gas used per block | ${grandTotalGasUsed.toLocaleString()} total gas consumed`);
}

// Run the script
scanEmptyBlocks().catch(console.error); 