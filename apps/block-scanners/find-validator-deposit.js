/**
 * Find the deposit transaction for a specific validator pubkey
 * Starting from the beginning of 2026
 */

const { ethers } = require('ethers');
const { ConfigHelper, withRetry, hashEvent, decodeEventData, scanLogsInChunks } = require('./lib/shared-utils');

// Validator pubkey from URL
const TARGET_PUBKEY = '0xb8cb7205f642e6cb370cc9d1a9b229381f50f34f2e5aa5db8ef8c7c6016d034687f871afb9d3e2a583a782c0c881e31e';

// Estimated block for Jan 1, 2026 00:00:00 UTC (2 second block time)
const START_BLOCK = 14943401;

// Configuration
const chainName = 'mainnet';
const RPC_URL = ConfigHelper.getRpcUrl('el', chainName);
const CONTRACT_ADDRESS = ConfigHelper.getBeaconDepositAddress(chainName);
const BLOCK_CHUNK_SIZE = ConfigHelper.getDefaultLogChunkSize();

// Event signature/topic
const DEPOSIT_EVENT_SIGNATURE = 'Deposit(bytes,bytes,uint64,bytes,uint64)';
const DEPOSIT_TOPIC = hashEvent(DEPOSIT_EVENT_SIGNATURE);

async function findValidatorDeposit() {
    try {
        if (!RPC_URL) {
            console.error('Error: No RPC URL provided.');
            process.exit(1);
        }

        console.log(`Searching for validator deposit transaction...`);
        console.log(`Validator pubkey: ${TARGET_PUBKEY}`);
        console.log(`Starting from block: ${START_BLOCK.toLocaleString()}`);
        console.log(`Contract: ${CONTRACT_ADDRESS}\n`);

        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const latestBlock = await withRetry(() => provider.getBlockNumber());
        console.log(`Latest block: ${latestBlock.toLocaleString()}\n`);

        let found = false;

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

                    // Normalize pubkey for comparison (remove 0x prefix and compare)
                    const eventPubkey = pubkey.toLowerCase();
                    const targetPubkey = TARGET_PUBKEY.toLowerCase();

                    if (eventPubkey === targetPubkey) {
                        found = true;
                        console.log('\n✅ Found deposit transaction!');
                        console.log('=====================================');
                        console.log(`Transaction Hash: ${event.transactionHash}`);
                        console.log(`Block Number: ${event.blockNumber.toLocaleString()}`);
                        console.log(`Deposit Index: ${index.toString()}`);
                        console.log(`Amount: ${ethers.formatEther(amount.toString())} BERA`);
                        console.log(`Pubkey: ${pubkey}`);
                        console.log(`Withdrawal Credentials: ${credentials}`);
                        console.log(`\nView on Berascan: https://berascan.com/tx/${event.transactionHash}`);
                        console.log(`\nView on Berascan (block): https://berascan.com/block/${event.blockNumber}`);
                        return; // Exit early once found
                    }
                }
                process.stdout.write(`\rScanned blocks ${from.toLocaleString()} - ${to.toLocaleString()}...`);
            }
        });

        if (!found) {
            console.log('\n❌ No deposit transaction found for this validator pubkey starting from block', START_BLOCK.toLocaleString());
            console.log('The validator may have been created before 2026, or the pubkey may be incorrect.');
        }

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

findValidatorDeposit();
