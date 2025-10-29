#!/usr/bin/env node

/**
 * Scan Active Pools - Staking Pool Status Scanner
 * 
 * This script finds all activated staking pools and reports their current status:
 * - Whether they are still active on the Consensus Layer
 * - Their current stake/balance
 * - Number of shareholders (stBERA holders)
 * - Sample shareholder addresses
 * 
 * Features:
 * - Scans for StakingPoolActivated events to find all pools
 * - Queries pool contracts for validator pubkeys and state
 * - Checks CL validator status and balance
 * - Analyzes SharesMinted events to find shareholders
 * - Displays formatted table with pool status
 */

const { ethers } = require('ethers');
const Table = require('cli-table3');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { ConfigHelper, scanLogsInChunks } = require('./lib/shared-utils');

// Parse arguments
const argv = yargs(hideBin(process.argv))
  .option('chain', {
    alias: 'c',
    description: 'Network: mainnet or bepolia',
    type: 'string',
    default: 'mainnet'
  })
  .option('start', {
    alias: 's',
    description: 'Start block number',
    type: 'number',
    default: 0
  })
  .option('chunk-size', {
    description: 'Number of blocks to query per chunk',
    type: 'number',
    default: 50000
  })
  .help()
  .alias('help', 'h')
  .argv;

// Configuration
const EL_RPC_URL = ConfigHelper.getRpcUrl('el', argv.chain);
const CHUNK_SIZE = argv['chunk-size'];
const START_BLOCK = argv.start;

// Event signatures
const STAKING_POOL_ACTIVATED_TOPIC = ethers.id('StakingPoolActivated()');
const SHARES_MINTED_TOPIC = ethers.id('SharesMinted(address,uint256)');
const SHARES_BURNED_TOPIC = ethers.id('SharesBurned(address,uint256)');

// StakingPool ABI fragments we need
const STAKING_POOL_ABI = [
  'function getValidatorPubkey() external view returns (bytes)',
  'function isActive() external view returns (bool)',
  'function isFullyExited() external view returns (bool)',
  'function totalAssets() external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function bufferedAssets() external view returns (uint256)',
  'function totalDeposits() external view returns (uint256)',
  'function activeThresholdReached() external view returns (bool)'
];

async function scanActivePools() {
  try {
    console.log(`\nScanning for active staking pools on ${argv.chain}...`);
    console.log(`EL RPC: ${EL_RPC_URL}`);
    console.log('');

    // Initialize providers
    const elProvider = new ethers.JsonRpcProvider(EL_RPC_URL);
    const latestBlock = await elProvider.getBlockNumber();

    console.log(`Latest block: ${latestBlock}`);
    console.log(`Scanning from block ${START_BLOCK} to ${latestBlock}...\n`);

    // Step 1: Find all StakingPoolActivated events
    console.log('Step 1: Finding all activated staking pools...');
    const activated = await findActivatedPools(elProvider, latestBlock);
    
    if (activated.length === 0) {
      console.log('\nNo activated staking pools found.');
      return;
    }

    console.log(`\nFound ${activated.length} activated pool(s).\n`);

    // Step 2: Aggregate shareholder logs across all pools (topic-only scan)
    console.log('Step 2: Scanning share events across pools ...');
    const aggregatedShareholders = await aggregateShareholdersAcrossPools(elProvider, activated);

    // Step 3: Get detailed information for each pool
    console.log('Step 3: Gathering pool details ...\n');
    const poolsData = [];

    for (let i = 0; i < activated.length; i++) {
      const { address: poolAddress, activatedAt } = activated[i];
      process.stdout.write(`\rProcessing pool ${i + 1}/${activated.length}...`);
      
      try {
        const sh = aggregatedShareholders.get(poolAddress.toLowerCase()) || { count: 0, samples: [] };
        const poolData = await getPoolData(elProvider, poolAddress, activatedAt, sh);
        poolsData.push(poolData);
      } catch (error) {
        console.error(`\nError processing pool ${poolAddress}:`, error.message);
      }
    }

    console.log('\n');

    // Display results
    displayPoolsTable(poolsData);

  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

async function findActivatedPools(provider, latestBlock) {
  const earliestByAddress = new Map();
  
  await scanLogsInChunks(provider, {
    address: undefined,
    topics: [STAKING_POOL_ACTIVATED_TOPIC],
    fromBlock: START_BLOCK,
    toBlock: latestBlock,
    chunkSize: CHUNK_SIZE || ConfigHelper.getDefaultLogChunkSize(),
    onChunk: async ({ from, to, logs }) => {
      const progress = ((to - START_BLOCK) / (latestBlock - START_BLOCK) * 100).toFixed(1);
      process.stdout.write(`\rScanning blocks ${from}-${to} (${progress}%)...`);
      for (const log of logs) {
        const addr = log.address;
        const bn = Number(log.blockNumber);
        const prev = earliestByAddress.get(addr);
        if (prev == null || bn < prev) earliestByAddress.set(addr, bn);
      }
    }
  });

  console.log('');
  return Array.from(earliestByAddress.entries()).map(([address, activatedAt]) => ({ address, activatedAt }));
}

async function getPoolData(provider, poolAddress, activatedAt, shareholders) {
  const contract = new ethers.Contract(poolAddress, STAKING_POOL_ABI, provider);

  // Get pool state
  const [
    pubkeyBytes,
    isActive,
    isFullyExited,
    totalAssets,
    totalSupply,
    bufferedAssets,
    totalDeposits,
    activeThresholdReached
  ] = await Promise.all([
    contract.getValidatorPubkey(),
    contract.isActive(),
    contract.isFullyExited(),
    contract.totalAssets(),
    contract.totalSupply(),
    contract.bufferedAssets(),
    contract.totalDeposits(),
    contract.activeThresholdReached()
  ]);

  const pubkey = pubkeyBytes.substring(2); // Remove 0x prefix

  return {
    address: poolAddress,
    pubkey: '0x' + pubkey,
    status: {
      isActive,
      isFullyExited,
      activeThresholdReached,
      state: isFullyExited ? 'exited' : (isActive ? 'active' : 'pending')
    },
    metrics: {
      totalAssets: ethers.formatEther(totalAssets),
      totalSupply: ethers.formatEther(totalSupply),
      bufferedAssets: ethers.formatEther(bufferedAssets),
      totalDeposits: ethers.formatEther(totalDeposits)
    },
    shareholders: {
      count: shareholders.count,
      samples: shareholders.samples
    }
  };
}

async function aggregateShareholdersAcrossPools(provider, activatedPools) {
  const latestBlock = await provider.getBlockNumber();
  const startBlock = activatedPools.reduce((min, p) => Math.min(min, p.activatedAt || START_BLOCK), Number.MAX_SAFE_INTEGER);
  const fromBlockStart = Number.isFinite(startBlock) ? startBlock : START_BLOCK;

  const poolSet = new Set(activatedPools.map(p => (p.address || '').toLowerCase()));
  const mintedTopic = SHARES_MINTED_TOPIC.toLowerCase();
  const burnedTopic = SHARES_BURNED_TOPIC.toLowerCase();

  // Map<poolAddressLower, Map<holder, bigint>>
  const balancesByPool = new Map();

  await scanLogsInChunks(provider, {
    address: undefined,
    topics: [[SHARES_MINTED_TOPIC, SHARES_BURNED_TOPIC]],
    fromBlock: fromBlockStart,
    toBlock: latestBlock,
    chunkSize: CHUNK_SIZE || ConfigHelper.getDefaultLogChunkSize(),
    onChunk: async ({ logs }) => {
      for (const log of logs) {
        const poolAddrLower = (log.address || '').toLowerCase();
        if (!poolSet.has(poolAddrLower)) continue;
        const topic0 = (log.topics?.[0] || '').toLowerCase();
        if (!log.topics || log.topics.length < 2) continue;
        const user = '0x' + log.topics[1].slice(-40);
        const amount = log.data && log.data.length >= 66 ? BigInt('0x' + log.data.slice(2, 66)) : 0n;

        let inner = balancesByPool.get(poolAddrLower);
        if (!inner) { inner = new Map(); balancesByPool.set(poolAddrLower, inner); }
        const prev = inner.get(user) || 0n;
        if (topic0 === mintedTopic) {
          inner.set(user, prev + amount);
        } else if (topic0 === burnedTopic) {
          inner.set(user, prev - amount);
        }
      }
    }
  });

  const summaryByPool = new Map();
  for (const [pool, holderMap] of balancesByPool.entries()) {
    const holders = Array.from(holderMap.entries()).filter(([, v]) => v > 0n);
    holders.sort((a, b) => (b[1] > a[1] ? 1 : -1));
    const samples = holders.slice(0, 3).map(([addr, bal]) => `${addr} (${ethers.formatEther(bal)} stBERA)`);
    summaryByPool.set(pool, { count: holders.length, samples });
  }

  return summaryByPool;
}

function displayPoolsTable(pools) {
  if (pools.length === 0) {
    console.log('No pools to display.');
    return;
  }

  console.log('=== Staking Pools ===\n');

  const table = new Table({
    head: ['Pool', 'Status', 'Assets', 'Supply', 'Buf', 'Deposits', 'Holders', 'Samples'],
    colWidths: [44, 8, 14, 14, 12, 14, 10, 60],
    wordWrap: true
  });

  for (const p of pools) {
    const status = p.status.state;
    const samples = p.shareholders.samples.length ? p.shareholders.samples.join('\n') : '-';
    table.push([
      p.address,
      status,
      `${Number(p.metrics.totalAssets).toFixed(2)} BERA`,
      `${Number(p.metrics.totalSupply).toFixed(2)} stBERA`,
      `${Number(p.metrics.bufferedAssets).toFixed(2)} BERA`,
      `${Number(p.metrics.totalDeposits).toFixed(2)} BERA`,
      String(p.shareholders.count),
      samples
    ]);
  }

  console.log(table.toString());

  // Summary
  console.log('\n=== Summary ===\n');
  const activeOnEL = pools.filter(p => p.status.isActive).length;
  const fullyExited = pools.filter(p => p.status.isFullyExited).length;
  const totalShareholders = pools.reduce((sum, p) => sum + p.shareholders.count, 0);

  console.log(`Total Pools Found: ${pools.length}`);
  console.log(`Active (EL): ${activeOnEL}`);
  console.log(`Fully Exited: ${fullyExited}`);
  console.log(`Total Unique Shareholders: ${totalShareholders}`);
  console.log('');
}

// Run the script
scanActivePools();

