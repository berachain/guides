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

async function analyzeVotingPower(elProvider, clRpcUrl, maxBlocksToScan = 10000, detailedMode = false) {
    console.log('Fetching validators and their voting power...');
    
    // Step 1: Get all validators and their voting power
    const validators = await fetchValidators(clRpcUrl);
    console.log(`Found ${validators.length} validators`);
    
    // Create map for quick lookup
    const validatorMap = new Map();
    validators.forEach(validator => {
        validatorMap.set(validator.address, validator.votingPower);
    });
    
    // Step 2: Get current block number
    const currentBlock = await elProvider.getBlockNumber();
    console.log(`Current block: ${currentBlock}`);
    
    // Step 3: Scan blocks backwards to identify client for each validator
    const proposerClients = new Map(); // proposer_address -> client_type
    const seenProposers = new Set();
    let blocksScanned = 0;
    
    console.log('Scanning blocks backwards to identify client types...');
    
    for (let blockNum = currentBlock; blockNum > currentBlock - maxBlocksToScan && seenProposers.size < validators.length; blockNum--) {
        try {
            // Get proposer address from CL first (cheap)
            const proposerAddress = await getBlockProposer(blockNum, clRpcUrl);
            
            // Skip if we already know this proposer's client
            if (seenProposers.has(proposerAddress)) {
                continue;
            }
            
            // Only now fetch block from EL to extract extraData
            const block = await elProvider.getBlock(blockNum);
            if (!block) continue;
            
            // Decode client from extraData
            const clientString = await decodeExtraDataAsAscii(block.extraData);
            const clientType = classifyClient(clientString);
            const clientVersion = extractClientVersion(clientString);
            
            proposerClients.set(proposerAddress, {
                clientType,
                clientString,
                clientVersion,
                sampleBlock: blockNum,
                extraData: block.extraData
            });
            
            seenProposers.add(proposerAddress);
            
            // console.log(`Block ${blockNum}: Proposer ${proposerAddress} -> ${clientString} (${clientType})`);
            
        } catch (error) {
            console.error(`Error processing block ${blockNum}: ${error.message}`);
        }
        
        blocksScanned++;
        
        // if (blocksScanned % 100 === 0) {
        //     console.log(`Scanned ${blocksScanned} blocks, identified ${seenProposers.size}/${validators.length} validators`);
        // }
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
    
    for (const [clientType, votingPower] of clientVotingPower.entries()) {
        const percentage = (Number(votingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
        console.log(`${clientType.toUpperCase()}: ${percentage}% (${votingPower.toString()} / ${totalVotingPower.toString()})`);
    }
    
    if (unknownValidators.length > 0) {
        const unknownVotingPower = unknownValidators.reduce((sum, address) => sum + validatorMap.get(address), BigInt(0));
        const percentage = (Number(unknownVotingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
        console.log(`UNKNOWN: ${percentage}% (${unknownValidators.length} validators not seen in recent blocks)`);
    }
    
    if (detailedMode) {
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
        
        for (const entry of sortedVersions) {
            const percentage = (Number(entry.votingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
            console.log(`${entry.clientType.toUpperCase()} ${entry.version}: ${percentage}% (${entry.votingPower.toString()} / ${totalVotingPower.toString()}) - ${entry.validatorCount} validators`);
            
            if (detailedMode) {
                entry.validators.forEach(validator => {
                    const validatorPercentage = (Number(validator.votingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
                    console.log(`  ${validator.address}: ${validatorPercentage}% (${validator.votingPower.toString()}) - ${validator.clientString} (block ${validator.sampleBlock})`);
                });
                console.log();
            }
        }
    }
    
    console.log('\n=== VALIDATOR SUMMARY ===\n');
    
    // Group by client type and show details
    const clientDetails = new Map();
    for (const [proposerAddress, clientInfo] of proposerClients.entries()) {
        const clientType = clientInfo.clientType;
        if (!clientDetails.has(clientType)) {
            clientDetails.set(clientType, []);
        }
        
        const votingPower = validatorMap.get(proposerAddress);
        clientDetails.get(clientType).push({
            address: proposerAddress,
            votingPower,
            clientString: clientInfo.clientString,
            clientVersion: clientInfo.clientVersion,
            sampleBlock: clientInfo.sampleBlock
        });
    }
    
    for (const [clientType, validators] of clientDetails.entries()) {
        console.log(`${clientType.toUpperCase()} (${validators.length} validators):`);
        validators.forEach(validator => {
            const validatorPercentage = (Number(validator.votingPower * BigInt(10000) / totalVotingPower) / 100).toFixed(2);
            console.log(`  ${validator.address}: ${validatorPercentage}% (${validator.votingPower.toString()}) - ${validator.clientString} (block ${validator.sampleBlock})`);
        });
        console.log();
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
        .help()
        .argv;
    
    const elProvider = new ethers.JsonRpcProvider(elRpcUrl);
    
    try {
        await analyzeVotingPower(elProvider, clRpcUrl, argv.maxBlocks, argv.detailed);
    } catch (error) {
        console.error('Error during analysis:', error.message);
        process.exit(1);
    }
}

main(); 