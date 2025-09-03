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
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { spawn } = require('child_process');
const Table = require('cli-table3');
const moment = require('moment');

// Simple SQLite wrapper to look up validator names
class ValidatorNameDB {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      // Escape parameters and build SQL
      let finalSql = sql;
      if (params.length > 0) {
        for (let i = 0; i < params.length; i++) {
          const param = params[i].toString().replace(/'/g, "''");
          finalSql = finalSql.replace('?', `'${param}'`);
        }
      }

      const sqlite = spawn('sqlite3', [this.dbPath, finalSql, '-json']);
      let output = '';
      let error = '';

      sqlite.stdout.on('data', (data) => {
        output += data.toString();
      });

      sqlite.stderr.on('data', (data) => {
        error += data.toString();
      });

      sqlite.on('close', (code) => {
        if (code === 0) {
          try {
            const result = output.trim() ? JSON.parse(output.trim()) : [];
            resolve(result);
          } catch (e) {
            resolve([]);
          }
        } else {
          reject(new Error(`SQLite error: ${error}`));
        }
      });
    });
  }

  async getValidatorName(address) {
    try {
      // Try with the address as-is first
      let result = await this.query('SELECT name FROM validators WHERE proposer_address = ?', [address]);
      
      // If no result and address doesn't start with 0x, try adding it
      if ((!result || result.length === 0) && !address.startsWith('0x')) {
        const addressWithPrefix = `0x${address}`;
        result = await this.query('SELECT name FROM validators WHERE proposer_address = ?', [addressWithPrefix]);
      }
      
      // If still no result and address starts with 0x, try removing it
      if ((!result || result.length === 0) && address.startsWith('0x')) {
        const addressWithoutPrefix = address.slice(2);
        result = await this.query('SELECT name FROM validators WHERE proposer_address = ?', [addressWithoutPrefix]);
      }
      
      if (result && result.length > 0 && result[0].name && result[0].name !== 'N/A') {
        return result[0].name;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}

// Function to decode extraData to identify client type (copied from scan-block-filling-crazy.js)
async function decodeExtraDataAsAscii(extraData) {
    if (!extraData || extraData === '0x') {
        return 'Reth?';
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
        const item = decodeRLP(bytes.slice(offset));
        if (item === null) break;
        
        // Find the length of this item
        const firstByte = bytes[offset];
        let itemLength = 1;
        
        if (firstByte >= 0x80 && firstByte < 0xb8) {
            itemLength = 1 + (firstByte - 0x80);
        } else if (firstByte >= 0xb8 && firstByte < 0xc0) {
            const lengthBytes = firstByte - 0xb7;
            itemLength = 1 + lengthBytes + parseInt(bytes.slice(offset + 1, offset + 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        } else if (firstByte >= 0xc0 && firstByte < 0xf8) {
            itemLength = 1 + (firstByte - 0xc0);
        } else if (firstByte >= 0xf8) {
            const lengthBytes = firstByte - 0xf7;
            itemLength = 1 + lengthBytes + parseInt(bytes.slice(offset + 1, offset + 1 + lengthBytes).map(b => b.toString(16).padStart(2, '0')).join(''), 16);
        }
        
        result.push(item);
        offset += itemLength;
    }
    
    return result;
}

// Fetch all validators and their voting power
async function fetchValidators(clRpcUrl) {
    try {
        const validatorsUrl = `${clRpcUrl}/validators?per_page=100`;
        const response = await axios.get(validatorsUrl);
        
        return response.data.result.validators.map(validator => ({
            address: validator.address,
            votingPower: BigInt(validator.voting_power)
        }));
    } catch (error) {
        throw new Error(`Failed to fetch validators: ${error.message}`);
    }
}

// Fetch block proposer address from consensus layer with retry logic
async function getBlockProposer(blockNumber, clRpcUrl, retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const headerUrl = `${clRpcUrl}/header?height=${blockNumber}`;
            const response = await axios.get(headerUrl, {
                timeout: 10000, // 10 second timeout
                headers: {
                    'Connection': 'keep-alive',
                }
            });
            return response.data.result.header.proposer_address;
        } catch (error) {
            if (attempt === retries) {
                throw new Error(`Failed to fetch block proposer for block ${blockNumber} after ${retries} attempts: ${error.message}`);
            }
            
            console.warn(`Attempt ${attempt}/${retries} failed for block ${blockNumber}: ${error.message}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
    }
}

// Classify client type based on decoded extraData
function classifyClient(clientString) {
    const lower = clientString.toLowerCase();
    
    if (lower.includes('bera-geth')) {
        return 'bera-geth';
    } else if (lower.includes('geth')) {
        return 'geth';
    } else if (lower.includes('bera-reth')) {
        return 'bera-reth';
    } else if (lower.includes('reth')) {
        return 'reth';
    } else if (lower.includes('besu')) {
        return 'besu';
    } else if (lower.includes('nethermind')) {
        return 'nethermind';
    } else if (lower.includes('erigon')) {
        return 'erigon';
    } else {
        return 'unknown';
    }
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

async function analyzeVotingPower(elProvider, clRpcUrl, maxBlocksToScan = 10000, detailedMode = false, upgradeMode = false) {
    // Initialize validator name database
    const dbPath = '../cometbft-decoder/validators_correlated.db';
    const validatorDB = new ValidatorNameDB(dbPath);
    
    // Step 1: Get all validators and their voting power
    const validators = await fetchValidators(clRpcUrl);
    
    // Create map for quick lookup
    const validatorMap = new Map();
    validators.forEach(validator => {
        validatorMap.set(validator.address, validator.votingPower);
    });
    
    // Step 2: Get current block number
    const currentBlock = await elProvider.getBlockNumber();
    
    // Step 3: Scan blocks backwards to identify client for each validator
    const proposerClients = new Map(); // proposer_address -> client_type
    const seenProposers = new Set();
    let blocksScanned = 0;
    
    // For upgrade tracking mode
    const validatorUpgrades = new Map(); // proposer_address -> {firstSeen: {...}, upgrades: [...]}
    const validatorsWithUpgrades = new Set(); // Track which validators have at least one upgrade
    const maxBlocksForUpgrade = maxBlocksToScan;
    
    for (let blockNum = currentBlock; blockNum > currentBlock - maxBlocksForUpgrade; blockNum--) {
        // Progress reporting every 10,000 blocks
        if (blocksScanned % 1000 === 0) {
            if (upgradeMode) {
                console.log(`Progress: ${blocksScanned.toLocaleString()} blocks scanned, ${seenProposers.size}/${validators.length} validators seen, ${validatorsWithUpgrades.size} validators with upgrades found`);
            } else {
                console.log(`Progress: ${blocksScanned.toLocaleString()} blocks scanned, ${seenProposers.size}/${validators.length} validators identified`);
            }
        }
        try {
            blocksScanned++;
            // Get proposer address from CL first (cheap)
            const proposerAddress = await getBlockProposer(blockNum, clRpcUrl);
            
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
                    // We've seen this validator before - check if client has changed
                    const validatorInfo = validatorUpgrades.get(proposerAddress);
                    const firstSeen = validatorInfo.firstSeen;
                    
                    // If this is a different client than what we first saw, it's an upgrade
                    if (firstSeen.clientString !== clientString) {
                        validatorInfo.upgrades.push({
                            block: blockNum,
                            timestamp: block.timestamp,
                            clientString,
                            clientType,
                            clientVersion,
                            fromClient: firstSeen.clientString,
                            fromClientType: firstSeen.clientType,
                            fromVersion: firstSeen.clientVersion
                        });
                        
                        // Mark this validator as having an upgrade
                        validatorsWithUpgrades.add(proposerAddress);
                    }
                }
            }
            
            // console.log(`Block ${blockNum}: Proposer ${proposerAddress} -> ${clientString} (${clientType})`);
            
        } catch (error) {
            console.error(`Error processing block ${blockNum}: ${error.message}`);
        }
        
        
        // In upgrade mode, check if we can stop early
        if (upgradeMode && seenProposers.size >= validators.length) {
            // Either we found upgrades for all validators, OR we've seen all validators and need to keep looking for upgrades
            if (validatorsWithUpgrades.size >= seenProposers.size) {
                console.log(`\nEarly exit: Found upgrades for all ${seenProposers.size} validators after ${blocksScanned.toLocaleString()} blocks`);
                break;
            }
            // If we've seen all validators but haven't found upgrades for all, continue but give status
            if (blocksScanned % 50000 === 0) {
                console.log(`\nStatus: Seen all ${seenProposers.size} validators, but only ${validatorsWithUpgrades.size} have upgrades. Continuing search...`);
            }
        }
        
        // In normal mode, stop when we've seen all validators
        if (!upgradeMode && seenProposers.size >= validators.length) {
            break;
        }
    }
    
    console.log(`\nScanning complete. Scanned ${blocksScanned} blocks, identified ${seenProposers.size}/${validators.length} validators\n`);
    
    // Step 5: Calculate voting power by client type
    const clientVotingPower = new Map();
    const unknownValidators = [];
    
    for (const validator of validators) {
        const clientInfo = proposerClients.get(validator.address);
        
        if (clientInfo) {
            const clientType = clientInfo.clientType;
            if (!clientVotingPower.has(clientType)) {
                clientVotingPower.set(clientType, BigInt(0));
            }
            clientVotingPower.set(clientType, clientVotingPower.get(clientType) + validator.votingPower);
        } else {
            unknownValidators.push(validator.address);
        }
    }
    
    // Calculate total voting power
    const totalVotingPower = validators.reduce((sum, validator) => sum + validator.votingPower, BigInt(0));
    
    // Display results
    console.log('=== VOTING POWER BY CLIENT TYPE ===\n');
    
    // Create table using cli-table3
    const clientTypeTable = new Table({
        head: ['Client Type', 'Voting Power (BERA)', 'Percentage', 'Count'],
        colWidths: [20, 25, 15, 10],
        colAligns: ['left', 'right', 'right', 'right']
    });
    
    for (const [clientType, votingPower] of clientVotingPower.entries()) {
        const percentage = (Number(votingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
        const votingPowerBERA = Number(votingPower / BigInt(10**9));
        const formattedVotingPower = votingPowerBERA.toLocaleString();
        const validatorCount = Array.from(proposerClients.entries()).filter(([_, info]) => info.clientType === clientType).length;
        clientTypeTable.push([
            clientType.toUpperCase(),
            formattedVotingPower,
            percentage + '%',
            validatorCount.toString()
        ]);
    }
    
    if (unknownValidators.length > 0) {
        const unknownVotingPower = unknownValidators.reduce((sum, address) => sum + validatorMap.get(address), BigInt(0));
        const percentage = (Number(unknownVotingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
        const unknownVotingPowerBERA = Number(unknownVotingPower / BigInt(10**9));
        const formattedUnknownVotingPower = unknownVotingPowerBERA.toLocaleString();
        clientTypeTable.push([
            'UNKNOWN',
            formattedUnknownVotingPower,
            percentage + '%',
            unknownValidators.length.toString()
        ]);
    }
    
    console.log(clientTypeTable.toString());
    
    // Always show client version summary table
    console.log('\n=== VOTING POWER BY CLIENT VERSION ===\n');
    
    // Group by client type and version
    const clientVersionVotingPower = new Map();
    for (const [proposerAddress, clientInfo] of proposerClients.entries()) {
        const votingPower = validatorMap.get(proposerAddress);
        const key = `${clientInfo.clientType}:${clientInfo.clientVersion}`;
        
        if (!clientVersionVotingPower.has(key)) {
            clientVersionVotingPower.set(key, {
                clientType: clientInfo.clientType,
                version: clientInfo.clientVersion,
                votingPower: BigInt(0),
                validatorCount: 0,
                validators: []
            });
        }
        
        const entry = clientVersionVotingPower.get(key);
        entry.votingPower += votingPower;
        entry.validatorCount++;
        entry.validators.push({
            address: proposerAddress,
            votingPower,
            clientString: clientInfo.clientString,
            sampleBlock: clientInfo.sampleBlock
        });
    }
    
    // Sort by voting power (descending)
    const sortedVersions = Array.from(clientVersionVotingPower.values())
        .sort((a, b) => b.votingPower > a.votingPower ? 1 : -1);
    
    // Create table using cli-table3
    const clientVersionTable = new Table({
        head: ['Client & Version', 'Voting Power (BERA)', 'Percentage', 'Count'],
        colWidths: [35, 25, 15, 10],
        colAligns: ['left', 'right', 'right', 'right']
    });
    
    for (const entry of sortedVersions) {
        const percentage = (Number(entry.votingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
        const votingPowerBERA = Number(entry.votingPower / BigInt(10**9));
        const formattedVotingPower = votingPowerBERA.toLocaleString();
        clientVersionTable.push([
            `${entry.clientType.toUpperCase()} ${entry.version}`,
            formattedVotingPower,
            percentage + '%',
            entry.validatorCount.toString()
        ]);
    }
    
    console.log(clientVersionTable.toString());
    
    if (detailedMode) {
        console.log('\n=== DETAILED VALIDATOR BREAKDOWN ===\n');
        
        // Show detailed validator lists for each version
        for (const entry of sortedVersions) {
            console.log(`${entry.clientType.toUpperCase()} ${entry.version} (${entry.validatorCount} validators):`);
            
            // Create table for this version
            const validatorTable = new Table({
                head: ['Validator', 'Voting Power (BERA)', 'Percentage', 'Block Found', 'Client Info'],
                colWidths: [40, 20, 12, 15, 25],
                colAligns: ['left', 'right', 'right', 'right', 'left']
            });
            
            for (const validator of entry.validators) {
                const validatorPercentage = (Number(validator.votingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
                const validatorName = await validatorDB.getValidatorName(validator.address);
                const displayName = validatorName ? `${validatorName} (${validator.address})` : validator.address;
                const validatorVotingPowerBERA = Number(validator.votingPower / BigInt(10**9));
                const formattedValidatorVotingPower = validatorVotingPowerBERA.toLocaleString();
                const clientInfo = validator.clientString;
                const blockFound = validator.sampleBlock.toLocaleString();
                
                validatorTable.push([
                    displayName,
                    formattedValidatorVotingPower,
                    validatorPercentage + '%',
                    blockFound,
                    clientInfo
                ]);
            }
            
            console.log(validatorTable.toString());
            console.log();
        }
    }
    
    // Show upgrade tracking results
    if (upgradeMode) {
        console.log('\n=== CLIENT UPGRADE HISTORY ===\n');
        
        // Create upgrade summary table
        const upgradeData = [];
        const now = moment();
        
        for (const [proposerAddress, validatorInfo] of validatorUpgrades.entries()) {
            if (validatorInfo.upgrades.length > 0) {
                const validatorName = await validatorDB.getValidatorName(proposerAddress);
                const displayName = validatorName ? `${validatorName} (${proposerAddress})` : proposerAddress;
                
                // Process each upgrade for this validator
                for (const upgrade of validatorInfo.upgrades) {
                    const upgradeTime = moment.unix(upgrade.timestamp);
                    const relativeTime = upgradeTime.fromNow();
                    
                    upgradeData.push({
                        validator: displayName,
                        fromClient: upgrade.fromClient,
                        toClient: upgrade.clientString,
                        block: upgrade.block,
                        relativeTime: relativeTime,
                        timestamp: upgradeTime.format('YYYY-MM-DD HH:mm:ss')
                    });
                }
            }
        }
        
        if (upgradeData.length > 0) {
            // Sort by most recent first
            upgradeData.sort((a, b) => b.block - a.block);
            
            const upgradeTable = new Table({
                head: ['Validator', 'First Seen', 'Upgraded To', 'When', 'Block'],
                colWidths: [40, 30, 30, 20, 15],
                colAligns: ['left', 'left', 'left', 'left', 'right']
            });
            
            for (const upgrade of upgradeData) {
                upgradeTable.push([
                    upgrade.validator,
                    upgrade.fromClient,
                    upgrade.toClient,
                    upgrade.relativeTime,
                    upgrade.block.toString()
                ]);
            }
            
            console.log(upgradeTable.toString());
            console.log(`\nFound ${upgradeData.length} client upgrades across ${validatorsWithUpgrades.size} validators`);
            console.log(`Scanned ${blocksScanned.toLocaleString()} blocks`);
            
            // Show validators that haven't upgraded (still using first-seen client)
            const nonUpgradedValidators = [];
            for (const [proposerAddress, validatorInfo] of validatorUpgrades.entries()) {
                if (validatorInfo.upgrades.length === 0) {
                    const validatorName = await validatorDB.getValidatorName(proposerAddress);
                    const displayName = validatorName ? `${validatorName} (${proposerAddress})` : proposerAddress;
                    nonUpgradedValidators.push({
                        validator: displayName,
                        firstSeenClient: validatorInfo.firstSeen.clientString,
                        firstSeenBlock: validatorInfo.firstSeen.block
                    });
                }
            }
            
            if (nonUpgradedValidators.length > 0) {
                console.log(`\n=== VALIDATORS WITHOUT UPGRADES (${nonUpgradedValidators.length}) ===`);
                console.log('These validators are still using their first-seen client:');
                
                const nonUpgradeTable = new Table({
                    head: ['Validator', 'First Seen Client', 'First Seen Block'],
                    colWidths: [50, 40, 20],
                    colAligns: ['left', 'left', 'right']
                });
                
                for (const validator of nonUpgradedValidators) {
                    nonUpgradeTable.push([
                        validator.validator,
                        validator.firstSeenClient,
                        validator.firstSeenBlock.toString()
                    ]);
                }
                
                console.log(nonUpgradeTable.toString());
            }
        } else {
            console.log('No client upgrades found in the scanned period.');
            if (validatorsWithUpgrades.size < seenProposers.size) {
                console.log(`Scanned ${blocksScanned.toLocaleString()} blocks but could not find upgrades for all ${seenProposers.size} validators`);
                console.log(`Found upgrades for ${validatorsWithUpgrades.size} validators`);
            } else {
                console.log(`Scanned ${blocksScanned.toLocaleString()} blocks across ${validatorUpgrades.size} validators`);
            }
        }
    }
}

async function main() {
    const elRpcUrl = process.env.EL_ETHRPC_URL || 'http://10.147.18.191:40003';
    const clRpcUrl = process.env.CL_ETHRPC_URL || 'http://10.147.18.191:40000';
    
    console.log(`EL RPC: ${elRpcUrl}`);
    console.log(`CL RPC: ${clRpcUrl}`);
    
    const argv = yargs(hideBin(process.argv))
        .option('max-blocks', {
            alias: 'm',
            type: 'number',
            default: 10000,
            description: 'Maximum number of blocks to scan backwards'
        })
        .option('detailed', {
            alias: 'd',
            type: 'boolean',
            default: false,
            description: 'Enable detailed mode showing voting power breakdown by client version'
        })
        .option('upgrade', {
            alias: 'u',
            type: 'boolean',
            default: false,
            description: 'Track client upgrades by scanning backwards from tip and detecting when validators change from their first-seen client'
        })
        .help()
        .argv;
    
    const elProvider = new ethers.JsonRpcProvider(elRpcUrl);
    
    try {
        await analyzeVotingPower(elProvider, clRpcUrl, argv.maxBlocks, argv.detailed, argv.upgrade);
    } catch (error) {
        console.error('Error during analysis:', error.message);
        process.exit(1);
    }
}

main(); 
