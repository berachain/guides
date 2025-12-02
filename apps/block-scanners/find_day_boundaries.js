/**
 * Find Day Boundaries - Daily Midnight UTC Detector
 * 
 * This script identifies block boundaries that correspond to daily midnight UTC timestamps.
 * It's useful for daily reporting and analysis by finding the exact blocks where days
 * begin, enabling time-based blockchain analysis and reporting.
 * 
 * Features:
 * - Calculates daily midnight UTC block boundaries
 * - Uses 2-second block time assumptions for estimation
 * - Provides precise block number identification
 * - Supports custom RPC endpoints
 * - Useful for daily blockchain analytics and reporting
 */

const axios = require('axios');
const { ConfigHelper, BlockFetcher, ProgressReporter } = require('./lib/shared-utils');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Configuration via shared ConfigHelper (consistent with analyze-missing-validators)
const argv = yargs(hideBin(process.argv))
    .option('days', {
        type: 'number',
        description: 'Number of days to scan backwards (backwards-compat, optional)'
    })
    .option('from-day', {
        type: 'string',
        description: 'Start day (YYYY-MM-DD format)'
    })
    .option('to-day', {
        type: 'string',
        description: 'End day (YYYY-MM-DD format)'
    })
    .option('chain', {
        alias: 'c',
        type: 'string',
        default: 'mainnet',
        choices: ['mainnet', 'bepolia'],
        description: 'Chain to use'
    })
    .option('help', {
        alias: 'h',
        type: 'boolean',
        description: 'Show help'
    })
    .strict()
    .help()
    .argv;

const chainName = argv.chain;
const daysArg = argv.days !== undefined ? argv.days : null;
const fromArg = argv['from-day'] ? `--from-day=${argv['from-day']}` : null;
const toArg = argv['to-day'] ? `--to-day=${argv['to-day']}` : null;
const BASE_URL = ConfigHelper.getBlockScannerUrl(chainName);
const blockFetcher = new BlockFetcher(BASE_URL);
const START_BLOCK = 933558;
const START_TIMESTAMP = 1739205914; // 2025-02-10 16:45:14 UTC (Monday)
const SECONDS_PER_DAY = 86400;
const BLOCK_TIME = 2; // 2 seconds per block

// Function to get latest block number
async function getLatestBlock() {
    try {
        return await blockFetcher.getCurrentBlock();
    } catch (error) {
        console.error('Error getting latest block:', error.message);
        return null;
    }
}

// Function to get block timestamp
async function getBlockTimestamp(blockNumber) {
    try {
        const response = await axios.get(`${BASE_URL}/block?height=${blockNumber}`);
        const isoTime = response?.data?.result?.block?.header?.time;
        if (!isoTime) return null;
        return Math.floor(new Date(isoTime).getTime() / 1000);
    } catch (error) {
        console.error(`Error getting block ${blockNumber}:`, error.message);
        return null;
    }
}

// Binary search within a bracket to find first block with timestamp >= targetTimestamp
async function binarySearchBoundary(lowHeight, highHeight, targetTimestamp) {
    // Precondition: timestamp(lowHeight) < targetTimestamp <= timestamp(highHeight)
    while (lowHeight + 1 < highHeight) {
        const mid = Math.floor((lowHeight + highHeight) / 2);
        const midTs = await getBlockTimestamp(mid);
        if (midTs === null) {
            break; // give up binary search if RPC fails repeatedly
        }
        if (midTs >= targetTimestamp) {
            highHeight = mid;
        } else {
            lowHeight = mid;
        }
    }
    return highHeight;
}

// Function to find the exact boundary where block is after midnight, previous is before midnight
async function findBoundaryBlock(targetTimestamp, latestBlock) {
    // Calculate estimated block based on 2-second block time
    const estimatedBlocks = Math.floor((targetTimestamp - START_TIMESTAMP) / BLOCK_TIME);
    let estimate = Math.min(Math.max(START_BLOCK + estimatedBlocks, 2), latestBlock);

    console.error(`Target: ${new Date(targetTimestamp * 1000).toISOString().split('T')[0]} (timestamp: ${targetTimestamp})`);
    console.error(`Estimated block: ${estimate}, Latest block: ${latestBlock}`);

    const estimateTs = await getBlockTimestamp(estimate);
    if (estimateTs === null) return null;

    let step = 1024;
    // Expand upward if estimate before target
    if (estimateTs < targetTimestamp) {
        let lowH = estimate;
        let lowTs = estimateTs;
        let highH = Math.min(lowH + step, latestBlock);
        let highTs = await getBlockTimestamp(highH);
        while (highTs !== null && highTs < targetTimestamp && highH < latestBlock) {
            lowH = highH;
            lowTs = highTs;
            step *= 2;
            highH = Math.min(highH + step, latestBlock);
            highTs = await getBlockTimestamp(highH);
        }
        if (highTs === null) return null;
        if (highTs < targetTimestamp) {
            console.error(`  Could not bracket target (top at latest block ${latestBlock})`);
            return null;
        }
        return await binarySearchBoundary(lowH, highH, targetTimestamp);
    }

    // Expand downward if estimate on/after target
    let highH = estimate;
    let highTs = estimateTs;
    let lowH = Math.max(highH - step, 1);
    let lowTs = await getBlockTimestamp(lowH);
    while (lowTs !== null && lowTs >= targetTimestamp && lowH > 1) {
        highH = lowH;
        highTs = lowTs;
        step *= 2;
        lowH = Math.max(lowH - step, 1);
        lowTs = await getBlockTimestamp(lowH);
    }
    if (lowTs === null) return null;
    if (lowTs >= targetTimestamp) {
        console.error(`  Could not bracket target (bottom at block 1)`);
        return null;
    }
    return await binarySearchBoundary(lowH, highH, targetTimestamp);
}

// Function to convert timestamp to date string
function timestampToDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Function to get the timestamp for midnight UTC for a day offset from base
function getDayMidnightTimestamp(dayOffset) {
    // Base at Monday, February 10, 2025 at midnight UTC (can be any known midnight)
    const baseMidnight = new Date('2025-02-10T00:00:00.000Z');
    const targetDate = new Date(baseMidnight.getTime() + (dayOffset * SECONDS_PER_DAY * 1000));
    return Math.floor(targetDate.getTime() / 1000);
}

function printHelp() {
    console.log(`
Find Day Boundaries - Daily Midnight UTC Detector

Usage: node find_day_boundaries.js [options]

Options:
  --from-day=YYYY-MM-DD  Start date (UTC). Defaults to 20 days before today.
  --to-day=YYYY-MM-DD    End date (UTC). Defaults to today.
  --days=N               Backwards-compat: N days ending today (ignored if --from-day/--to-day provided).
  -c, --chain=NAME     Chain to use: mainnet|bepolia (default: mainnet)
  -h, --help           Show this help message

Examples:
  node find_day_boundaries.js --from-day=2025-03-01 --to-day=2025-03-10
  node find_day_boundaries.js --chain=bepolia --days=10
`);
}

// Main function
async function findDayBoundaries() {
    if (argv.help) {
        printHelp();
        return;
    }
    const results = [];
    
    // Get latest block number
    const latestBlock = await getLatestBlock();
    if (!latestBlock) {
        console.error('Could not get latest block number');
        return;
    }
    
    console.error(`Latest block: ${latestBlock}`);
    
    // Determine date range (UTC)
    const parseYmdToUtcDate = (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
        if (!m) return null;
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10) - 1;
        const d = parseInt(m[3], 10);
        const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
        return Number.isNaN(dt.getTime()) ? null : dt;
    };
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    let toDay = toArg ? parseYmdToUtcDate(toArg.split('=')[1]) : todayUtc;
    if (!toDay) {
        console.error('Invalid --to-day format. Expected YYYY-MM-DD');
        return;
    }
    let fromDay = fromArg ? parseYmdToUtcDate(fromArg.split('=')[1]) : null;
    if (!fromDay) {
        // If --days is provided and no from/to, honor it; otherwise default to 20 days back
        const fallbackDays = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1], 10)) : 20;
        fromDay = new Date(toDay);
        fromDay.setUTCDate(fromDay.getUTCDate() - (fallbackDays - 1));
    }
    if (fromDay > toDay) {
        console.error(`Invalid range: --from-day (${fromDay.toISOString().split('T')[0]}) must be <= --to-day (${toDay.toISOString().split('T')[0]})`);
        return;
    }
    const totalDays = Math.floor((toDay.getTime() - fromDay.getTime()) / (SECONDS_PER_DAY * 1000)) + 1;
    for (let i = 0; i < totalDays; i++) {
        const dayDate = new Date(fromDay);
        dayDate.setUTCDate(fromDay.getUTCDate() + i);
        const targetTimestamp = Math.floor(dayDate.getTime() / 1000);
        const targetDate = timestampToDate(targetTimestamp);

        console.error(`\n=== ${targetDate} ===`);

        const blockNumber = await findBoundaryBlock(targetTimestamp, latestBlock);
        if (!blockNumber) {
            console.error(`  Could not find boundary for ${targetDate}, skipping`);
            continue;
        }
        
        const blockTimestamp = await getBlockTimestamp(blockNumber);
        const prevTimestamp = await getBlockTimestamp(blockNumber - 1);
        
        if (blockTimestamp && prevTimestamp) {
            const blockDate = new Date(blockTimestamp * 1000).toISOString();
            const prevDate = new Date(prevTimestamp * 1000).toISOString();
            
            results.push({
                date: targetDate,
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
            
        } else {
            console.error(`  Could not verify block timestamps for ${targetDate}`);
            continue;
        }
        // Small delay to avoid overwhelming the RPC
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Output CSV to stdout
    console.log('Date,Block Number');
    results.forEach(result => {
        console.log(`${result.date},${result.blockNumber}`);
    });
}

// Run the script
findDayBoundaries().catch(console.error);


