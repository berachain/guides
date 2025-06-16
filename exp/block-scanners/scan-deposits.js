const { ethers } = require('ethers');
const BeaconDepositABI = require(process.env.ABI_DIR + '/core/BeaconDeposit.json');
const cliProgress = require('cli-progress');
const { execSync } = require('child_process');

// Verify required environment variables
const requiredEnvVars = ['ABI_DIR', 'EL_ETHRPC_URL'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('Error: Missing required environment variables:');
    missingEnvVars.forEach(envVar => console.error(`- ${envVar}`));
    process.exit(1);
}

// Configuration
const RPC_URL = process.env.EL_ETHRPC_URL;
const CONTRACT_ADDRESS = '0x4242424242424242424242424242424242424242'; // Replace with the BeaconDeposit contract address
const START_BLOCK = 0; 
const BLOCK_CHUNK_SIZE = 10000;
const GENESIS_FORK_VERSION = '0xdf609e3b062842c6425ff716aec2d2092c46455d9b2e1a2c9e32c6ba63ff0bda';

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
        // Initialize provider
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        // Create contract instance
        const contract = new ethers.Contract(
            CONTRACT_ADDRESS,
            BeaconDepositABI,
            provider
        );

        // Get the latest block number
        const latestBlock = await provider.getBlockNumber();
        console.log(`Latest block number: ${latestBlock}`);

        // Get the Deposit event filter
        const DEPOSIT_TOPIC = '0x68af751683498a9f9be59fe8b0d52a64dd155255d85cdb29fea30b1e3f891d46';

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
        
        // Process blocks in chunks
        for (let fromBlock = START_BLOCK; fromBlock <= latestBlock; fromBlock += BLOCK_CHUNK_SIZE) {
            const toBlock = Math.min(fromBlock + BLOCK_CHUNK_SIZE - 1, latestBlock);
            const chunkSize = toBlock - fromBlock + 1;

            // Fetch events for this chunk
            const events = await provider.getLogs({
                address: CONTRACT_ADDRESS,
                topics: [DEPOSIT_TOPIC],
                fromBlock,
                toBlock
            });

            // Store events by pubkey
            for (const event of events) {
                const parsedEvent = contract.interface.parseLog(event);
                const pubkey = parsedEvent.args.pubkey;
                const withdrawalCredentials = parsedEvent.args.credentials;
                const amount = parsedEvent.args.amount.toString();
                const signature = parsedEvent.args.signature;
                
                if (!eventsByPubkey.has(pubkey)) {
                    eventsByPubkey.set(pubkey, []);
                }

                const validationStatus = await validateDeposit(
                    pubkey,
                    withdrawalCredentials,
                    amount,
                    signature
                );

                eventsByPubkey.get(pubkey).push({
                    blockNumber: event.blockNumber,
                    amount: amount,
                    index: parsedEvent.args.index.toString(),
                    txHash: event.transactionHash,
                    validation: validationStatus
                });
            }

            totalEvents += events.length;
            progressBar.update(toBlock - START_BLOCK + 1, { events: totalEvents });
        }

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
