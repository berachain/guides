/**
 * Scan Distributions - Block Reward Event Scanner
 * 
 * This script scans blockchain blocks for BlockRewardProcessed events from the BlockRewardController
 * contract and attributes them to block proposers. It analyzes block reward distributions across
 * validators and provides insights into reward allocation patterns.
 * 
 * Features:
 * - Scans specified block ranges or defaults to last 43,200 blocks (~24 hours)
 * - Tracks reward events by block proposer
 * - Provides progress tracking and detailed reporting
 * - Requires ABI_DIR, EL_ETHRPC_URL, and CL_ETHRPC_URL environment variables
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const cliProgress = require('cli-progress');
const path = require('path');

// --- CONFIGURATION ---

const BLOCKS_TO_SCAN_PRIOR = 43200;
const BLOCK_CHUNK_SIZE = 10000;

// --- ENVIRONMENT VARIABLES ---

const requiredEnvVars = ['ABI_DIR', 'EL_ETHRPC_URL', 'CL_ETHRPC_URL'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    console.error('Error: Missing required environment variables:');
    missingEnvVars.forEach(envVar => console.error(`- ${envVar}`));
    process.exit(1);
}

const ABI_DIR = process.env.ABI_DIR;
const EL_RPC_URL = process.env.EL_ETHRPC_URL;
const CL_RPC_URL = process.env.CL_ETHRPC_URL;
const CONTRACT_ADDRESS = "0x1AE7dD7AE06F6C58B4524d9c1f816094B1bcCD8e";

// --- LOAD ABI ---

const BlockRewardControllerABI = require(path.join(ABI_DIR, 'core', 'BlockRewardController.json'));

// --- CLI ARGUMENTS ---

const argv = yargs(hideBin(process.argv))
    .command('$0 [startBlock] [endBlock]', 'Scan for BlockRewardProcessed events in a block range.', (yargs) => {
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
    .usage('Usage: node scan-block-reward-events.js [startBlock endBlock]')
    .epilogue(`Scans for BlockRewardProcessed events and attributes them to block proposers.\nRequired env vars: ABI_DIR, EL_ETHRPC_URL, CL_ETHRPC_URL, BLOCK_REWARD_CONTROLLER_ADDRESS`)
    .strict()
    .argv;

// --- MAIN LOGIC ---

async function main() {
    const provider = new ethers.JsonRpcProvider(EL_RPC_URL);

    // Determine block range
    let startBlock, endBlock;
    if (argv.startBlock !== undefined && argv.endBlock !== undefined) {
        startBlock = argv.startBlock;
        endBlock = argv.endBlock;
        console.log(`Using provided start block: ${startBlock}, end block: ${endBlock}.`);
    } else {
        console.log(`No specific block range provided. Fetching current block and scanning prior ${BLOCKS_TO_SCAN_PRIOR} blocks.`);
        const currentBlockNumber = await provider.getBlockNumber();
        endBlock = currentBlockNumber;
        startBlock = currentBlockNumber - BLOCKS_TO_SCAN_PRIOR;
        console.log(`Will scan from block ${startBlock} to ${endBlock} (current).`);
    }

    // Set up contract
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BlockRewardControllerABI, provider);

    // Prepare for scanning
    const proposerEventCounts = {};
    const blockProposerCache = {};
    let totalEvents = 0;

    // Progress bar
    const progressBar = new cliProgress.SingleBar({
        format: 'Scanning blocks |{bar}| {percentage}% | {value}/{total} blocks | Events: {events}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });
    const totalBlocks = endBlock - startBlock + 1;
    progressBar.start(totalBlocks, 0, { events: 0 });

    // Scan in chunks
    for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += BLOCK_CHUNK_SIZE) {
        const toBlock = Math.min(fromBlock + BLOCK_CHUNK_SIZE - 1, endBlock);

        // Query for events in this chunk
        let events;
        try {
            events = await contract.queryFilter(
                contract.filters.BlockRewardProcessed(),
                fromBlock,
                toBlock
            );
        } catch (err) {
            console.error(`Error querying events for blocks ${fromBlock}-${toBlock}:`, err.message);
            continue;
        }

        // For each event, get block number and tx hash
        for (const event of events) {
            const blockNumber = event.blockNumber;

            // Fetch proposer for this block (cache to avoid duplicate requests)
            let proposer;
            if (blockProposerCache[blockNumber]) {
                proposer = blockProposerCache[blockNumber];
            } else {
                try {
                    const url = `${CL_RPC_URL}/header?height=${blockNumber}`;
                    const response = await axios.get(url);
                    proposer = response.data.result.header.proposer_address;
                    blockProposerCache[blockNumber] = proposer;
                } catch (err) {
                    console.error(`Error fetching proposer for block ${blockNumber}:`, err.message);
                    proposer = 'UNKNOWN';
                }
            }

            // Count event for this proposer
            if (!proposerEventCounts[proposer]) {
                proposerEventCounts[proposer] = 0;
            }
            proposerEventCounts[proposer]++;
            totalEvents++;
        }

        progressBar.update(Math.min(toBlock - startBlock + 1, totalBlocks), { events: totalEvents });
    }

    progressBar.stop();
    console.log('\nScan complete!');

    // Print summary table
    const tableData = Object.entries(proposerEventCounts)
        .map(([proposer, count]) => ({ Proposer: proposer, 'BlockRewardProcessed Events': count }))
        .sort((a, b) => b['BlockRewardProcessed Events'] - a['BlockRewardProcessed Events']);

    if (tableData.length > 0) {
        console.log('\nBlockRewardProcessed Events by Proposer:');
        console.table(tableData);
    } else {
        console.log('No BlockRewardProcessed events found in the specified range.');
    }

    console.log(`\nTotal unique proposers: ${Object.keys(proposerEventCounts).length}`);
    console.log(`Total BlockRewardProcessed events found: ${totalEvents}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
