/**
 * Find Monday Blocks - Weekly Boundary Detector
 * 
 * This script identifies block boundaries that correspond to Monday midnight UTC timestamps.
 * It's useful for weekly reporting and analysis by finding the exact blocks where weeks
 * begin, enabling time-based blockchain analysis and reporting.
 * 
 * Features:
 * - Calculates Monday midnight UTC block boundaries
 * - Uses 2-second block time assumptions for estimation
 * - Provides precise block number identification
 * - Supports custom RPC endpoints
 * - Useful for weekly blockchain analytics and reporting
 */

const https = require('https');
const http = require('http');

// Configuration
const RPC_URL = 'http://192.168.2.69:40003';
const START_BLOCK = 933558;
const START_TIMESTAMP = 1739205914; // 2025-02-10 16:45:14 UTC (Monday)
const SECONDS_PER_WEEK = 604800;
const BLOCK_TIME = 2; // 2 seconds per block

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

// Function to get block timestamp
async function getBlockTimestamp(blockNumber) {
    try {
        const response = await makeRpcCall('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]);
        if (response.result && response.result.timestamp) {
            return parseInt(response.result.timestamp, 16);
        }
        return null;
    } catch (error) {
        console.error(`Error getting block ${blockNumber}:`, error.message);
        return null;
    }
}

// Function to find the exact boundary where block is after midnight, previous is before midnight
async function findBoundaryBlock(targetTimestamp, latestBlock) {
    // Calculate estimated block based on 2-second block time
    const estimatedBlocks = Math.floor((targetTimestamp - START_TIMESTAMP) / BLOCK_TIME);
    const estimatedBlock = START_BLOCK + estimatedBlocks;
    
    console.error(`Target: ${new Date(targetTimestamp * 1000).toISOString().split('T')[0]} (timestamp: ${targetTimestamp})`);
    console.error(`Estimated block: ${estimatedBlock}, Latest block: ${latestBlock}`);
    
    // If estimated block is beyond latest block, we can't find it
    if (estimatedBlock > latestBlock) {
        console.error(`  Estimated block ${estimatedBlock} is beyond latest block ${latestBlock}`);
        return null;
    }
    
    let candidateBlock = estimatedBlock;
    let attempts = 0;
    const maxAttempts = 100; // Prevent infinite loops
    
    while (attempts < maxAttempts) {
        attempts++;
        
        // Get current block and previous block timestamps
        const currentTimestamp = await getBlockTimestamp(candidateBlock);
        const prevTimestamp = await getBlockTimestamp(candidateBlock - 1);
        
        if (currentTimestamp === null || prevTimestamp === null) {
            console.error(`  Cannot get timestamps for blocks ${candidateBlock} or ${candidateBlock - 1}`);
            return null;
        }
        
        const currentDate = new Date(currentTimestamp * 1000).toISOString();
        const prevDate = new Date(prevTimestamp * 1000).toISOString();
        
        // Check if we have the correct boundary
        if (currentTimestamp >= targetTimestamp && prevTimestamp < targetTimestamp) {
            console.error(`  Attempt ${attempts}: Block ${candidateBlock} at ${currentDate}, Block ${candidateBlock - 1} at ${prevDate} - ✓ Found correct boundary!`);
            return candidateBlock;
        }
        
        // Check if previous block is exactly at midnight (edge case)
        if (prevTimestamp === targetTimestamp) {
            console.error(`  Attempt ${attempts}: Block ${candidateBlock} at ${currentDate}, Block ${candidateBlock - 1} at ${prevDate} - ✓ Previous block exactly at midnight!`);
            return candidateBlock - 1;
        }
        
        // Calculate how far off we are and adjust
        let adjustment = '';
        if (currentTimestamp < targetTimestamp) {
            // Current block is before target, need to go forward
            const blocksToAdd = Math.ceil((targetTimestamp - currentTimestamp) / BLOCK_TIME);
            candidateBlock += blocksToAdd;
            adjustment = ` - Moving forward by ${blocksToAdd} blocks to ${candidateBlock}`;
        } else if (prevTimestamp >= targetTimestamp) {
            // Previous block is after target, need to go backward
            const blocksToSubtract = Math.ceil((prevTimestamp - targetTimestamp) / BLOCK_TIME);
            candidateBlock -= blocksToSubtract;
            adjustment = ` - Moving backward by ${blocksToSubtract} blocks to ${candidateBlock}`;
        } else {
            // We're in the right range but not at the boundary
            // This shouldn't happen with our logic, but just in case
            candidateBlock += 1;
            adjustment = ` - Unexpected case, adjusting by 1 block to ${candidateBlock}`;
        }
        
        console.error(`  Attempt ${attempts}: Block ${candidateBlock} at ${currentDate}, Block ${candidateBlock - 1} at ${prevDate}${adjustment}`);
        
        // Safety check
        if (candidateBlock <= 0 || candidateBlock > latestBlock) {
            console.error(`  Candidate block ${candidateBlock} out of range, stopping`);
            return null;
        }
        
        // Small delay to avoid overwhelming the RPC
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.error(`  Max attempts reached, returning best candidate`);
    return candidateBlock;
}

// Function to convert timestamp to date string
function timestampToDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Function to get the timestamp for midnight UTC on a given Monday
function getMondayMidnightTimestamp(weekOffset) {
    // Start with Monday, February 10, 2025 at midnight UTC
    const mondayFeb10 = new Date('2025-02-10T00:00:00.000Z');
    const targetDate = new Date(mondayFeb10.getTime() + (weekOffset * 7 * 24 * 60 * 60 * 1000));
    return Math.floor(targetDate.getTime() / 1000);
}

// Main function
async function findMondayBlocks() {
    const results = [];
    
    // Get latest block number
    const latestBlock = await getLatestBlock();
    if (!latestBlock) {
        console.error('Could not get latest block number');
        return;
    }
    
    console.error(`Latest block: ${latestBlock}`);
    
    let week = 0;
    while (true) {
        const targetTimestamp = getMondayMidnightTimestamp(week);
        const targetDate = timestampToDate(targetTimestamp);
        
        console.error(`\n=== Week ${week} ===`);
        
        const blockNumber = await findBoundaryBlock(targetTimestamp, latestBlock);
        
        if (!blockNumber) {
            console.error(`  Could not find block for week ${week}, stopping`);
            break;
        }
        
        const blockTimestamp = await getBlockTimestamp(blockNumber);
        const prevTimestamp = await getBlockTimestamp(blockNumber - 1);
        
        if (blockTimestamp && prevTimestamp) {
            const blockDate = new Date(blockTimestamp * 1000).toISOString();
            const prevDate = new Date(prevTimestamp * 1000).toISOString();
            
            results.push({
                week: targetDate,
                blockNumber: blockNumber,
                blockTimestamp: blockTimestamp,
                blockDate: blockDate,
                prevTimestamp: prevTimestamp,
                prevDate: prevDate
            });
            
            console.error(`  Final result: Block ${blockNumber} at ${blockDate}`);
            console.error(`  Previous block ${blockNumber - 1} at ${prevDate}`);
            
            // Verify the boundary
            if (blockTimestamp >= targetTimestamp && prevTimestamp < targetTimestamp) {
                console.error(`  ✓ Correct boundary: block after midnight, previous before midnight`);
            } else {
                console.error(`  ✗ Incorrect boundary!`);
            }
            
            // Check if we've reached the latest block
            if (blockNumber >= latestBlock) {
                console.error(`  Reached latest block, stopping`);
                break;
            }
        } else {
            console.error(`  Could not verify block timestamps`);
            break;
        }
        
        week++;
        
        // Small delay to avoid overwhelming the RPC
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Output CSV to stdout
    console.log('Week of Date,Block Number');
    results.forEach(result => {
        console.log(`Week of ${result.week},${result.blockNumber}`);
    });
}

// Run the script
findMondayBlocks().catch(console.error); 