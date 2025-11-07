#!/usr/bin/env node

/**
 * Berachain Proposer Activity Scanner
 * 
 * This script scans the consensus layer backwards on mainnet to find:
 * 1. When a specific proposer last voted on a block (appeared in last_commit)
 * 2. When a specific proposer last proposed a block (was the block proposer)
 * 
 * The script is flexible and can scan for any proposer by address.
 * 
 * Key Features:
 * - Efficient backwards block scanning from latest block
 * - Tracks both voting activity (last_commit signatures) and proposal activity
 * - Flexible proposer input (with or without 0x prefix)
 * - Progress reporting with block scanning status
 * - Validator name lookup via database
 * - Configurable scan limits to prevent infinite loops
 * 
 * Usage: node scan-proposer-activity.js [options]
 * 
 * Dad joke: Why don't validators ever get lost? Because they always know their last commit! 🏗️
 */

const { ValidatorNameDB, BlockFetcher, ProgressReporter, ConfigHelper } = require('./lib/shared-utils');
const yargs = require('yargs');
const axios = require('axios');

class ProposerActivityScanner {
    constructor(baseUrl, proposerAddress) {
        this.baseUrl = baseUrl;
        this.proposerAddress = this.normalizeAddress(proposerAddress);
        this.validatorDB = new ValidatorNameDB();
        this.blockFetcher = new BlockFetcher(baseUrl);
        
        // Track findings
        this.lastVoted = null;
        this.lastProposed = null;
        this.scannedBlocks = 0;
    }
    
    normalizeAddress(address) {
        // Remove 0x prefix if present and convert to uppercase for consistency
        return address.replace(/^0x/i, '').toUpperCase();
    }
    
    async getLatestBlockHeight() {
        try {
            const response = await axios.get(`${this.baseUrl}/status`);
            return parseInt(response.data.result.sync_info.latest_block_height);
        } catch (error) {
            console.error('Failed to get latest block height:', error.message);
            throw error;
        }
    }
    
    async scanBlock(height) {
        try {
            const blockData = await this.blockFetcher.getBlock(height);
            if (!blockData || !blockData.result || !blockData.result.block) return false;
            
            const block = blockData.result.block;
            
            this.scannedBlocks++;
            
            // Check if this proposer proposed this block
            const blockProposer = this.normalizeAddress(block.header.proposer_address);
            if (blockProposer === this.proposerAddress && !this.lastProposed) {
                this.lastProposed = {
                    height: height,
                    timestamp: block.header.time,
                    hash: block.block_id?.hash || 'N/A'
                };
                console.log(`✅ Found last proposal at block ${height} (${block.header.time})`);
            }
            
            // Check if this proposer voted in the last_commit (for the previous block)
            if (block.last_commit && block.last_commit.signatures && !this.lastVoted) {
                for (const signature of block.last_commit.signatures) {
                    if (signature.validator_address) {
                        const voterAddress = this.normalizeAddress(signature.validator_address);
                        if (voterAddress === this.proposerAddress) {
                            this.lastVoted = {
                                height: height - 1, // last_commit is for the previous block
                                timestamp: block.header.time,
                                blockHash: block.last_commit.block_id?.hash || 'N/A',
                                signature: signature.signature || 'N/A'
                            };
                            console.log(`✅ Found last vote for block ${height - 1} (recorded in block ${height})`);
                            break;
                        }
                    }
                }
            }
            
            // Return true if we found both activities
            return this.lastVoted && this.lastProposed;
            
        } catch (error) {
            console.error(`Error scanning block ${height}:`, error.message);
            return false;
        }
    }
    
    async scanBackwards(maxBlocks = 50000) {
        console.log(`🔍 Scanning backwards for proposer: ${this.proposerAddress}`);
        
        // Get validator name if possible
        const validatorName = await this.validatorDB.getValidatorName(this.proposerAddress);
        if (validatorName) {
            console.log(`📋 Validator name: ${validatorName}`);
        }
        
        const latestHeight = await this.getLatestBlockHeight();
        console.log(`📊 Starting from latest block: ${latestHeight}`);
        
        const unlimited = maxBlocks === 0;
        if (unlimited) {
            console.log(`🚀 Unlimited scan mode - will search until both activities found or reach block 1`);
        }
        
        const startTime = Date.now();
        let lastProgressTime = startTime;
        
        for (let height = latestHeight; height > 0; height--) {
            const scanCount = latestHeight - height + 1;
            
            // Check if we should stop due to maxBlocks limit
            if (!unlimited && scanCount > maxBlocks) {
                break;
            }
            
            const found = await this.scanBlock(height);
            
            // Show progress every 50 blocks or every 5 seconds, whichever comes first
            const now = Date.now();
            if (scanCount % 50 === 0 || (now - lastProgressTime) > 5000) {
                const elapsed = (now - startTime) / 1000;
                const blocksPerSec = scanCount / elapsed;
                const progressText = unlimited 
                    ? `Block ${height} | Scanned: ${scanCount.toLocaleString()} | Speed: ${blocksPerSec.toFixed(1)} blocks/sec`
                    : `${scanCount.toLocaleString()}/${maxBlocks.toLocaleString()} (${((scanCount/maxBlocks)*100).toFixed(1)}%) | Block ${height} | Speed: ${blocksPerSec.toFixed(1)} blocks/sec`;
                
                if (unlimited) {
                    process.stdout.write(`\r${progressText}`);
                } else {
                    ProgressReporter.showProgress(scanCount, maxBlocks, height);
                }
                lastProgressTime = now;
            }
            
            // Stop early if we found both activities
            if (found) {
                ProgressReporter.clearProgress();
                console.log(`\n🎯 Found both activities! Stopping scan early.`);
                break;
            }
            
            // Show status when we find one activity
            if ((this.lastVoted || this.lastProposed) && scanCount % 1000 === 0) {
                const foundStatus = this.lastVoted && this.lastProposed ? "both" :
                                   this.lastVoted ? "vote only" : "proposal only";
                console.log(`\n📍 Status update: Found ${foundStatus} so far, continuing search...`);
            }
            
            // Add a small delay to be nice to the RPC every 100 blocks
            if (height % 100 === 0) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }
        
        ProgressReporter.clearProgress();
        console.log(''); // Add newline after progress
        this.displayResults();
    }
    
    displayResults() {
        console.log('\n' + '='.repeat(80));
        console.log(`📈 PROPOSER ACTIVITY SCAN RESULTS`);
        console.log('='.repeat(80));
        
        console.log(`🔍 Proposer Address: ${this.proposerAddress}`);
        console.log(`📊 Blocks Scanned: ${this.scannedBlocks}`);
        
        console.log('\n📝 LAST PROPOSAL:');
        if (this.lastProposed) {
            console.log(`   Block Height: ${this.lastProposed.height}`);
            console.log(`   Timestamp: ${this.lastProposed.timestamp}`);
            console.log(`   Block Hash: ${this.lastProposed.hash}`);
        } else {
            console.log(`   ❌ No proposals found in scanned range`);
        }
        
        console.log('\n🗳️  LAST VOTE:');
        if (this.lastVoted) {
            console.log(`   Voted on Block: ${this.lastVoted.height}`);
            console.log(`   Recorded in Block: ${this.lastVoted.height + 1}`);
            console.log(`   Timestamp: ${this.lastVoted.timestamp}`);
            console.log(`   Block Hash: ${this.lastVoted.blockHash}`);
            console.log(`   Has Signature: ${this.lastVoted.signature ? 'Yes' : 'No'}`);
        } else {
            console.log(`   ❌ No votes found in scanned range`);
        }
        
        console.log('\n' + '='.repeat(80));
        
        if (!this.lastProposed && !this.lastVoted) {
            console.log(`⚠️  No activity found for this proposer in the scanned range.`);
            console.log(`   Try increasing --max-blocks or check if the address is correct.`);
        }
    }
}

// Command line argument parsing
const argv = yargs(process.argv.slice(2))
    .usage('Usage: $0 [options]')
    .option('proposer', {
        alias: 'p',
        describe: 'Proposer address to scan for (with or without 0x prefix)',
        type: 'string',
        default: '497D6DE4FA4F3FADE96D7AB1942A7E258D42F4CE'
    })
    .option('chain', {
        alias: 'c',
        describe: 'Chain to scan (mainnet or bepolia)',
        type: 'string',
        default: 'mainnet',
        choices: ['mainnet', 'bepolia']
    })
    .option('max-blocks', {
        alias: 'm',
        describe: 'Maximum number of blocks to scan backwards (0 = no limit)',
        type: 'number',
        default: 50000
    })
    .option('help', {
        alias: 'h',
        describe: 'Show help'
    })
    .example('$0', 'Scan for default proposer on mainnet')
    .example('$0 -p 0x1234...ABCD', 'Scan for specific proposer')
    .example('$0 -c bepolia -m 5000', 'Scan bepolia testnet with custom limit')
    .example('$0 -m 0', 'Unlimited scan until both activities found')
    .help()
    .argv;

async function main() {
    try {
        const chainConfig = ConfigHelper.getChainConfig(argv.chain);
        const baseUrl = ConfigHelper.getBlockScannerUrl(argv.chain);
        
        console.log(`🚀 Berachain Proposer Activity Scanner`);
        console.log(`🌐 Network: ${chainConfig.name}`);
        console.log(`🔗 RPC URL: ${baseUrl}`);
        console.log('');
        
        const scanner = new ProposerActivityScanner(baseUrl, argv.proposer);
        await scanner.scanBackwards(argv['max-blocks']);
        
    } catch (error) {
        console.error('❌ Scanner failed:', error.message);
        process.exit(1);
    }
}

// Run the scanner if this script is executed directly
if (require.main === module) {
    main();
}

module.exports = { ProposerActivityScanner };
