#!/usr/bin/env node

/**
 * Voting Power Analysis - Validator Performance Analyzer
 * 
 * This script analyzes validator performance by examining block proposals, client types,
 * and voting patterns. It decodes extraData from blocks to identify execution clients
 * and provides comprehensive statistics on validator behavior and block production.
 * 
 * Features:
 * - Decodes RLP-encoded extraData to identify client types and versions
 * - Analyzes validator block proposal patterns
 * - Tracks client distribution across validators
 * - Provides detailed performance metrics and statistics
 * - Supports custom block range analysis
 * - Client upgrade tracking across time
 * 
 * Usage: node analyze-voting-power.js [--blocks N] [--detailed] [--upgrade] [--verbose] [--network mainnet|bepolia]
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const Table = require('cli-table3');
const moment = require('moment');

const { ValidatorNameDB, BlockFetcher, StatUtils, ProgressReporter, ConfigHelper, config } = require('./lib/shared-utils');

// Client classification
function classifyClient(clientString) {
    const lower = clientString.toLowerCase();
    
    if (lower.includes('besu')) return 'Besu';
    if (lower.includes('geth')) return 'Geth';
    if (lower.includes('nethermind')) return 'Nethermind';
    if (lower.includes('erigon')) return 'Erigon';
    if (lower.includes('reth')) return 'Reth';
    
    return 'Unknown';
}

// Enhanced extraData decoder with RLP support
async function decodeExtraDataAsAscii(extraData) {
    if (!extraData || extraData === '0x' || extraData.length <= 2) {
        return 'Empty';
    }
    
    try {
        // Remove '0x' prefix if present
        const hexString = extraData.startsWith('0x') ? extraData.slice(2) : extraData;
        
        // Convert hex to bytes
        const bytes = [];
        for (let i = 0; i < hexString.length; i += 2) {
            bytes.push(parseInt(hexString.substr(i, 2), 16));
        }
        
        // Try to decode as RLP first
        const rlpDecoded = decodeRLP(bytes);
        if (rlpDecoded && Array.isArray(rlpDecoded)) {
            // Check if we have exactly 4 fields
            if (rlpDecoded.length === 4) {
                const firstField = rlpDecoded[0];
                const secondField = rlpDecoded[1];
                
                // Check if first field has length 3 or 4 (likely a version number)
                if (firstField && (firstField.length === 3 || firstField.length === 4)) {
                    // First field is binary values with version number
                    // Second field is client name as ASCII
                    if (secondField && typeof secondField === 'string' && secondField.trim().length > 0) {
                        const clientName = secondField.replace(/[\x00-\x1F\x7F]/g, '').trim();
                        if (clientName.length > 0) {
                            // Convert the raw bytes of firstField to version string
                            const versionBytes = Array.from(firstField).map(char => char.charCodeAt(0));
                            const versionString = versionBytes.join('.');
                            return `${clientName} v${versionString}`;
                        }
                    }
                }
            }
            
            // Fallback to original logic for other cases
            const cleanItems = rlpDecoded
                .map(item => item.replace(/[\x00-\x1F\x7F]/g, '').trim())
                .filter(item => item.length > 0);
            
            if (cleanItems.length >= 3) {
                const client = cleanItems[0] || 'unknown';
                
                // Only return if we have meaningful data
                if (client && client !== 'unknown') {
                    return `${client}`;
                }
            }
        }
        
        // Fallback: try direct ASCII conversion
        const asciiString = String.fromCharCode(...bytes);
        const isValidAscii = /^[\x20-\x7E]*$/.test(asciiString);
        
        if (isValidAscii && asciiString.trim().length > 0) {
            return asciiString.trim();
        } else {
            return `Hex: ${extraData}`;
        }
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

function decodeRLP(bytes) {
    if (bytes.length === 0) return null;
    
    const firstByte = bytes[0];
    
    // Single byte
    if (firstByte < 0x80) {
        return String.fromCharCode(firstByte);
    }
    
    // String with length < 56
    if (firstByte < 0xb8) {
        const length = firstByte - 0x80;
        if (length === 0) return '';
        const data = bytes.slice(1, 1 + length);
        return data.map(b => String.fromCharCode(b)).join('');
    }
    
    // String with length >= 56
    if (firstByte < 0xc0) {
        const lengthBytes = firstByte - 0xb7;
        const length = parseInt(bytes.slice(1, 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        const data = bytes.slice(1 + lengthBytes, 1 + lengthBytes + length);
        return data.map(b => String.fromCharCode(b)).join('');
    }
    
    // List with length < 56
    if (firstByte < 0xf8) {
        const length = firstByte - 0xc0;
        const data = bytes.slice(1, 1 + length);
        return decodeRLPList(data);
    }
    
    // List with length >= 56
    if (firstByte < 0x100) {
        const lengthBytes = firstByte - 0xf7;
        const length = parseInt(bytes.slice(1, 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        const data = bytes.slice(1 + lengthBytes, 1 + lengthBytes + length);
        return decodeRLPList(data);
    }
    
    return null;
}

function decodeRLPList(bytes) {
    const result = [];
    let offset = 0;
    
    while (offset < bytes.length) {
        const decoded = decodeRLP(bytes.slice(offset));
        if (decoded === null) break;
        
        result.push(decoded);
        
        // Calculate the number of bytes consumed
        const firstByte = bytes[offset];
        if (firstByte < 0x80) {
            offset += 1;
        } else if (firstByte < 0xb8) {
            offset += 1 + (firstByte - 0x80);
        } else if (firstByte < 0xc0) {
            const lengthBytes = firstByte - 0xb7;
            const length = parseInt(bytes.slice(offset + 1, offset + 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
            offset += 1 + lengthBytes + length;
        } else if (firstByte < 0xf8) {
            offset += 1 + (firstByte - 0xc0);
        } else {
            const lengthBytes = firstByte - 0xf7;
            const length = parseInt(bytes.slice(offset + 1, offset + 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
            offset += 1 + lengthBytes + length;
        }
    }
    
    return result;
}

// Extract client version from client string
function extractClientVersion(clientString) {
    const versionMatch = clientString.match(/v?(\d+\.\d+\.\d+)/);
    if (versionMatch) {
        return versionMatch[1];
    }
    
    // Try to extract just major version if full version not found
    const majorMatch = clientString.match(/v?(\d+)/);
    if (majorMatch) {
        return `${majorMatch[1]}.x.x`;
    }
    
    return 'unknown';
}

// Fetch validators from consensus layer with proper pagination
async function fetchValidators(clRpcUrl) {
    try {
        const validators = [];
        let page = 1;
        const perPage = 100; // Reasonable page size for API pagination
        
        // Paginate through all validators
        while (true) {
            const response = await axios.get(`${clRpcUrl}/validators?per_page=${perPage}&page=${page}`);
            
            if (!response.data.result?.validators || response.data.result.validators.length === 0) {
                break; // No more validators to fetch
            }
            
            // Process each validator in this page
            const pageValidators = response.data.result.validators.map(validator => ({
                address: validator.address,
                votingPower: parseInt(validator.voting_power),
                pubKey: validator.pub_key
            }));
            
            validators.push(...pageValidators);
            
            // Check if we've reached the end of results
            if (response.data.result.validators.length < perPage) {
                break; // Last page
            }
            
            page++; // Continue to next page
        }
        
        return validators;
    } catch (error) {
        console.error('Error fetching validators:', error.message);
        return [];
    }
}

// Get block proposer from consensus layer
async function getBlockProposer(blockHeight, clRpcUrl) {
    try {
        const response = await axios.get(`${clRpcUrl}/block?height=${blockHeight}`);
        return response.data.result.block.header.proposer_address;
    } catch (error) {
        return null;
    }
}

async function analyzeVotingPower(networkName = 'mainnet', maxBlocksToScan = 10000, detailedMode = false, upgradeMode = false, verboseMode = false) {
    // Get network configuration
    const networkConfig = ConfigHelper.getChainConfig(networkName);
    const elProvider = new ethers.JsonRpcProvider(networkConfig.el);
    const clRpcUrl = networkConfig.cl;
    
    // Initialize validator name database
    const validatorDB = new ValidatorNameDB();
    
    ProgressReporter.logStep('Fetching validators from consensus layer');
    const validators = await fetchValidators(clRpcUrl);
    
    if (validators.length === 0) {
        ProgressReporter.logError('No validators found');
        return;
    }
    
    ProgressReporter.logSuccess(`Found ${validators.length} validators`);
    
    // Create map for quick lookup
    const validatorMap = new Map();
    validators.forEach(validator => {
        validatorMap.set(validator.address, validator.votingPower);
    });
    
    // Get current block number
    ProgressReporter.logStep('Getting current block number');
    const currentBlock = await elProvider.getBlockNumber();
    ProgressReporter.logSuccess(`Current block: ${currentBlock.toLocaleString()}`);
    
    // Scan blocks backwards to identify client for each validator
    const proposerClients = new Map(); // proposer_address -> client_info
    const seenProposers = new Set();
    let blocksScanned = 0;
    
    // For upgrade tracking mode
    const validatorUpgrades = new Map(); // proposer_address -> {firstSeen: {...}, upgrades: [...]}
    const validatorsWithUpgrades = new Set(); // Track which validators have at least one upgrade
    
    ProgressReporter.logStep(`Scanning ${maxBlocksToScan.toLocaleString()} blocks backwards from ${currentBlock.toLocaleString()}`);
    
    for (let blockNum = currentBlock; blockNum > currentBlock - maxBlocksToScan; blockNum--) {
        // Progress reporting every 1000 blocks
        if (blocksScanned % 1000 === 0) {
            if (upgradeMode) {
                ProgressReporter.showProgress(blocksScanned, maxBlocksToScan);
                console.log(` - ${seenProposers.size}/${validators.length} validators seen, ${validatorsWithUpgrades.size} with upgrades`);
            } else {
                ProgressReporter.showProgress(blocksScanned, maxBlocksToScan);
                console.log(` - ${seenProposers.size}/${validators.length} validators identified`);
            }
        }
        
        try {
            blocksScanned++;
            
            // Get proposer address from CL first (cheap)
            const proposerAddress = await getBlockProposer(blockNum, clRpcUrl);
            if (!proposerAddress) continue;
            
            // In normal mode, skip if we already know this proposer's client
            if (!upgradeMode && seenProposers.has(proposerAddress)) {
                continue;
            }
            
            // In upgrade mode, if we already have upgrade history for this validator, we can skip
            if (upgradeMode && validatorsWithUpgrades.has(proposerAddress)) {
                continue;
            }
            
            // Only now fetch block from EL to extract extraData (expensive operation)
            const block = await elProvider.getBlock(blockNum);
            if (!block) continue;
            
            // Decode client from extraData
            const clientString = await decodeExtraDataAsAscii(block.extraData);
            const clientType = classifyClient(clientString);
            const clientVersion = extractClientVersion(clientString);
            
            // Set/update proposer client info (always update in upgrade mode for latest sample)
            if (!proposerClients.has(proposerAddress)) {
                proposerClients.set(proposerAddress, {
                    clientType,
                    clientString,
                    clientVersion,
                    sampleBlock: blockNum,
                    extraData: block.extraData
                });
                seenProposers.add(proposerAddress);
            }
            
            // Track upgrades in upgrade mode
            if (upgradeMode) {
                if (!validatorUpgrades.has(proposerAddress)) {
                    // First time seeing this validator - record as "first seen"
                    validatorUpgrades.set(proposerAddress, {
                        firstSeen: {
                            block: blockNum,
                            timestamp: block.timestamp,
                            clientString,
                            clientType,
                            clientVersion
                        },
                        upgrades: []
                    });
                } else {
                    // Check if this is an upgrade (different client or version)
                    const history = validatorUpgrades.get(proposerAddress);
                    const lastKnown = history.upgrades.length > 0 ? history.upgrades[history.upgrades.length - 1] : history.firstSeen;
                    
                    if (lastKnown.clientString !== clientString || lastKnown.clientVersion !== clientVersion) {
                        history.upgrades.push({
                            block: blockNum,
                            timestamp: block.timestamp,
                            clientString,
                            clientType,
                            clientVersion,
                            previousClientString: lastKnown.clientString,
                            previousClientType: lastKnown.clientType,
                            previousClientVersion: lastKnown.clientVersion
                        });
                        validatorsWithUpgrades.add(proposerAddress);
                    }
                }
            }
            
        } catch (error) {
            console.error(`Error processing block ${blockNum}:`, error.message);
        }
    }
    
    ProgressReporter.clearProgress();
    ProgressReporter.logSuccess(`Scanned ${blocksScanned.toLocaleString()} blocks, identified ${seenProposers.size}/${validators.length} validators`);
    
    // Analyze results
    const clientStats = new Map();
    const versionStats = new Map();
    let totalVotingPower = 0;
    let analyzedVotingPower = 0;
    
    // Calculate total voting power
    validators.forEach(validator => {
        totalVotingPower += validator.votingPower;
    });
    
    // Analyze identified validators
    for (const [proposerAddress, clientInfo] of proposerClients.entries()) {
        const votingPower = validatorMap.get(proposerAddress)/1000000000 || 0;
        analyzedVotingPower += votingPower;
        
        // Client type stats
        if (!clientStats.has(clientInfo.clientType)) {
            clientStats.set(clientInfo.clientType, { count: 0, votingPower: 0 });
        }
        const clientStat = clientStats.get(clientInfo.clientType);
        clientStat.count++;
        clientStat.votingPower += votingPower;
        
        // Version stats
        const versionKey = `${clientInfo.clientType} ${clientInfo.clientVersion}`;
        if (!versionStats.has(versionKey)) {
            versionStats.set(versionKey, { count: 0, votingPower: 0 });
        }
        const versionStat = versionStats.get(versionKey);
        versionStat.count++;
        versionStat.votingPower += votingPower;
    }
    
    // Display results
    console.log('\n' + '=' .repeat(80));
    console.log('📊 VOTING POWER ANALYSIS RESULTS');
    console.log('=' .repeat(80));
    
    console.log(`\nTotal validators: ${validators.length.toLocaleString()}`);
    console.log(`Identified validators: ${seenProposers.size.toLocaleString()} (${((seenProposers.size / validators.length) * 100).toFixed(1)}%)`);
    console.log(`Total voting power: ${totalVotingPower.toLocaleString()}`);
    console.log(`Analyzed voting power: ${analyzedVotingPower.toLocaleString()} (${((analyzedVotingPower / totalVotingPower) * 100).toFixed(1)}%)`);
    
    // Client distribution table
    console.log('\n📈 CLIENT DISTRIBUTION:');
    const clientTable = new Table({
        head: ['Client', 'Validators', 'Voting Power', '% by Count', '% by Power'],
        colWidths: [15, 12, 25, 12, 12]
    });
    
    const sortedClients = Array.from(clientStats.entries()).sort((a, b) => b[1].votingPower - a[1].votingPower);
    
    for (const [clientType, stats] of sortedClients) {
        clientTable.push([
            clientType,
            stats.count.toLocaleString(),
            stats.votingPower.toLocaleString(),
            `${((stats.count / seenProposers.size) * 100).toFixed(1)}%`,
            `${((stats.votingPower / analyzedVotingPower) * 100).toFixed(1)}%`
        ]);
    }
    
    console.log(clientTable.toString());
    
    if (detailedMode) {
        // Version distribution table
        console.log('\n📋 VERSION DISTRIBUTION:');
        const versionTable = new Table({
            head: ['Client Version', 'Validators', 'Voting Power', '% by Count', '% by Power'],
            colWidths: [25, 12, 25, 12, 12]
        });
        
        const sortedVersions = Array.from(versionStats.entries()).sort((a, b) => b[1].votingPower - a[1].votingPower);
        
        for (const [version, stats] of sortedVersions) {
            versionTable.push([
                version,
                stats.count.toLocaleString(),
                stats.votingPower.toLocaleString(),
                `${((stats.count / seenProposers.size) * 100).toFixed(1)}%`,
                `${((stats.votingPower / analyzedVotingPower) * 100).toFixed(1)}%`
            ]);
        }
        
        console.log(versionTable.toString());
    }

    if (detailedMode || verboseMode) {
        console.log('\n🧾 VALIDATOR VERSIONS:');
        const validatorTable = new Table({
            head: ['Validator', 'Address', 'Client', 'Version', 'Voting Power'],
            colWidths: [28, 18, 12, 12, 18]
        });

        const entries = await Promise.all(Array.from(proposerClients.entries()).map(async ([address, info]) => {
            const name = await validatorDB.getValidatorName(address);
            const vp = (validatorMap.get(address) / 1000000000) || 0;
            return {
                name: name || address.substring(0, 12) + '...',
                shortAddress: address.substring(0, 12) + '...',
                client: info.clientType,
                version: info.clientVersion,
                votingPower: vp
            };
        }));

        entries.sort((a, b) => b.votingPower - a.votingPower);

        for (const e of entries) {
            validatorTable.push([
                e.name,
                e.shortAddress,
                e.client,
                e.version,
                e.votingPower.toLocaleString()
            ]);
        }

        console.log(validatorTable.toString());
    }
    
    if (upgradeMode && validatorsWithUpgrades.size > 0) {
        console.log('\n🔄 CLIENT UPGRADES DETECTED:');
        console.log(`Found ${validatorsWithUpgrades.size} validators with client upgrades\n`);
        
        for (const [proposerAddress, upgradeHistory] of validatorUpgrades.entries()) {
            if (upgradeHistory.upgrades.length === 0) continue;
            
            const validatorName = await validatorDB.getValidatorName(proposerAddress);
            const displayName = validatorName || proposerAddress.substring(0, 12) + '...';
            
            console.log(`Validator: ${displayName}`);
            console.log(`  First seen: ${upgradeHistory.firstSeen.clientString} (block ${upgradeHistory.firstSeen.block})`);
            
            for (const upgrade of upgradeHistory.upgrades) {
                const upgradeDate = moment.unix(upgrade.timestamp).format('YYYY-MM-DD HH:mm:ss');
                console.log(`  Upgrade: ${upgrade.previousClientString} → ${upgrade.clientString} (block ${upgrade.block}, ${upgradeDate})`);
            }
            console.log('');
        }
    }
    
    ProgressReporter.logSuccess('Voting power analysis completed successfully!');
    
    return {
        totalValidators: validators.length,
        identifiedValidators: seenProposers.size,
        clientStats: Object.fromEntries(clientStats),
        versionStats: Object.fromEntries(versionStats),
        totalVotingPower,
        analyzedVotingPower,
        upgradeHistory: upgradeMode ? Object.fromEntries(validatorUpgrades) : null
    };
}

// CLI handling
if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .option('blocks', {
            alias: 'b',
            type: 'number',
            default: 10000,
            description: 'Number of blocks to scan backwards'
        })
        .option('detailed', {
            alias: 'd',
            type: 'boolean',
            default: false,
            description: 'Show detailed version breakdown'
        })
        .option('upgrade', {
            alias: 'u',
            type: 'boolean',
            default: false,
            description: 'Track client upgrades over time'
        })
        .option('verbose', {
            alias: 'v',
            type: 'boolean',
            default: false,
            description: 'List validators with their running version'
        })
        .option('network', {
            alias: 'n',
            type: 'string',
            default: 'mainnet',
            choices: ['mainnet', 'bepolia'],
            description: 'Network to analyze'
        })
        .option('help', {
            alias: 'h',
            type: 'boolean',
            description: 'Show help message'
        })
        .help()
        .argv;
    
    if (argv.help) {
        console.log(`
Voting Power Analysis - Validator Performance Analyzer

This script analyzes validator performance by examining block proposals, client types,
and voting patterns. It decodes extraData from blocks to identify execution clients
and provides comprehensive statistics on validator behavior and block production.

Features:
- Decodes RLP-encoded extraData to identify client types and versions
- Analyzes validator block proposal patterns
- Tracks client distribution across validators
- Provides detailed performance metrics and statistics
- Supports custom block range analysis
- Client upgrade tracking across time

Usage: node analyze-voting-power.js [options]

Options:
  -b, --blocks N         Number of blocks to scan backwards (default: 10000)
  -d, --detailed         Show detailed version breakdown
  -u, --upgrade          Track client upgrades over time
  -v, --verbose          List validators and their running versions
  -n, --network NAME     Network to analyze: mainnet|bepolia (default: mainnet)
  -h, --help             Show this help message

Examples:
  node analyze-voting-power.js                     # Use defaults
  node analyze-voting-power.js --blocks=5000       # Scan 5000 blocks
  node analyze-voting-power.js --detailed          # Show version details
  node analyze-voting-power.js --upgrade           # Track upgrades
  node analyze-voting-power.js --verbose           # List validators with versions
  node analyze-voting-power.js --network=bepolia   # Use testnet
        `);
        process.exit(0);
    }
    
    analyzeVotingPower(argv.network, argv.blocks, argv.detailed, argv.upgrade, argv.verbose)
        .then(results => {
            process.exit(0);
        })
        .catch(error => {
            ProgressReporter.logError(`Script failed: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { analyzeVotingPower };
