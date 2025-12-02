#!/usr/bin/env node

/**
 * BeraChef Activation Scanner - Cutting Board Activity Analyzer
 * 
 * This script scans for ActivateRewardAllocation events from the BeraChef contract
 * to analyze validator cutting board activation activity. It provides insights into:
 * - How frequently validators activate reward allocation changes
 * - Time patterns between cutting board activations
 * - Last activation date for each validator
 * - Validators with zero activation events
 * - Current allocation status vs default allocations
 * 
 * Features:
 * - Scans ActivateRewardAllocation events using eth_getLogs
 * - Maps validator pubkeys to names using the validator database
 * - Calculates time statistics (gaps between changes, time since last change)
 * - Displays last activation date for each validator
 * - Compares current allocations against default allocations
 * - Generates histograms of activation event counts
 * - Supports custom day ranges and RPC endpoints
 */

const { ethers } = require('ethers');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const crypto = require('crypto');
const Table = require('cli-table3');

const { ValidatorNameDB, ConfigHelper, ProgressReporter, BlockFetcher } = require('./lib/shared-utils');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Database path for validator data - use shared config
const VALIDATOR_DB_PATH = ConfigHelper.getValidatorDbPath();

// Configuration
const CONFIG = {
  // BeraChef contract addresses
  contracts: {
    mainnet: '0xdf960E8F3F19C481dDE769edEDD439ea1a63426a',
    bepolia: '0xdf960E8F3F19C481dDE769edEDD439ea1a63426a'
  },
  
  // Event signatures
  // ActivateRewardAllocation(bytes indexed valPubkey, uint64 startBlock, tuple[] weights)
  activateEventSignature: '0x09fed3850dff4fef07a5284847da937f94021882ecab1c143fcacd69e5451bd8',
  // QueueRewardAllocation(bytes indexed valPubkey, uint64 startBlock, tuple[] weights)
  queueEventSignature: '0x22fe555512d9a04d20e3735ac5fe7a73227c2c6398f1453a5d60ce7aaf5de2ae',
  
  // RPC request settings
  timeout: 30000,
  maxRetries: 3
};

// Initialize validator database
const validatorDB = new ValidatorNameDB(VALIDATOR_DB_PATH);
// Ethers interface for BeraChef view functions
const BERACHEF_IFACE = new ethers.Interface([
  'function getActiveRewardAllocation(bytes valPubkey) view returns (tuple(uint64 startBlock, tuple(address receiver, uint96 percentageNumerator)[] weights))',
  'function getDefaultRewardAllocation() view returns (tuple(uint64 startBlock, tuple(address receiver, uint96 percentageNumerator)[] weights))'
]);

// Load genesis validators
function loadGenesisValidators() {
  try {
    const genesisPath = path.join(__dirname, '..', 'pol-performance-study', 'genesis_validators.csv');
    const content = fs.readFileSync(genesisPath, 'utf8');
    const lines = content.trim().split('\n').slice(1); // Skip header
    
    const genesisSet = new Set();
    for (const line of lines) {
      const columns = line.split(',');
      if (columns.length >= 3) {
        const pubkey = columns[2].toLowerCase(); // CometBFT Pubkey column
        genesisSet.add(pubkey);
      }
    }
    return genesisSet;
  } catch (error) {
    console.warn(`⚠️  Could not load genesis validators: ${error.message}`);
    return new Set();
  }
}

const genesisValidators = loadGenesisValidators();

// Helper: eth_call using ethers-style encoded data, return raw result hex
async function ethCall(rpcUrl, to, data, blockNumber = 'latest') {
  return await rpcRequest(rpcUrl, 'eth_call', [{ to, data }, blockNumber]);
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

// Helper: execute SQL against the validator database
async function executeSQL(sql, params = []) {
  return new Promise((resolve, reject) => {
    let finalSql = sql;
    if (params.length > 0) {
      for (let i = 0; i < params.length; i++) {
        const param = params[i] == null ? 'NULL' : `'${params[i].toString().replace(/'/g, "''")}'`;
        finalSql = finalSql.replace('?', param);
      }
    }
    
    const sqlite = spawn('sqlite3', [VALIDATOR_DB_PATH, finalSql]);
    let output = '';
    let error = '';
    
    sqlite.stdout.on('data', (data) => { output += data.toString(); });
    sqlite.stderr.on('data', (data) => { error += data.toString(); });
    
    sqlite.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, output });
      } else {
        reject(new Error(`SQLite error: ${error || 'Unknown error'}`));
      }
    });
  });
}

// Ensure last_activation column exists in validators table
async function ensureLastActivationColumn() {
  try {
    // Check if column exists by attempting to select it
    await executeSQL('SELECT last_activation FROM validators LIMIT 1');
  } catch (error) {
    // Column doesn't exist, add it
    console.log('📝 Adding last_activation column to validators table...');
    await executeSQL('ALTER TABLE validators ADD COLUMN last_activation INTEGER');
    console.log('✅ Column added successfully');
  }
}

// Update last_activation for validators based on getActiveRewardAllocation at final block
async function updateLastActivations(rpcUrl, contractAddress, finalBlockNumber, allValidators) {
  console.log(`💾 Updating last_activation from getActiveRewardAllocation at block ${finalBlockNumber}...`);
  
  let updatedCount = 0;
  let skippedCount = 0;
  
  // Process validators in parallel batches
  const batchSize = 10;
  for (let i = 0; i < allValidators.length; i += batchSize) {
    const batch = allValidators.slice(i, i + batchSize);
    await Promise.all(batch.map(async (validator) => {
      if (!validator.pubkey) return;
      
      try {
        // Normalize pubkey (ensure 0x prefix)
        const pk = validator.pubkey.startsWith('0x') ? validator.pubkey : `0x${validator.pubkey}`;
        
        // Call getActiveRewardAllocation at the final block
        const data = BERACHEF_IFACE.encodeFunctionData('getActiveRewardAllocation', [pk]);
        const resultHex = await ethCall(rpcUrl, contractAddress, data, finalBlockNumber);
        const allocation = decodeRewardAllocation(resultHex);
        
        if (allocation && allocation.startBlock) {
          // Get the timestamp of the startBlock
          const startBlockNumber = allocation.startBlock;
          const blockData = await getBlock(rpcUrl, startBlockNumber);
          const startBlockTimestamp = parseInt(blockData.timestamp, 16);
          
          // Update last_activation with the startBlock's timestamp
          await executeSQL(
            'UPDATE validators SET last_activation = ? WHERE pubkey = ?',
            [startBlockTimestamp, validator.pubkey]
          );
          updatedCount++;
        } else {
          // No active allocation or invalid response - set to NULL
          await executeSQL(
            'UPDATE validators SET last_activation = NULL WHERE pubkey = ?',
            [validator.pubkey]
          );
          skippedCount++;
        }
      } catch (error) {
        console.warn(`⚠️  Failed to update last_activation for validator ${validator.name || validator.pubkey?.substring(0, 20)}: ${error.message}`);
        // Set to NULL on error
        try {
          await executeSQL(
            'UPDATE validators SET last_activation = NULL WHERE pubkey = ?',
            [validator.pubkey]
          );
        } catch (e) {
          // Ignore update errors
        }
        skippedCount++;
      }
    }));
  }
  
  console.log(`✅ Updated last_activation for ${updatedCount} validators (${skippedCount} skipped/failed)`);
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
    // Handle both number and hex string inputs
    const blockHex = typeof blockNumber === 'string' && blockNumber.startsWith('0x') 
      ? blockNumber 
      : `0x${blockNumber.toString(16)}`;
    const block = await rpcRequest(rpcUrl, 'eth_getBlockByNumber', [
      blockHex,
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
function decodeRewardAllocationEvent(log, blockTimestamp) {
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
  ProgressReporter.logStep('Scanning blocks', `backwards for ActivateRewardAllocation events`);
  
  const contractAddress = CONFIG.contracts[config.chain];
  const latestBlock = await getLatestBlock(config.rpc);
  
  // Calculate target timestamp for X days ago
  const now = Math.floor(Date.now() / 1000);
  const targetTimestamp = now - (config.days * 24 * 60 * 60);
  
  // Use proper date triangulation to find the block at target timestamp
  const clUrl = ConfigHelper.getBlockScannerUrl(config.chain);
  const blockFetcher = new BlockFetcher(clUrl);
  
  console.log(`📊 Finding block from ${config.days} days ago using date triangulation...`);
  const earliestBlock = await blockFetcher.findBlockByTimestamp(targetTimestamp, latestBlock);
  
  if (!earliestBlock) {
    throw new Error(`Could not find block for timestamp ${config.days} days ago`);
  }
  
  console.log(`📊 Scanning backwards from block ${latestBlock} to ${earliestBlock} (${config.days} days)`);
  
  // Note: As of block 12181288 on mainnet, Figment has yet to update its cutting board,
  // so there's no point looking for it. We'll stop when we've found activations for all but 1 validator.
  
  const activations = [];
  const validatorCounts = new Map();
  const validatorTimestamps = new Map();
  const validatorsWithActivations = new Set();
  
  // Get total validator count to know when to stop
  const allValidators = await validatorDB.getAllValidators();
  const totalValidators = allValidators.length;
  const targetValidatorsFound = totalValidators - 1; // All but 1
  
  console.log(`🎯 Target: Find activations for ${targetValidatorsFound} of ${totalValidators} validators`);
  
  try {
    // Scan backwards in chunks of 172,800 blocks (4 × 43,200)
    const chunkSize = 172800;
    let allLogs = [];
    let processedBlocks = 0;
    let currentBlock = latestBlock;
    
    while (currentBlock >= earliestBlock && validatorsWithActivations.size < targetValidatorsFound) {
      const chunkStart = Math.max(earliestBlock, currentBlock - chunkSize + 1);
      const chunkEnd = currentBlock;
      
      if (config.verbose) {
        console.log(`📦 Processing chunk: blocks ${chunkStart}-${chunkEnd}... (found ${validatorsWithActivations.size}/${targetValidatorsFound} validators)`);
      }
      
      try {
        // Break chunk into smaller sub-chunks if needed (max 100,000 blocks per getLogs call)
        const maxBlockRange = 100000;
        const chunkLogs = [];
        
        for (let subStart = chunkStart; subStart <= chunkEnd; subStart += maxBlockRange) {
          const subEnd = Math.min(subStart + maxBlockRange - 1, chunkEnd);
          
          try {
            const logs = await getLogs(config.rpc, subStart, subEnd, contractAddress, [CONFIG.activateEventSignature]);
            chunkLogs.push(...logs);
          } catch (error) {
            console.warn(`⚠️  Failed to get logs for sub-chunk ${subStart}-${subEnd}: ${error.message}`);
          }
        }
        
        allLogs = allLogs.concat(chunkLogs);
        
        // Track which validators we've found
        for (const log of chunkLogs) {
          const valPubkey = log.topics[1];
          validatorsWithActivations.add(valPubkey);
        }
        
        processedBlocks += (chunkEnd - chunkStart + 1);
        
        if (config.verbose || processedBlocks % 86400 === 0) {
          ProgressReporter.showProgress(processedBlocks, maxBlocksToScan, chunkEnd);
        }
        
        // Check if we've found enough validators
        if (validatorsWithActivations.size >= targetValidatorsFound) {
          console.log(`\n✅ Found activations for ${validatorsWithActivations.size} validators (target: ${targetValidatorsFound})`);
          break;
        }
        
      } catch (error) {
        console.warn(`⚠️  Failed to process chunk ${chunkStart}-${chunkEnd}: ${error.message}`);
        // Continue with next chunk
      }
      
      currentBlock = chunkStart - 1;
    }
    
    ProgressReporter.clearProgress();
    console.log(`📋 Found ${allLogs.length} ActivateRewardAllocation events across ${validatorsWithActivations.size} validators`);
    
    // Fetch all unique blocks in parallel with controlled concurrency
    const uniqueBlockNumbers = [...new Set(allLogs.map(log => parseInt(log.blockNumber, 16)))];
    console.log(`📦 Fetching timestamps for ${uniqueBlockNumbers.length} unique blocks with batched parallelism...`);
    
    const blockCache = new Map();
    const concurrency = 50; // Concurrent requests at a time
    
    // Process blocks in batches
    for (let i = 0; i < uniqueBlockNumbers.length; i += concurrency) {
      const batch = uniqueBlockNumbers.slice(i, i + concurrency);
      const batchPromises = batch.map(async (blockNum) => {
        try {
          const block = await getBlock(config.rpc, blockNum);
          blockCache.set(blockNum, block.timestamp);
        } catch (error) {
          if (config.verbose) {
            console.warn(`⚠️  Failed to get block ${blockNum}: ${error.message}`);
          }
        }
      });
      
      await Promise.all(batchPromises);
      
      if (config.verbose) {
        const progress = Math.min(100, ((i + concurrency) / uniqueBlockNumbers.length * 100).toFixed(1));
        console.log(`   Progress: ${blockCache.size}/${uniqueBlockNumbers.length} blocks (${progress}%)`);
      }
    }
    
    console.log(`✅ Fetched ${blockCache.size} block timestamps`);
    
    // Process each log using cached block data
    for (const log of allLogs) {
      try {
        const blockNum = parseInt(log.blockNumber, 16);
        const blockTimestamp = blockCache.get(blockNum);
        
        if (blockTimestamp) {
          const eventData = decodeRewardAllocationEvent(log, blockTimestamp);
          
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
  
  // Filter out exited validators (those with no stake)
  const activeValidators = allValidators.filter(v => {
    const stake = v.voting_power ? parseFloat(v.voting_power) / 1e9 : 0;
    return stake > 0;
  });
  
  console.log(`👥 Found ${activeValidators.length} active validators with stake (${allValidators.length - activeValidators.length} exited)`);
  
  // Count validators with 0 activations
  let validatorsWithZeroActivations = 0;
  for (const validator of activeValidators) {
    if (validator.address && !validatorCounts.has(validator.address)) {
      validatorsWithZeroActivations++;
    }
  }
  
  // Get default allocation from BeraChef contract
  const contractAddress = CONFIG.contracts[config.chain];
  const defaultAllocation = await getDefaultRewardAllocation(config.rpc, contractAddress);
  
  // Check which validators are using the default allocation and get their startBlocks
  let validatorsUsingDefault = 0;
  const validatorAllocationStatus = new Map();
  const validatorStartBlocks = new Map();
  
  if (defaultAllocation) {
    console.log(`🔍 Checking allocation status for ${activeValidators.length} validators with batched parallelism...`);
    
    const validatorsToCheck = activeValidators.filter(v => v.pubkey);
    const concurrency = 50;
    
    // Process validators in batches
    for (let i = 0; i < validatorsToCheck.length; i += concurrency) {
      const batch = validatorsToCheck.slice(i, i + concurrency);
      const batchPromises = batch.map(async (validator) => {
        try {
          const data = BERACHEF_IFACE.encodeFunctionData('getActiveRewardAllocation', [validator.pubkey]);
          const result = await ethCall(config.rpc, contractAddress, data);
          const activeAlloc = decodeRewardAllocation(result);
          
          const isUsingDefault = allocationsEqualIgnoringOrder(activeAlloc, defaultAllocation);
          
          validatorAllocationStatus.set(validator.address, isUsingDefault);
          validatorStartBlocks.set(validator.address, activeAlloc.startBlock);
          
          if (isUsingDefault === true) {
            validatorsUsingDefault++;
          }
        } catch (error) {
          validatorAllocationStatus.set(validator.address, null);
          validatorStartBlocks.set(validator.address, null);
        }
      });
      
      await Promise.all(batchPromises);
    }
  }
  
  return {
    defaultAllocation,
    validatorsUsingDefault,
    totalValidators: activeValidators.length,
    validatorsWithZeroActivations,
    allValidators: activeValidators,
    validatorAllocationStatus,
    validatorStartBlocks
  };
}

// Generate histogram with buckets
function generateHistogram(validatorCounts, totalValidators) {
  const counts = Array.from(validatorCounts.values());
  
  // Define buckets: [min, max, label]
  const buckets = [
    [0, 0, '0'],
    [1, 10, '1-10'],
    [11, 50, '11-50'],
    [51, 100, '51-100'],
    [101, 500, '101-500'],
    [501, 1000, '501-1000'],
    [1001, 2000, '1001-2000'],
    [2001, Infinity, '2001+']
  ];
  
  const histogram = new Map();
  
  // Initialize buckets
  for (const [min, max, label] of buckets) {
    histogram.set(label, 0);
  }
  
  // Count validators with activations into buckets
  for (const count of counts) {
    for (const [min, max, label] of buckets) {
      if (count >= min && count <= max) {
        histogram.set(label, histogram.get(label) + 1);
        break;
      }
    }
  }
  
  // Add validators with 0 activations
  const validatorsWithActivations = validatorCounts.size;
  const validatorsWithZeroActivations = totalValidators - validatorsWithActivations;
  if (validatorsWithZeroActivations > 0) {
    histogram.set('0', validatorsWithZeroActivations);
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

// Format stake in K (thousands) or M (millions) BERA
function formatStake(stake) {
  if (stake >= 1000000) {
    return `${(stake / 1000000).toFixed(1)}M`;
  } else if (stake >= 1000) {
    return `${(stake / 1000).toFixed(1)}K`;
  } else {
    return stake.toFixed(1);
  }
}

// Display results
async function displayResults(activations, validatorCounts, validatorTimestamps, currentAllocations, config) {
  if (!config.csv) {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 BeraChef Activation Scanner Results');
    console.log('='.repeat(60));
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total activations found: ${activations.length}`);
    console.log(`   Validators with activations: ${validatorCounts.size}`);
    console.log(`   Genesis validators loaded: ${genesisValidators.size}`);
  }
  
  // Fetch latest block with timestamp for "days ago" calculations
  const latestBlock = await getLatestBlock(config.rpc);
  const latestBlockData = await getBlock(config.rpc, latestBlock);
  const latestBlockTimestamp = parseInt(latestBlockData.timestamp, 16);
  
  // Calculate target timestamp for X days ago and find the actual block
  const now = Math.floor(Date.now() / 1000);
  const targetTimestamp = now - (config.days * 24 * 60 * 60);
  
  // Use proper date triangulation to find the earliest block
  const clUrl = ConfigHelper.getBlockScannerUrl(config.chain);
  const blockFetcher = new BlockFetcher(clUrl);
  const earliestBlock = await blockFetcher.findBlockByTimestamp(targetTimestamp, latestBlock);
  
  if (!earliestBlock) {
    throw new Error(`Could not find block for timestamp ${config.days} days ago`);
  }
  
  const earliestBlockData = await getBlock(config.rpc, earliestBlock);
  const earliestBlockTimestamp = parseInt(earliestBlockData.timestamp, 16);
  const earliestDate = new Date(earliestBlockTimestamp * 1000).toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric'
  });
  
  // Display current allocation analysis
  if (!config.csv) {
    if (currentAllocations) {
      console.log(`\n🎯 Current Validator Allocations:`);
      console.log(`   Validators with 0 activations: ${currentAllocations.validatorsWithZeroActivations || 0}`);
      console.log(`   Validators using default cutting board: ${currentAllocations.validatorsUsingDefault || 0}`);
      console.log(`   Total active validators: ${currentAllocations.totalValidators}`);
    }
    
    if (activations.length === 0) {
      console.log('\n❌ No ActivateRewardAllocation events found in the specified block range.');
      console.log('   This could mean:');
      console.log('   - No validators activated cutting board changes in this period');
      console.log('   - Wrong contract address or event signature');
      console.log('   - Network issues during scanning');
      return;
    }
  } else if (activations.length === 0) {
    // For CSV mode, just return if no activations
    return;
  }
  
  // Calculate time statistics
  const activationLatestTimestamp = activations.length > 0 ? 
    Math.max(...activations.map(a => a.blockTimestamp)) : 0;
  const timeStats = calculateTimeStats(validatorTimestamps, activationLatestTimestamp);
  
  // Collect all unique activeStartBlocks that need timestamp fetching
  const uniqueStartBlocks = new Set();
  if (currentAllocations.validatorStartBlocks) {
    for (const startBlock of currentAllocations.validatorStartBlocks.values()) {
      if (startBlock && startBlock > 0) {
        uniqueStartBlocks.add(startBlock);
      }
    }
  }
  
  // Batch fetch timestamps for all activeStartBlocks
  const startBlockTimestamps = new Map();
  if (uniqueStartBlocks.size > 0) {
    if (!config.csv) {
      console.log(`📦 Fetching timestamps for ${uniqueStartBlocks.size} unique active start blocks...`);
    }
    const blockNumbers = Array.from(uniqueStartBlocks);
    const concurrency = 50;
    
    for (let i = 0; i < blockNumbers.length; i += concurrency) {
      const batch = blockNumbers.slice(i, i + concurrency);
      const batchPromises = batch.map(async (blockNum) => {
        try {
          const block = await getBlock(config.rpc, blockNum);
          startBlockTimestamps.set(blockNum, parseInt(block.timestamp, 16));
        } catch (error) {
          if (config.verbose) {
            console.warn(`⚠️  Failed to get block ${blockNum}: ${error.message}`);
          }
        }
      });
      
      await Promise.all(batchPromises);
    }
    if (!config.csv) {
      console.log(`✅ Fetched ${startBlockTimestamps.size} start block timestamps`);
    }
  }
  
  // Generate and display histogram
  if (!config.csv) {
    const histogram = generateHistogram(validatorCounts, currentAllocations.totalValidators);
    
    // Display in bucket order
    const bucketOrder = ['0', '1-10', '11-50', '51-100', '101-500', '501-1000', '1001-2000', '2001+'];
    
    console.log('\n📈 Histogram - Validators by Activation Count:');
    console.log('   Activations | Validators');
    console.log('   ------------|-----------');
    
    for (const bucket of bucketOrder) {
      const validatorCount = histogram.get(bucket) || 0;
      if (validatorCount > 0) {
        const bar = '█'.repeat(Math.min(validatorCount, 50));
        console.log(`   ${bucket.padStart(11)} | ${validatorCount.toString().padStart(9)} ${bar}`);
      }
    }
  }
  
  
  // Show detailed validator table
  const activationsColWidth = 18 + earliestDate.length; // "Activations since " + date
  
  if (!config.csv) {
    console.log('\n📋 Detailed Validator Analysis (** = Genesis Validator):');
  }
  
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
    const activeStartBlock = currentAllocations.validatorStartBlocks?.get(address);
    const activeStartTimestamp = activeStartBlock ? startBlockTimestamps.get(activeStartBlock) : null;
    
    allValidatorData.push({ 
      pubkey: address, 
      activationCount, 
      hasStakeData: !!validator, 
      validator,
      activeStartTimestamp
    });
  }
  
  // Add validators with 0 activations
  for (const validator of allValidators) {
    if (validator.address && !validatorCounts.has(validator.address)) {
      const activeStartBlock = currentAllocations.validatorStartBlocks?.get(validator.address);
      const activeStartTimestamp = activeStartBlock ? startBlockTimestamps.get(activeStartBlock) : null;
      
      allValidatorData.push({ 
        pubkey: validator.address, 
        activationCount: 0, 
        hasStakeData: true, 
        validator,
        activeStartTimestamp
      });
    }
  }
  
  // Sort by active start timestamp (descending - most recent first), then by name
  allValidatorData.sort((a, b) => {
    const timestampA = a.activeStartTimestamp || 0;
    const timestampB = b.activeStartTimestamp || 0;
    
    if (timestampB !== timestampA) {
      return timestampB - timestampA;
    }
    // If same timestamp, sort by name
    const nameA = a.validator?.name || a.pubkey;
    const nameB = b.validator?.name || b.pubkey;
    return nameA.localeCompare(nameB);
  });
  
  if (config.csv) {
    // Output CSV format
    console.log(`Validator Name,Stake (BERA),Activations since ${earliestDate},Reward Alloc,Avg Gap,Default,Is Genesis`);
    
    for (const { pubkey, activationCount, hasStakeData, validator } of allValidatorData) {
      const stats = timeStats.get(pubkey);
      let name = await getValidatorName(pubkey);
      
      // Check if this is a genesis validator
      const validatorPubkey = validator?.pubkey || pubkey;
      const isGenesis = genesisValidators.has(validatorPubkey.toLowerCase());
      
      // Get stake
      const stake = hasStakeData && validator && validator.voting_power ? 
        (parseFloat(validator.voting_power) / 1e9) : null;
      
      // Skip exited validators
      if (!stake || stake === 0) {
        continue;
      }
      
      const stakeStr = formatStake(stake);
      
      // Calculate days ago for current active allocation startBlock using actual timestamps
      const activeStartBlock = currentAllocations.validatorStartBlocks?.get(pubkey);
      let activeBlockDaysAgo = 'Never';
      if (activeStartBlock && activeStartBlock > 0) {
        const startBlockTimestamp = startBlockTimestamps.get(activeStartBlock);
        if (startBlockTimestamp) {
          const secondsAgo = latestBlockTimestamp - startBlockTimestamp;
          const daysAgo = Math.floor(secondsAgo / 86400);
          activeBlockDaysAgo = daysAgo === 0 ? 'Today' : `${daysAgo}d ago`;
        }
      }
      
      // Format time gaps
      const avgGap = stats && stats.activationCount >= 4 ? formatDuration(stats.avgGapSeconds) : '';
      
      // Get default allocation status
      const isUsingDefault = currentAllocations.validatorAllocationStatus?.get(pubkey);
      const defaultStr = isUsingDefault === true ? 'Yes' : isUsingDefault === false ? 'No' : 'N/A';
      
      // Escape name for CSV (handle commas and quotes)
      const escapedName = name.includes(',') || name.includes('"') ? `"${name.replace(/"/g, '""')}"` : name;
      
      console.log(`${escapedName},${stakeStr},${activationCount},${activeBlockDaysAgo},${avgGap},${defaultStr},${isGenesis ? 'Yes' : 'No'}`);
    }
  } else {
    // Create table with cli-table3
    const table = new Table({
      head: ['Validator Name', 'Stake (BERA)', `Activations since ${earliestDate}`, 'Reward Alloc', 'Avg Gap', 'Default'],
      colAligns: ['left', 'right', 'right', 'right', 'right', 'right'],
      style: {
        head: [],
        border: []
      }
    });
    
    // Populate table rows
    for (const { pubkey, activationCount, hasStakeData, validator } of allValidatorData) {
      const stats = timeStats.get(pubkey);
      let name = await getValidatorName(pubkey);
      
      // Check if this is a genesis validator and add ** marker
      const validatorPubkey = validator?.pubkey || pubkey;
      const isGenesis = genesisValidators.has(validatorPubkey.toLowerCase());
      if (isGenesis) {
        name = name + ' **';
      }
      
      // Get stake - only validators with 0 activations have stake data
      const stake = hasStakeData && validator && validator.voting_power ? 
        (parseFloat(validator.voting_power) / 1e9) : null; // Convert to BERA
      
      // Skip exited validators (those with no current stake)
      if (!stake || stake === 0) {
        continue;
      }
      
      const stakeStr = formatStake(stake);
      
      // Calculate days ago for current active allocation startBlock using actual timestamps
      const activeStartBlock = currentAllocations.validatorStartBlocks?.get(pubkey);
      let activeBlockDaysAgo = 'Never';
      if (activeStartBlock && activeStartBlock > 0) {
        const startBlockTimestamp = startBlockTimestamps.get(activeStartBlock);
        if (startBlockTimestamp) {
          const secondsAgo = latestBlockTimestamp - startBlockTimestamp;
          const daysAgo = Math.floor(secondsAgo / 86400);
          activeBlockDaysAgo = daysAgo === 0 ? 'Today' : `${daysAgo}d ago`;
        }
      }
      
      // Format time gaps (only show for 4+ activations)
      const avgGap = stats && stats.activationCount >= 4 ? formatDuration(stats.avgGapSeconds) : '';
      
      // Get default allocation status - now mapped by address
      const isUsingDefault = currentAllocations.validatorAllocationStatus?.get(pubkey);
      const defaultStr = isUsingDefault === true ? 'Yes' : isUsingDefault === false ? 'No' : 'N/A';
      
      // Truncate name if too long
      const shortName = name.length > 30 ? name.slice(0, 27) + '...' : name;
      
      table.push([shortName, stakeStr, activationCount, activeBlockDaysAgo, avgGap, defaultStr]);
    }
    
    console.log(table.toString());
  }
  
}

// Parse command line arguments
function parseArgs() {
  const argv = yargs(hideBin(process.argv))
    .option('days', {
      alias: 'd',
      type: 'number',
      default: 180,
      description: 'Maximum number of days to scan backwards'
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
    .option('csv', {
      type: 'boolean',
      default: false,
      description: 'Output validator table as CSV'
    })
    .option('to-block', {
      alias: 'b',
      type: 'number',
      description: 'Final block number to scan up to (default: latest block)'
    })
    .option('to-date', {
      alias: 'e',
      type: 'string',
      description: 'Final date to scan up to (YYYY-MM-DD format, default: latest block)'
    })
    .option('help', {
      alias: 'h',
      type: 'boolean',
      description: 'Show help'
    })
    .strict()
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
    days: argv.days,
    rpc: rpcUrl,
    chain: argv.chain,
    verbose: argv.verbose,
    csv: argv.csv,
    toBlock: argv['to-block'],
    toDate: argv['to-date'],
    help: argv.help
  };
}

// Main function
async function main() {
  const config = parseArgs();
  
  if (config.help) {
    console.log(`
BeraChef Activation Scanner

Scans blocks backwards for ActivateRewardAllocation events from BeraChef contract
and generates a histogram of validator cutting board activation activity. Stops when it finds
activations for all but one validator or reaches the day limit.

Usage:
  node scan-berachef-activations.js [options]

Options:
  -d, --days <number>     Maximum days to scan backwards (default: 180)
  -r, --rpc <url>         RPC endpoint URL
  -c, --chain <name>      Chain name: mainnet, bepolia (default: mainnet)
  -b, --to-block <number> Final block number to scan up to (default: latest block)
  -e, --to-date <date>    Final date to scan up to (YYYY-MM-DD format, default: latest block)
  -v, --verbose           Verbose output
  --csv                   Output validator table as CSV
  -h, --help              Show this help

Examples:
  node scan-berachef-activations.js --chain mainnet
  node scan-berachef-activations.js --days 60 --verbose
  node scan-berachef-activations.js --days 120 --rpc https://bepolia.rpc.berachain.com
  node scan-berachef-activations.js --to-date 2025-01-20
  node scan-berachef-activations.js --to-block 12345678
  node scan-berachef-activations.js --csv > validators.csv
`);
    process.exit(0);
  }
  
  try {
    console.log('🚀 Starting BeraChef Activation Scanner...\n');
    
    // Ensure database and column exist
    await ensureLastActivationColumn();
    
    const contractAddress = CONFIG.contracts[config.chain];
    
    // Get final block number from command line option or use latest from chain
    let finalBlockNumber;
    if (config.toBlock) {
      finalBlockNumber = `0x${config.toBlock.toString(16)}`;
      console.log(`📊 Using final block from command line option: ${config.toBlock}`);
    } else if (config.toDate) {
      // Parse date and find the block at start of that day (00:00:00 UTC)
      const dateMatch = config.toDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) {
        throw new Error(`Invalid date format: ${config.toDate}. Expected YYYY-MM-DD`);
      }
      
      const targetDate = new Date(config.toDate + 'T00:00:00.000Z');
      const targetTimestamp = Math.floor(targetDate.getTime() / 1000);
      
      const latestBlock = await getLatestBlock(config.rpc);
      const clUrl = ConfigHelper.getBlockScannerUrl(config.chain);
      const blockFetcher = new BlockFetcher(clUrl);
      const finalBlock = await blockFetcher.findBlockByTimestamp(targetTimestamp, latestBlock);
      
      if (finalBlock) {
        finalBlockNumber = `0x${finalBlock.toString(16)}`;
        console.log(`📊 Using final block from date ${config.toDate}: ${finalBlock}`);
      } else {
        throw new Error(`Could not find block for date ${config.toDate}`);
      }
    } else {
      const latestBlock = await getLatestBlock(config.rpc);
      finalBlockNumber = `0x${latestBlock.toString(16)}`;
      console.log(`📊 Using latest block from chain: ${latestBlock}`);
    }
    
    const { activations, validatorCounts, validatorTimestamps } = await scanActivations(config);
    const currentAllocations = await analyzeCurrentAllocations(config, validatorCounts);
    
    // Update last_activation in database using getActiveRewardAllocation at final block
    console.log(`\n💾 Updating last_activation from current reward allocations...`);
    await updateLastActivations(config.rpc, contractAddress, finalBlockNumber, currentAllocations.allValidators);
    
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
