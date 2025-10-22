#!/usr/bin/env node

/**
 * BeraChef Activation Scanner - Cutting Board Activity Analyzer
 * 
 * This script scans for ActivateRewardAllocation events from the BeraChef contract
 * to analyze validator cutting board activations. It provides insights into:
 * - How frequently validators change their reward allocations
 * - Time patterns between cutting board changes
 * - Validators with zero activations (using default allocations)
 * - Current allocation status vs default allocations
 * 
 * Features:
 * - Scans ActivateRewardAllocation events using eth_getLogs
 * - Maps validator pubkeys to names using the validator database
 * - Calculates time statistics (gaps between changes, time since last change)
 * - Compares current allocations against default allocations
 * - Generates histograms of activation counts
 * - Supports custom block ranges and RPC endpoints
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const crypto = require('crypto');

const { ValidatorNameDB, ConfigHelper, ProgressReporter } = require('./lib/shared-utils');

// Configuration
const CONFIG = {
  // BeraChef contract addresses
  contracts: {
    mainnet: '0xdf960E8F3F19C481dDE769edEDD439ea1a63426a',
    bepolia: '0xdf960E8F3F19C481dDE769edEDD439ea1a63426a'
  },
  
  // Event signature for ActivateRewardAllocation
  // ActivateRewardAllocation(bytes indexed valPubkey, uint64 startBlock, tuple[] weights)
  eventSignature: '0x09fed3850dff4fef07a5284847da937f94021882ecab1c143fcacd69e5451bd8',
  
  // RPC request settings
  timeout: 30000,
  maxRetries: 3
};

// Initialize validator database
const validatorDB = new ValidatorNameDB();
// Ethers interface for BeraChef view functions
const BERACHEF_IFACE = new ethers.Interface([
  'function getActiveRewardAllocation(bytes valPubkey) view returns (tuple(uint64 startBlock, tuple(address receiver, uint96 percentageNumerator)[] weights))',
  'function getDefaultRewardAllocation() view returns (tuple(uint64 startBlock, tuple(address receiver, uint96 percentageNumerator)[] weights))'
]);

// Helper: eth_call using ethers-style encoded data, return raw result hex
async function ethCall(rpcUrl, to, data) {
  return await rpcRequest(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
}

// Helper: decode RewardAllocation result
function decodeRewardAllocation(resultHex) {
  try {
    const decoded = BERACHEF_IFACE.decodeFunctionResult('getDefaultRewardAllocation', resultHex);
    // decoded[0] is the struct
    const alloc = decoded[0];
    return {
      startBlock: Number(alloc.startBlock.toString()),
      weights: alloc.weights.map(w => ({ receiver: (w.receiver || w[0]).toLowerCase(), percentageNumerator: BigInt(w.percentageNumerator || w[1]) }))
    };
  } catch {
    // Try active variant signature (same tuple layout)
    const decoded = BERACHEF_IFACE.decodeFunctionResult('getActiveRewardAllocation', resultHex);
    const alloc = decoded[0];
    return {
      startBlock: Number(alloc.startBlock.toString()),
      weights: alloc.weights.map(w => ({ receiver: (w.receiver || w[0]).toLowerCase(), percentageNumerator: BigInt(w.percentageNumerator || w[1]) }))
    };
  }
}

// Helper: compare two allocations ignoring order of weights
function allocationsEqualIgnoringOrder(a, b) {
  if (!a || !b) return false;
  if ((a.weights?.length || 0) !== (b.weights?.length || 0)) return false;
  const key = w => `${w.receiver.toLowerCase()}::${w.percentageNumerator.toString()}`;
  const count = map => {
    const m = new Map();
    for (const w of map) {
      const k = key(w);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const ma = count(a.weights);
  const mb = count(b.weights);
  if (ma.size !== mb.size) return false;
  for (const [k, v] of ma) {
    if (mb.get(k) !== v) return false;
  }
  return true;
}


// Helper function to get validator name
async function getValidatorName(pubkey) {
  try {
    const name = await validatorDB.getValidatorName(pubkey);
    if (name && name !== 'Unknown') {
      return name;
    }
    // Return shortened pubkey for unknown validators
    return pubkey.slice(0, 10) + '...' + pubkey.slice(-8);
  } catch (error) {
    // Return shortened pubkey for unknown validators
    return pubkey.slice(0, 10) + '...' + pubkey.slice(-8);
  }
}


// RPC request helper
async function rpcRequest(url, method, params = []) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: method,
      params: params
    });
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: CONFIG.timeout
    };
    
    axios.post(url, postData, options)
      .then(response => {
        if (response.data.error) {
          reject(new Error(`RPC Error: ${response.data.error.message}`));
        } else {
          resolve(response.data.result);
        }
      })
      .catch(reject);
  });
}

// Get latest block number
async function getLatestBlock(rpcUrl) {
  try {
    const blockNumber = await rpcRequest(rpcUrl, 'eth_blockNumber');
    return parseInt(blockNumber, 16);
  } catch (error) {
    throw new Error(`Failed to get latest block: ${error.message}`);
  }
}

// Get block with timestamp
async function getBlock(rpcUrl, blockNumber) {
  try {
    const block = await rpcRequest(rpcUrl, 'eth_getBlockByNumber', [
      '0x' + blockNumber.toString(16),
      false // don't include transactions
    ]);
    return block;
  } catch (error) {
    throw new Error(`Failed to get block ${blockNumber}: ${error.message}`);
  }
}

// Get logs using eth_getLogs
async function getLogs(rpcUrl, fromBlock, toBlock, address, topics) {
  try {
    const logs = await rpcRequest(rpcUrl, 'eth_getLogs', [{
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      address: address,
      topics: topics
    }]);
    return logs;
  } catch (error) {
    throw new Error(`Failed to get logs: ${error.message}`);
  }
}

// Decode ActivateRewardAllocation event
function decodeActivateRewardAllocationEvent(log, blockTimestamp) {
  try {
    // The validator pubkey is in topics[1] (indexed parameter)
    const valPubkey = log.topics[1];
    
    // Extract startBlock from data (first 32 bytes of data)
    const startBlock = parseInt(log.data.slice(2, 66), 16);
    
    return {
      valPubkey,
      startBlock,
      blockNumber: parseInt(log.blockNumber, 16),
      blockTimestamp: parseInt(blockTimestamp, 16),
      transactionHash: log.transactionHash
    };
  } catch (error) {
    return null;
  }
}

// Get default reward allocation (decoded)
async function getDefaultRewardAllocation(rpcUrl, contractAddress) {
  try {
    const data = BERACHEF_IFACE.encodeFunctionData('getDefaultRewardAllocation', []);
    const result = await ethCall(rpcUrl, contractAddress, data);
    return decodeRewardAllocation(result);
  } catch (error) {
    console.warn(`⚠️  Could not get default reward allocation: ${error.message}`);
    return null;
  }
}

// Fetch active allocation and compare to default
async function isUsingDefaultAllocation(rpcUrl, contractAddress, validatorPubkey, defaultAllocationDecoded) {
  try {
    // Proper ABI encoding via ethers Interface
    const data = BERACHEF_IFACE.encodeFunctionData('getActiveRewardAllocation', [validatorPubkey]);
    const result = await ethCall(rpcUrl, contractAddress, data);
    const activeDecoded = decodeRewardAllocation(result);
    return allocationsEqualIgnoringOrder(activeDecoded, defaultAllocationDecoded);
  } catch (error) {
    console.warn(`⚠️  Could not check allocation for validator: ${error.message}`);
    return null;
  }
}

// Scan for ActivateRewardAllocation events
async function scanActivations(config) {
  ProgressReporter.logStep('Scanning blocks', `${config.blocks} blocks for ActivateRewardAllocation events`);
  
  const contractAddress = CONFIG.contracts[config.chain];
  const latestBlock = await getLatestBlock(config.rpc);
  const startBlock = Math.max(0, latestBlock - config.blocks + 1);
  
  console.log(`📊 Block range: ${startBlock} to ${latestBlock} (${config.blocks} blocks)`);
  
  const activations = [];
  const validatorCounts = new Map();
  const validatorTimestamps = new Map();
  
  try {
    // Break large ranges into chunks of 10,000 blocks (RPC limit)
    const chunkSize = 10000;
    let allLogs = [];
    let processedBlocks = 0;
    
    for (let chunkStart = startBlock; chunkStart <= latestBlock; chunkStart += chunkSize) {
      const chunkEnd = Math.min(chunkStart + chunkSize - 1, latestBlock);
      
      if (config.verbose) {
        console.log(`📦 Processing chunk: blocks ${chunkStart}-${chunkEnd}...`);
      }
      
      try {
        // Get logs filtered by the ActivateRewardAllocation event signature
        const logs = await getLogs(config.rpc, chunkStart, chunkEnd, contractAddress, [CONFIG.eventSignature]);
        allLogs = allLogs.concat(logs);
        
        processedBlocks += (chunkEnd - chunkStart + 1);
        const progress = ((processedBlocks / config.blocks) * 100).toFixed(1);
        
        if (config.verbose || processedBlocks % 20000 === 0) {
          ProgressReporter.showProgress(processedBlocks, config.blocks, chunkEnd);
        }
        
      } catch (error) {
        console.warn(`⚠️  Failed to get logs for chunk ${chunkStart}-${chunkEnd}: ${error.message}`);
        // Continue with next chunk
      }
    }
    
    ProgressReporter.clearProgress();
    console.log(`📋 Found ${allLogs.length} ActivateRewardAllocation events`);
    
    // Process each log
    for (const log of allLogs) {
      try {
        // Get block timestamp for this log
        const block = await getBlock(config.rpc, parseInt(log.blockNumber, 16));
        const eventData = decodeActivateRewardAllocationEvent(log, block.timestamp);
        
        if (eventData) {
          activations.push(eventData);
          
          // Count activations per validator
          const count = validatorCounts.get(eventData.valPubkey) || 0;
          validatorCounts.set(eventData.valPubkey, count + 1);
          
          // Track timestamps for each validator
          if (!validatorTimestamps.has(eventData.valPubkey)) {
            validatorTimestamps.set(eventData.valPubkey, []);
          }
          validatorTimestamps.get(eventData.valPubkey).push(eventData.blockTimestamp);
        }
      } catch (error) {
        if (config.verbose) {
          console.warn(`⚠️  Failed to process log: ${error.message}`);
        }
      }
    }
    
    
  } catch (error) {
    console.error(`❌ Error getting logs: ${error.message}`);
    throw error;
  }
  
  return { activations, validatorCounts, validatorTimestamps };
}

// Analyze current validator allocations
async function analyzeCurrentAllocations(config, validatorCounts) {
  
  // Get all active validators from the database
  const allValidators = await validatorDB.getAllValidators();
  console.log(`👥 Found ${allValidators.length} total active validators in database`);
  
  // Count validators with 0 activations
  let validatorsWithZeroActivations = 0;
  for (const validator of allValidators) {
    if (validator.address && !validatorCounts.has(validator.address)) {
      validatorsWithZeroActivations++;
    }
  }
  
  // Get default allocation from BeraChef contract
  const contractAddress = CONFIG.contracts[config.chain];
  const defaultAllocation = await getDefaultRewardAllocation(config.rpc, contractAddress);
  
  // Check which validators are using the default allocation
  let validatorsUsingDefault = 0;
  const validatorAllocationStatus = new Map();
  
  if (defaultAllocation) {
    console.log(`🔍 Checking allocation status for ${allValidators.length} validators...`);
    
    for (const validator of allValidators) {
      if (validator.pubkey) {
        try {
          const isUsingDefault = await isUsingDefaultAllocation(
            config.rpc, 
            contractAddress, 
            validator.pubkey, 
            defaultAllocation
          );
          
          // Map by address (used in events) for easy lookup in display
          validatorAllocationStatus.set(validator.address, isUsingDefault);
          
          if (isUsingDefault === true) {
            validatorsUsingDefault++;
          }
        } catch (error) {
          // Skip this validator if we can't check their allocation
          validatorAllocationStatus.set(validator.address, null);
        }
      }
    }
  }
  
  return {
    defaultAllocation,
    validatorsUsingDefault,
    totalValidators: allValidators.length,
    validatorsWithZeroActivations,
    allValidators: allValidators,
    validatorAllocationStatus
  };
}

// Generate histogram
function generateHistogram(validatorCounts, totalValidators) {
  const counts = Array.from(validatorCounts.values());
  const histogram = new Map();
  
  for (const count of counts) {
    const bucket = histogram.get(count) || 0;
    histogram.set(count, bucket + 1);
  }
  
  // Add validators with 0 activations
  const validatorsWithActivations = validatorCounts.size;
  const validatorsWithZeroActivations = totalValidators - validatorsWithActivations;
  if (validatorsWithZeroActivations > 0) {
    histogram.set(0, validatorsWithZeroActivations);
  }
  
  return histogram;
}

// Calculate time statistics for validators
function calculateTimeStats(validatorTimestamps, latestBlockTimestamp) {
  const stats = new Map();
  
  for (const [valPubkey, timestamps] of validatorTimestamps) {
    const sortedTimestamps = timestamps.sort((a, b) => a - b);
    const activationCount = sortedTimestamps.length;
    
    let maxGapSeconds = 0;
    let minGapSeconds = Infinity;
    let totalGapSeconds = 0;
    let gapCount = 0;
    let timeSinceLastChange = 0;
    
    if (activationCount > 1) {
      // Calculate gaps between activations
      for (let i = 1; i < sortedTimestamps.length; i++) {
        const gap = sortedTimestamps[i] - sortedTimestamps[i - 1];
        maxGapSeconds = Math.max(maxGapSeconds, gap);
        minGapSeconds = Math.min(minGapSeconds, gap);
        totalGapSeconds += gap;
        gapCount++;
      }
    }
    
    // Calculate time since last change
    if (activationCount > 0) {
      timeSinceLastChange = latestBlockTimestamp - sortedTimestamps[sortedTimestamps.length - 1];
    }
    
    const avgGapSeconds = gapCount > 0 ? totalGapSeconds / gapCount : 0;
    
    stats.set(valPubkey, {
      activationCount,
      maxGapSeconds,
      minGapSeconds: minGapSeconds === Infinity ? 0 : minGapSeconds,
      avgGapSeconds,
      timeSinceLastChange
    });
  }
  
  return stats;
}

// Format duration in human-readable format
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

// Display results
async function displayResults(activations, validatorCounts, validatorTimestamps, currentAllocations, config) {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 BeraChef Activation Scanner Results');
  console.log('='.repeat(60));
  
  console.log(`\n📊 Summary:`);
  console.log(`   Total activations found: ${activations.length}`);
  console.log(`   Validators with activations: ${validatorCounts.size}`);
  console.log(`   Blocks scanned: ${config.blocks}`);
  
  // Display current allocation analysis
  if (currentAllocations) {
    console.log(`\n🎯 Current Validator Allocations:`);
    console.log(`   Validators with 0 activations: ${currentAllocations.validatorsWithZeroActivations || 0}`);
    console.log(`   Validators using default cutting board: ${currentAllocations.validatorsUsingDefault || 0}`);
    console.log(`   Total active validators: ${currentAllocations.totalValidators}`);
  }
  
  if (activations.length === 0) {
    console.log('\n❌ No ActivateRewardAllocation events found in the specified block range.');
    console.log('   This could mean:');
    console.log('   - No validators activated cutting boards in this period');
    console.log('   - Wrong contract address or event signature');
    console.log('   - Network issues during scanning');
    return;
  }
  
  // Calculate time statistics
  const latestBlockTimestamp = activations.length > 0 ? 
    Math.max(...activations.map(a => a.blockTimestamp)) : 0;
  const timeStats = calculateTimeStats(validatorTimestamps, latestBlockTimestamp);
  
  // Generate and display histogram
  const histogram = generateHistogram(validatorCounts, currentAllocations.totalValidators);
  const sortedHistogram = Array.from(histogram.entries()).sort((a, b) => a[0] - b[0]);
  
  console.log('\n📈 Histogram - Validators by Activation Count:');
  console.log('   Activations | Validators');
  console.log('   ------------|-----------');
  
  for (const [activationCount, validatorCount] of sortedHistogram) {
    const bar = '█'.repeat(Math.min(validatorCount, 50));
    console.log(`   ${activationCount.toString().padStart(11)} | ${validatorCount.toString().padStart(9)} ${bar}`);
  }
  
  
  // Show detailed validator table
  console.log('\n📋 Detailed Validator Analysis:');
  console.log('   Validator Name | Stake (BERA) | Activations | Min Gap | Avg Gap | Max Gap | Since Last | Default');
  console.log('   ' + '-'.repeat(25) + ' | ' + '-'.repeat(12) + ' | ' + '-'.repeat(11) + ' | ' + '-'.repeat(7) + ' | ' + '-'.repeat(7) + ' | ' + '-'.repeat(7) + ' | ' + '-'.repeat(9) + ' | ' + '-'.repeat(7));
  
  // Get all validators from currentAllocations (already fetched in analyzeCurrentAllocations)
  const allValidators = currentAllocations.allValidators;
  const validatorMap = new Map();
  allValidators.forEach(v => {
    if (v.address) {
      validatorMap.set(v.address, v);
    }
  });
  
  // Create a combined list of all validators with their activation counts
  const allValidatorData = [];
  
  // Add validators with activations (now they should have stake data since we're using address field)
  for (const [address, activationCount] of validatorCounts.entries()) {
    const validator = validatorMap.get(address);
    allValidatorData.push({ 
      pubkey: address, 
      activationCount, 
      hasStakeData: !!validator, 
      validator 
    });
  }
  
  // Add validators with 0 activations
  for (const validator of allValidators) {
    if (validator.address && !validatorCounts.has(validator.address)) {
      allValidatorData.push({ 
        pubkey: validator.address, 
        activationCount: 0, 
        hasStakeData: true, 
        validator 
      });
    }
  }
  
  // Sort by activation count (descending), then by name
  allValidatorData.sort((a, b) => {
    if (b.activationCount !== a.activationCount) {
      return b.activationCount - a.activationCount;
    }
    // If same activation count, sort by name
    const nameA = a.validator?.name || a.pubkey;
    const nameB = b.validator?.name || b.pubkey;
    return nameA.localeCompare(nameB);
  });
  
  for (const { pubkey, activationCount, hasStakeData, validator } of allValidatorData) {
    const stats = timeStats.get(pubkey);
    const name = await getValidatorName(pubkey);
    
    // Get stake - only validators with 0 activations have stake data
    const stake = hasStakeData && validator && validator.voting_power ? 
      (parseFloat(validator.voting_power) / 1e9) : null; // Convert to BERA
    const stakeStr = stake ? stake.toFixed(1) : 'N/A';
    
    // Format time gaps
    const minGap = stats && stats.activationCount > 1 ? formatDuration(stats.minGapSeconds) : 'N/A';
    const avgGap = stats && stats.activationCount > 1 ? formatDuration(stats.avgGapSeconds) : 'N/A';
    const maxGap = stats && stats.activationCount > 1 ? formatDuration(stats.maxGapSeconds) : 'N/A';
    const sinceLast = stats ? formatDuration(stats.timeSinceLastChange) : 'N/A';
    
    // Get default allocation status - now mapped by address
    const isUsingDefault = currentAllocations.validatorAllocationStatus?.get(pubkey);
    const defaultStr = isUsingDefault === true ? 'Yes' : isUsingDefault === false ? 'No' : 'N/A';
    
    // Truncate name if too long
    const shortName = name.length > 25 ? name.slice(0, 22) + '...' : name;
    
    console.log(`   ${shortName.padEnd(25)} | ${stakeStr.padStart(12)} | ${activationCount.toString().padStart(11)} | ${minGap.padStart(7)} | ${avgGap.padStart(7)} | ${maxGap.padStart(7)} | ${sinceLast.padStart(9)} | ${defaultStr.padStart(7)}`);
  }
  
}

// Parse command line arguments
function parseArgs() {
  const argv = yargs(hideBin(process.argv))
    .option('blocks', {
      alias: 'b',
      type: 'number',
      default: ConfigHelper.getDefaultBlockCount(),
      description: 'Number of blocks to scan back'
    })
    .option('rpc', {
      alias: 'r',
      type: 'string',
      description: 'RPC endpoint URL'
    })
    .option('chain', {
      alias: 'c',
      type: 'string',
      choices: ['mainnet', 'bepolia'],
      default: 'mainnet',
      description: 'Chain name'
    })
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      default: false,
      description: 'Verbose output'
    })
    .option('help', {
      alias: 'h',
      type: 'boolean',
      description: 'Show help'
    })
    .help()
    .argv;
  
  // Determine RPC URL
  let rpcUrl;
  if (argv.rpc) {
    rpcUrl = argv.rpc;
  } else {
    // Use the EL RPC for contract calls
    rpcUrl = ConfigHelper.getRpcUrl('el', argv.chain);
  }
  
  return {
    blocks: argv.blocks,
    rpc: rpcUrl,
    chain: argv.chain,
    verbose: argv.verbose,
    help: argv.help
  };
}

// Main function
async function main() {
  const config = parseArgs();
  
  if (config.help) {
    console.log(`
BeraChef Activation Scanner

Scans blocks for ActivateRewardAllocation events from BeraChef contract
and generates a histogram of validator cutting board activations.

Usage:
  node scan-berachef-activations.js [options]

Options:
  -b, --blocks <number>    Number of blocks to scan back (default: 1000)
  -r, --rpc <url>         RPC endpoint URL
  -c, --chain <name>      Chain name: mainnet, bepolia (default: mainnet)
  -v, --verbose           Verbose output
  -h, --help              Show this help

Examples:
  node scan-berachef-activations.js --blocks 1000 --chain mainnet
  node scan-berachef-activations.js --blocks 500 --rpc https://bepolia.rpc.berachain.com
  node scan-berachef-activations.js --blocks 2000 --verbose
`);
    process.exit(0);
  }
  
  try {
    console.log('🚀 Starting BeraChef Activation Scanner...\n');
    
    const { activations, validatorCounts, validatorTimestamps } = await scanActivations(config);
    const currentAllocations = await analyzeCurrentAllocations(config, validatorCounts);
    await displayResults(activations, validatorCounts, validatorTimestamps, currentAllocations, config);
    
    ProgressReporter.logSuccess('Scan completed successfully!');
    
  } catch (error) {
    ProgressReporter.logError(`Scanner failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { scanActivations, generateHistogram, displayResults };
