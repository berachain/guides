#!/usr/bin/env node

const { ethers } = require('ethers');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
const Table = require('cli-table3');
const config = require('../config');

// ERC20 function signatures for detection
const ERC20_FUNCTIONS = {
    name: '0x06fdde03',
    symbol: '0x95d89b41',
    decimals: '0x313ce567',
    totalSupply: '0x18160ddd',
    balanceOf: '0x70a08231',
    transfer: '0xa9059cbb',
    transferFrom: '0x23b872dd',
    approve: '0x095ea7b3',
    allowance: '0xdd62ed3e'
};

// ERC20 events for additional verification
const ERC20_EVENTS = {
    Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    Approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
};

class ERC20Scanner {
    constructor(rpcUrl, options = {}) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.options = {
            batchSize: options.batchSize || 100,
            maxConcurrent: options.maxConcurrent || 5,
            minConfidence: options.minConfidence || 0.75,
            ...options
        };
        this.results = [];
        this.stats = {
            blocksScanned: 0,
            contractsFound: 0,
            erc20Contracts: 0,
            errors: 0
        };
    }

    async getLatestBlockNumber() {
        return await this.provider.getBlockNumber();
    }

    async getBlock(blockNumber) {
        try {
            return await this.provider.getBlock(blockNumber, true);
        } catch (error) {
            console.error(`Error fetching block ${blockNumber}:`, error.message);
            return null;
        }
    }

    async isERC20Contract(address) {
        try {
            const contract = new ethers.Contract(address, [], this.provider);
            
            // Check for required ERC20 functions
            const requiredFunctions = ['name', 'symbol', 'decimals', 'totalSupply'];
            const functionChecks = await Promise.allSettled(
                requiredFunctions.map(func => contract[func]())
            );

            // Count successful function calls
            const successfulCalls = functionChecks.filter(result => 
                result.status === 'fulfilled' && 
                result.value !== undefined && 
                result.value !== null
            ).length;

            // If we have at least 3 out of 4 required functions, it's likely an ERC20
            if (successfulCalls >= 3) {
                // Try to get additional details
                const details = {};
                try {
                    details.name = await contract.name();
                    details.symbol = await contract.symbol();
                    details.decimals = await contract.decimals();
                    details.totalSupply = await contract.totalSupply();
                } catch (e) {
                    // Some functions might fail, that's okay
                }
                
                return {
                    isERC20: true,
                    confidence: successfulCalls / requiredFunctions.length,
                    details
                };
            }

            return { isERC20: false, confidence: 0 };
        } catch (error) {
            return { isERC20: false, confidence: 0, error: error.message };
        }
    }

    async scanBlock(blockNumber) {
        const block = await this.getBlock(blockNumber);
        if (!block) return [];

        const contracts = [];
        
        for (const tx of block.transactions) {
            // Check if transaction created a contract
            if (tx.to === null || (tx.data && tx.data.length > 2)) {
                try {
                    const receipt = await this.provider.getTransactionReceipt(tx.hash);
                    if (receipt && receipt.contractAddress) {
                        contracts.push({
                            address: receipt.contractAddress,
                            blockNumber,
                            txHash: tx.hash,
                            creator: tx.from
                        });
                    }
                } catch (error) {
                    // Skip if we can't get receipt
                }
            }
        }

        return contracts;
    }

    async scanBlockRange(startBlock, endBlock) {
        const totalBlocks = endBlock - startBlock + 1;
        console.log(`\n🔍 Scanning blocks ${startBlock} to ${endBlock} (${totalBlocks} blocks)`);
        console.log(`📊 Batch size: ${this.options.batchSize}, Min confidence: ${this.options.minConfidence * 100}%\n`);

        const progressBar = this.createProgressBar(totalBlocks);
        let currentBlock = startBlock;

        while (currentBlock <= endBlock) {
            const batchEnd = Math.min(currentBlock + this.options.batchSize - 1, endBlock);
            const batchPromises = [];

            for (let block = currentBlock; block <= batchEnd; block++) {
                batchPromises.push(this.scanBlock(block));
            }

            try {
                const batchResults = await Promise.allSettled(batchPromises);
                const contracts = [];

                for (let i = 0; i < batchResults.length; i++) {
                    const result = batchResults[i];
                    const blockNumber = currentBlock + i;

                    if (result.status === 'fulfilled') {
                        contracts.push(...result.value);
                        this.stats.blocksScanned++;
                    } else {
                        this.stats.errors++;
                    }
                }

                if (contracts.length > 0) {
                    for (const contract of contracts) {
                        this.stats.contractsFound++;
                        const erc20Check = await this.isERC20Contract(contract.address);
                        
                        if (erc20Check.isERC20 && erc20Check.confidence >= this.options.minConfidence) {
                            this.stats.erc20Contracts++;
                            const result = {
                                ...contract,
                                ...erc20Check,
                                timestamp: new Date().toISOString()
                            };
                            this.results.push(result);
                            
                            console.log(`✅ ERC20 Contract found: ${contract.address}`);
                            console.log(`   Name: ${erc20Check.details.name || 'N/A'}`);
                            console.log(`   Symbol: ${erc20Check.details.symbol || 'N/A'}`);
                            console.log(`   Decimals: ${erc20Check.details.decimals || 'N/A'}`);
                            console.log(`   Confidence: ${(erc20Check.confidence * 100).toFixed(1)}%`);
                        }
                    }
                }

                const blocksProcessed = batchEnd - currentBlock + 1;
                progressBar.update(blocksProcessed);
                currentBlock = batchEnd + 1;

            } catch (error) {
                console.error(`Error processing batch ${currentBlock}-${batchEnd}:`, error.message);
                currentBlock = batchEnd + 1;
                this.stats.errors++;
            }
        }

        progressBar.complete();
        return this.results;
    }

    createProgressBar(total) {
        let current = 0;
        const barLength = 50;
        
        return {
            update: (increment) => {
                current += increment;
                const percentage = (current / total) * 100;
                const filledLength = Math.round((barLength * current) / total);
                const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
                process.stdout.write(`\r[${bar}] ${percentage.toFixed(1)}% (${current}/${total} blocks)`);
            },
            complete: () => {
                process.stdout.write('\n');
            }
        };
    }

    // Output formatters
    formatAsCSV() {
        const headers = ['Address', 'Name', 'Symbol', 'Decimals', 'Total Supply', 'Block Number', 'Creator', 'Confidence', 'Timestamp'];
        const rows = this.results.map(token => [
            token.address,
            `"${token.details.name || 'N/A'}"`,
            `"${token.details.symbol || 'N/A'}"`,
            token.details.decimals || 'N/A',
            token.details.totalSupply ? token.details.totalSupply.toString() : 'N/A',
            token.blockNumber,
            token.creator,
            (token.confidence * 100).toFixed(1) + '%',
            token.timestamp
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    formatAsTable() {
        const table = new Table({
            head: ['Address', 'Name', 'Symbol', 'Decimals', 'Block', 'Creator', 'Confidence'],
            colWidths: [42, 20, 8, 10, 10, 42, 12],
            style: {
                head: ['cyan', 'bold'],
                border: ['gray']
            }
        });

        this.results.forEach(token => {
            table.push([
                token.address,
                (token.details.name || 'N/A').substring(0, 20),
                (token.details.symbol || 'N/A').substring(0, 8),
                token.details.decimals || 'N/A',
                token.blockNumber.toString(),
                token.creator,
                `${(token.confidence * 100).toFixed(1)}%`
            ]);
        });

        return table.toString();
    }

    formatAsTokenList(chainId = 80094) {
        // Following the Uniswap Token List specification
        const tokenList = {
            name: "Berachain ERC20 Tokens",
            timestamp: new Date().toISOString(),
            version: {
                major: 1,
                minor: 0,
                patch: 0
            },
            tokens: this.results.map(token => ({
                chainId: chainId,
                address: token.address,
                symbol: token.details.symbol || 'UNKNOWN',
                name: token.details.name || 'Unknown Token',
                decimals: token.details.decimals || 18,
                logoURI: null,
                tags: ['erc20'],
                extensions: {
                    confidence: token.confidence,
                    blockNumber: token.blockNumber,
                    creator: token.creator,
                    timestamp: token.timestamp
                }
            })),
            logoURI: null,
            keywords: ['berachain', 'erc20', 'tokens'],
            tags: {
                erc20: {
                    name: "ERC20",
                    description: "Tokens that conform to the ERC20 standard"
                }
            }
        };

        return JSON.stringify(tokenList, null, 2);
    }

    async saveResults(filename, format = 'json') {
        let content;
        let extension;

        switch (format.toLowerCase()) {
            case 'csv':
                content = this.formatAsCSV();
                extension = 'csv';
                break;
            case 'table':
                content = this.formatAsTable();
                extension = 'txt';
                break;
            case 'tokenlist':
                content = this.formatAsTokenList();
                extension = 'tokenlist.json';
                break;
            default:
                const output = {
                    scanInfo: {
                        timestamp: new Date().toISOString(),
                        stats: this.stats,
                        totalERC20Contracts: this.results.length
                    },
                    contracts: this.results
                };
                content = JSON.stringify(output, null, 2);
                extension = 'json';
        }

        const outputFile = filename.replace(/\.[^/.]+$/, '') + '.' + extension;
        fs.writeFileSync(outputFile, content);
        console.log(`\n💾 Results saved to: ${outputFile}`);
        
        return outputFile;
    }

    printSummary() {
        console.log('\n📊 Scan Summary');
        console.log('==============');
        console.log(`Blocks scanned: ${this.stats.blocksScanned}`);
        console.log(`Total contracts found: ${this.stats.contractsFound}`);
        console.log(`ERC20 contracts identified: ${this.stats.erc20Contracts}`);
        console.log(`Errors encountered: ${this.stats.errors}`);
        
        if (this.results.length > 0) {
            console.log('\n🏆 Top ERC20 Contracts by Confidence:');
            const sorted = [...this.results].sort((a, b) => b.confidence - a.confidence);
            sorted.slice(0, 10).forEach((contract, index) => {
                console.log(`${index + 1}. ${contract.address} (${(contract.confidence * 100).toFixed(1)}%)`);
                if (contract.details.name) {
                    console.log(`   ${contract.details.name} (${contract.details.symbol})`);
                }
            });
        }
    }
}

async function main() {
    const argv = yargs(hideBin(process.argv))
        .option('rpc', {
            alias: 'r',
            description: 'RPC URL for the blockchain',
            type: 'string',
            default: config.EL_ETHRPC_URL
        })
        .option('cl-rpc', {
            description: 'Consensus layer RPC URL (for future use)',
            type: 'string',
            default: config.CL_ETHRPC_URL
        })
        .option('abis-dir', {
            description: 'Directory for ABI files',
            type: 'string',
            default: config.ABIS_DIR
        })
        .option('start', {
            alias: 's',
            description: 'Starting block number',
            type: 'number'
        })
        .option('end', {
            alias: 'e',
            description: 'Ending block number',
            type: 'number'
        })
        .option('blocks', {
            alias: 'b',
            description: 'Number of blocks to scan from the latest',
            type: 'number',
            default: 1000000
        })
        .option('output', {
            alias: 'o',
            description: 'Output file for results',
            type: 'string',
            default: 'erc20-scan-results'
        })
        .option('format', {
            alias: 'f',
            description: 'Output format: json, csv, table, tokenlist',
            type: 'string',
            choices: ['json', 'csv', 'table', 'tokenlist'],
            default: 'json'
        })
        .option('min-confidence', {
            description: 'Minimum confidence threshold (0.0-1.0)',
            type: 'number',
            default: 0.75
        })
        .option('batch-size', {
            description: 'Number of blocks to process in each batch',
            type: 'number',
            default: 100
        })
        .option('max-concurrent', {
            description: 'Maximum concurrent requests',
            type: 'number',
            default: 5
        })
        .help()
        .alias('help', 'h')
        .argv;

    console.log('🔍 Berachain ERC20 Scanner');
    console.log('==========================\n');

    const scanner = new ERC20Scanner(argv.rpc, {
        batchSize: argv.batchSize,
        maxConcurrent: argv.maxConcurrent,
        minConfidence: argv.minConfidence
    });

    try {
        const latestBlock = await scanner.getLatestBlockNumber();
        console.log(`📡 Connected to: ${argv.rpc}`);
        console.log(`🔢 Latest block: ${latestBlock}`);

        let startBlock, endBlock;

        if (argv.start !== undefined && argv.end !== undefined) {
            startBlock = argv.start;
            endBlock = argv.end;
        } else {
            endBlock = latestBlock;
            startBlock = Math.max(0, endBlock - argv.blocks + 1);
        }

        console.log(`🎯 Scan range: ${startBlock} to ${endBlock}`);
        console.log(`📤 Output format: ${argv.format}`);

        const startTime = Date.now();
        await scanner.scanBlockRange(startBlock, endBlock);
        const endTime = Date.now();

        scanner.printSummary();
        await scanner.saveResults(argv.output, argv.format);

        const duration = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`\n⏱️  Scan completed in ${duration} seconds`);

    } catch (error) {
        console.error('❌ Error during scan:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = ERC20Scanner; 