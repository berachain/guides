/**
 * Scan Deposits - Beacon Chain Deposit Validator
 * 
 * This script scans the BeaconDeposit contract for deposit events and validates
 * them using the beacon CLI tool. It helps ensure the integrity of validator
 * deposits and provides insights into staking activity.
 * 
 * Features:
 * - Scans for Deposit events from genesis to latest block
 * - Validates deposit signatures using beacon CLI
 * - Tracks deposit events by public key
 * - Provides progress tracking and detailed reporting
 * - Supports custom block ranges and chunk processing
 */

const { ethers } = require('ethers');
const cliProgress = require('cli-progress');
const { execSync } = require('child_process');
const { ConfigHelper, config, withRetry, hashEvent, decodeEventData, scanLogsInChunks } = require('./lib/shared-utils');

// -----------------------------
// CLI argument parsing
// -----------------------------
function printHelp() {
    console.log(`
Usage: node scan-deposits.js [--chain <name>] [--rpc <url>] [--start <n>] [--address <0x...>] [--help]

Options:
  --help                 Show this help and exit
  --chain <name>         Chain to use for RPC defaults (mainnet, bepolia)
  --rpc <url>            RPC URL (overrides --chain)
  --start <n>            Starting block (default: 0)
  --address <0x...>      BeaconDeposit contract address (default: placeholder)
`);
}

function parseArgs(argv) {
    const args = { chain: undefined, rpc: undefined, startBlock: undefined, address: undefined, help: false };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--help':
            case '-h':
                args.help = true;
                break;
            case '--chain':
                args.chain = argv[++i];
                break;
            case '--rpc':
                args.rpc = argv[++i];
                break;
            case '--start':
                args.startBlock = Number(argv[++i]);
                break;
            case '--address':
                args.address = argv[++i];
                break;
            default:
                if (arg.startsWith('-')) {
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
                }
        }
    }
    return args;
}

const args = parseArgs(process.argv);
if (args.help) {
    printHelp();
    process.exit(0);
}

// Resolve chain and RPC with helpers used by other scanners
const SUPPORTED_CHAINS = ['mainnet', 'bepolia'];
const chainName = args.chain || 'mainnet';
if (args.chain && !SUPPORTED_CHAINS.includes(args.chain)) {
    console.error(`Unknown --chain value: ${args.chain}. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
    process.exit(1);
}
// Precedence: --rpc > environment > config default for chain
let resolvedRpcUrl = args.rpc || process.env.EL_ETHRPC_URL || ConfigHelper.getRpcUrl('el', chainName);

// Event signature/topic and ABI decoding (no external ABI files required)
const DEPOSIT_EVENT_SIGNATURE = 'Deposit(bytes,bytes,uint64,bytes,uint64)';
const DEPOSIT_TOPIC = hashEvent(DEPOSIT_EVENT_SIGNATURE);

// Configuration
const RPC_URL = resolvedRpcUrl;
const CONTRACT_ADDRESS = args.address || ConfigHelper.getBeaconDepositAddress() || config.BEACON_DEPOSIT_ADDRESS;
const START_BLOCK = Number.isFinite(args.startBlock) ? args.startBlock : 0; 
const BLOCK_CHUNK_SIZE = ConfigHelper.getDefaultLogChunkSize();
const GENESIS_FORK_VERSION = '0xdf609e3b062842c6425ff716aec2d2092c46455d9b2e1a2c9e32c6ba63ff0bda';

// Retry uses shared helper; avoid local sleep usage

async function validateDeposit(pubkey, withdrawalCredentials, amount, signature) {
    try {
        if (!signature || signature.startsWith('0x0000')) return '-';
        
        const command = `beacond deposit validate ${pubkey} ${withdrawalCredentials} ${amount} ${signature} -g ${GENESIS_FORK_VERSION} > /dev/null 2>&1`;
        execSync(command, { encoding: 'utf8' });
        return '✓'; // If we get here, the command succeeded (return code 0)
    } catch (error) {
        return '✗'; // Any non-zero return code will throw an error
    }
}

async function fetchDepositEvents() {
    try {
        if (!RPC_URL) {
            console.error('Error: No RPC URL provided. Use --rpc or --chain.');
            process.exit(1);
        }
        // Initialize provider
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        // Get the latest block number (with retry)
        const latestBlock = await withRetry(() => provider.getBlockNumber());
        console.log(`Latest block number: ${latestBlock}`);

        // Get the Deposit event filter

        let totalEvents = 0;
        const eventsByPubkey = new Map();
        
        // Create progress bar
        const progressBar = new cliProgress.SingleBar({
            format: 'Scanning blocks |{bar}| {percentage}% | {value}/{total} blocks | Events: {events}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
        });

        // Calculate total blocks to scan
        const totalBlocks = latestBlock - START_BLOCK + 1;
        progressBar.start(totalBlocks, 0, { events: 0 });
        
        // Process blocks in chunks using shared scanner
        await scanLogsInChunks(provider, {
            address: CONTRACT_ADDRESS,
            topics: [DEPOSIT_TOPIC],
            fromBlock: START_BLOCK,
            toBlock: latestBlock,
            chunkSize: BLOCK_CHUNK_SIZE,
            onChunk: async ({ from, to, logs }) => {
                for (const event of logs) {
                    const [pubkey, credentials, amount, signature, index] = decodeEventData(
                        ['bytes', 'bytes', 'uint64', 'bytes', 'uint64'],
                        event.data
                    );
                    if (!eventsByPubkey.has(pubkey)) {
                        eventsByPubkey.set(pubkey, []);
                    }
                    const validationStatus = await validateDeposit(
                        pubkey,
                        credentials,
                        amount.toString(),
                        signature
                    );
                    eventsByPubkey.get(pubkey).push({
                        blockNumber: event.blockNumber,
                        amount: amount.toString(),
                        index: index.toString(),
                        txHash: event.transactionHash,
                        validation: validationStatus
                    });
                }
                totalEvents += logs.length;
                progressBar.update(to - START_BLOCK + 1, { events: totalEvents });
            }
        });

        progressBar.stop();
        console.log('\nScan complete!');

        // Sort events within each pubkey by block number
        for (const [pubkey, events] of eventsByPubkey) {
            events.sort((a, b) => a.blockNumber - b.blockNumber);
        }

        // Display summary by pubkey
        console.log('\nSummary of Deposit Events by Pubkey:');
        console.log('=====================================');
        
        // Convert Map to array and sort by number of events (descending)
        const sortedPubkeys = Array.from(eventsByPubkey.entries())
            .sort((a, b) => b[1].length - a[1].length);

        for (const [pubkey, events] of sortedPubkeys) {
            console.log(`\nPubkey: ${pubkey}`);
            console.table(events, ['blockNumber', 'amount', 'index', 'txHash', 'validation']);
        }

        console.log(`\nTotal unique pubkeys: ${eventsByPubkey.size}`);
        console.log(`Total events found: ${totalEvents}`);

    } catch (error) {
        console.error('Error fetching events:', error);
    }
}

// Run the script
fetchDepositEvents();
