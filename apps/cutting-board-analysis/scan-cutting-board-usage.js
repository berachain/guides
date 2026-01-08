#!/usr/bin/env node

/**
 * Cutting Board Analysis Script
 * 
 * Analyzes validator cutting board usage and incentive distributions from a start date
 * to an optional end date or number of days. Outputs daily statistics per validator including:
 * - Percentage of blocks subject to automated cutting board (ACB)
 * - USD value extracted from incentive distributions
 * - Final stake amount
 */

const { ethers } = require('ethers');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

// Embedded utilities
class BlockFetcher {
  constructor(baseUrl, delayMs = 0) {
    this.baseUrl = baseUrl;
    this.delayMs = delayMs;
  }

  async getCurrentBlock() {
    try {
      const response = await axios.get(`${this.baseUrl}/status`);
      return parseInt(response.data.result.sync_info.latest_block_height);
    } catch (error) {
      console.error('Error fetching current block height:', error.message);
      return null;
    }
  }

  async getBlockTimestamp(blockHeight) {
    try {
      const response = await axios.get(`${this.baseUrl}/block?height=${blockHeight}`);
      const isoTime = response?.data?.result?.block?.header?.time;
      if (!isoTime) return null;
      return Math.floor(new Date(isoTime).getTime() / 1000);
    } catch (error) {
      console.error(`Error fetching block ${blockHeight}:`, error.message);
      return null;
    }
  }

  async binarySearchBoundary(lowHeight, highHeight, targetTimestamp) {
    while (lowHeight + 1 < highHeight) {
      const mid = Math.floor((lowHeight + highHeight) / 2);
      const midTs = await this.getBlockTimestamp(mid);
      if (midTs === null) {
        break;
      }
      if (midTs >= targetTimestamp) {
        highHeight = mid;
      } else {
        lowHeight = mid;
      }
    }
    return highHeight;
  }

  async findBlockByTimestamp(targetTimestamp, latestBlock, estimatedBlock = null) {
    const START_BLOCK = 933558;
    const START_TIMESTAMP = 1739205914;
    const BLOCK_TIME = 2;
    
    let estimate = estimatedBlock;
    if (!estimate) {
      const estimatedBlocks = Math.floor((targetTimestamp - START_TIMESTAMP) / BLOCK_TIME);
      estimate = Math.min(Math.max(START_BLOCK + estimatedBlocks, 2), latestBlock);
    }

    const estimateTs = await this.getBlockTimestamp(estimate);
    if (estimateTs === null) return null;

    let step = 1024;
    if (estimateTs < targetTimestamp) {
      let lowH = estimate;
      let lowTs = estimateTs;
      let highH = Math.min(lowH + step, latestBlock);
      let highTs = await this.getBlockTimestamp(highH);
      while (highTs !== null && highTs < targetTimestamp && highH < latestBlock) {
        lowH = highH;
        lowTs = highTs;
        step *= 2;
        highH = Math.min(highH + step, latestBlock);
        highTs = await this.getBlockTimestamp(highH);
      }
      if (highTs === null) return null;
      if (highTs < targetTimestamp) return null;
      return await this.binarySearchBoundary(lowH, highH, targetTimestamp);
    }

    let highH = estimate;
    let highTs = estimateTs;
    let lowH = Math.max(highH - step, 1);
    let lowTs = await this.getBlockTimestamp(lowH);
    while (lowTs !== null && lowTs >= targetTimestamp && lowH > 1) {
      highH = lowH;
      highTs = lowTs;
      step *= 2;
      lowH = Math.max(lowH - step, 1);
      lowTs = await this.getBlockTimestamp(lowH);
    }
    if (lowTs === null) return null;
    if (lowTs >= targetTimestamp) return null;
    return await this.binarySearchBoundary(lowH, highH, targetTimestamp);
  }
}

class ValidatorFetcher {
  constructor(clUrl) {
    this.clUrl = clUrl;
  }

  async getValidators(blockHeight, perPage = 99999) {
    try {
      const validators = {};
      let page = 1;
      
      while (true) {
        const response = await axios.get(`${this.clUrl}/validators?height=${blockHeight}&per_page=${perPage}&page=${page}`);
        
        if (response.data.error) {
          console.error(`RPC error for block ${blockHeight} page ${page}: ${response.data.error.message}`);
          break;
        }
        
        if (!response.data.result?.validators || response.data.result.validators.length === 0) {
          break;
        }
        
        response.data.result.validators.forEach(validator => {
          validators[validator.address] = {
            address: validator.address,
            voting_power: validator.voting_power / 1e9,
            pub_key: validator.pub_key.value
          };
        });
        
        if (response.data.result.validators.length < perPage) {
          break;
        }
        
        page++;
      }
      
      if (Object.keys(validators).length === 0) {
        console.error(`No validators found for block ${blockHeight}`);
        return null;
      }
      
      return validators;
    } catch (error) {
      console.error(`Error fetching validators at block ${blockHeight}:`, error.message);
      return null;
    }
  }
}

class ValidatorNameDB {
  constructor(dbPath) {
    this.explicitDbPath = dbPath;
  }

  getCandidateDbPaths() {
    const candidates = [];
    if (this.explicitDbPath) candidates.push(this.explicitDbPath);
    return candidates;
  }

  async queryAgainst(dbPath, sql, params = []) {
    return new Promise((resolve) => {
      let finalSql = sql;
      if (params.length > 0) {
        for (let i = 0; i < params.length; i++) {
          const param = params[i] == null ? '' : params[i].toString().replace(/'/g, "''");
          finalSql = finalSql.replace('?', `'${param}'`);
        }
      }

      const sqlite = spawn('sqlite3', [dbPath, finalSql, '-json']);
      let output = '';
      let error = '';

      sqlite.stdout.on('data', (data) => { output += data.toString(); });
      sqlite.stderr.on('data', (data) => { error += data.toString(); });

      sqlite.on('close', (code) => {
        if (code === 0) {
          try {
            const result = output.trim() ? JSON.parse(output.trim()) : [];
            resolve({ ok: true, result });
          } catch {
            resolve({ ok: true, result: [] });
          }
        } else {
          resolve({ ok: false, error });
        }
      });
    });
  }

  async query(sql, params = []) {
    const candidates = this.getCandidateDbPaths();
    for (const dbPath of candidates) {
      try {
        if (!fs.existsSync(dbPath)) continue;
      } catch { /* ignore */ }
      const { ok, result } = await this.queryAgainst(dbPath, sql, params);
      if (ok) return result;
    }
    return [];
  }

  async getAllValidators() {
    try {
      const sql = 'SELECT proposer_address, name, address, pubkey, voting_power, operator, status FROM validators WHERE status = "active_ongoing" ORDER BY name';
      const res = await this.query(sql, []);
      return res || [];
    } catch (error) {
      console.error('Error getting all validators:', error);
      return [];
    }
  }
}

// Configuration
const CONFIG = {
  BERACHEF_CONTRACT: '0xdf960E8F3F19C481dDE769edEDD439ea1a63426a',
  BGT_CONTRACT: '0x656b95E550C07a9ffe548bd4085c72418Ceb1dba',
  ACTIVATE_EVENT_SIG: 'ActivateRewardAllocation(bytes,uint64,(address,uint96)[])',
  BOOSTER_EVENT_SIG: 'BGTBoosterIncentivesProcessed(bytes,address,uint256,uint256)',
  AUTOMATED_CUTTING_BOARD_BLOCKS: 7 * 43200,
  KYBER_ROUTE_URL: 'https://gateway.mainnet.berachain.com/proxy/kyberswap/berachain/api/v1/routes',
  HONEY_TOKEN: '0xFCBD14DC51f0A4d49d5E53C2E0950e0bC26d0Dce',
  NETWORKS: {
    mainnet: {
      el: 'https://rpc.berachain.com/',
      cl: 'https://consensus.berachain.com/'
    },
    bepolia: {
      el: 'https://bepolia.rpc.berachain.com/',
      cl: 'https://bepolia.consensus.berachain.com/'
    }
  }
};

// Caches
const tokenDecimalsCache = new Map();
const tokenUsdRateCache = new Map();

// Helper: Get token decimals
async function getTokenDecimals(provider, token) {
  if (tokenDecimalsCache.has(token)) return tokenDecimalsCache.get(token);
  try {
    const iface = new ethers.Interface(['function decimals() view returns (uint8)']);
    const data = iface.encodeFunctionData('decimals', []);
    const res = await provider.call({ to: token, data });
    const [dec] = iface.decodeFunctionResult('decimals', res);
    tokenDecimalsCache.set(token, dec);
    return dec;
  } catch (e) {
    tokenDecimalsCache.set(token, 18);
    return 18;
  }
}

// Helper: Get USD rate per token
async function getUsdRatePerToken(tokenIn) {
  if (tokenUsdRateCache.has(tokenIn)) {
    return tokenUsdRateCache.get(tokenIn);
  }
  
  if (tokenIn.toLowerCase() === CONFIG.HONEY_TOKEN.toLowerCase()) {
    tokenUsdRateCache.set(tokenIn, 1.0);
    return 1.0;
  }
  
  const WBERA_ADDRESS = '0x6969696969696969696969696969696969696969';
  const actualTokenIn = (tokenIn.toLowerCase() === CONFIG.BGT_CONTRACT.toLowerCase()) ? WBERA_ADDRESS : tokenIn;
  
  const decimals = tokenDecimalsCache.get(tokenIn) ?? 18;
  const amountIn = 10n ** BigInt(decimals);
  const params = new URLSearchParams({
    tokenIn: actualTokenIn,
    tokenOut: CONFIG.HONEY_TOKEN.toLowerCase(),
    amountIn: amountIn.toString(),
    slippageTolerance: '0.005'
  });
  const url = `${CONFIG.KYBER_ROUTE_URL}?${params.toString()}`;
  
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const errorText = await resp.text();
      if (resp.status === 400 && errorText.includes('route not found')) {
        tokenUsdRateCache.set(tokenIn, 1.0);
        return 1.0;
      }
      throw new Error(`Kyber route fetch failed: ${resp.status} - ${errorText}`);
    }
    
    const data = await resp.json();
    const amountOutUsd = parseFloat(data?.data?.routeSummary?.amountOutUsd || 0);
    tokenUsdRateCache.set(tokenIn, amountOutUsd);
    return amountOutUsd;
  } catch (error) {
    console.warn(`⚠️  Could not get USD rate for token ${tokenIn}: ${error.message}`);
    tokenUsdRateCache.set(tokenIn, 1.0);
    return 1.0;
  }
}

// Load validators from database
async function loadValidators(validatorDbPath) {
  console.log('📥 Loading validators from database...');
  
  const validatorDB = new ValidatorNameDB(validatorDbPath);
  const dbValidators = await validatorDB.getAllValidators();
  
  if (!dbValidators || dbValidators.length === 0) {
    throw new Error('No validators found in database. Please ensure the validator database path is correct.');
  }
  
  console.log(`📊 Found ${dbValidators.length} validators in database`);
  
  const validators = dbValidators.map(v => ({
    name: v.name || 'Unknown',
    pubkey: v.pubkey || '',
    proposer: v.proposer_address || v.address || '',
    operator: v.operator || v.address || v.proposer_address || '',
    votingPower: v.voting_power ? parseFloat(v.voting_power) / 1e9 : 0
  })).filter(v => v.pubkey && v.proposer);
  
  if (validators.length === 0) {
    throw new Error('No validators with both pubkey and proposer address found in database.');
  }
  
  console.log(`✅ Loaded ${validators.length} validators`);
  return validators;
}

// Find day boundaries
async function findDayBoundaries(dates, clUrl) {
  console.log('🔍 Finding day boundary blocks...');
  
  const blockFetcher = new BlockFetcher(clUrl);
  const latestBlock = await blockFetcher.getCurrentBlock();
  
  const boundaries = {};
  const progress = createProgressBar(dates.length, 'Finding boundaries');
  
  let estimatedBlock = null;
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const midnight = new Date(date);
    midnight.setUTCHours(0, 0, 0, 0);
    const targetTimestamp = Math.floor(midnight.getTime() / 1000);
    
    const boundaryBlock = await blockFetcher.findBlockByTimestamp(targetTimestamp, latestBlock, estimatedBlock);
    if (boundaryBlock) {
      const dateStr = date.toISOString().split('T')[0];
      boundaries[dateStr] = boundaryBlock;
      estimatedBlock = boundaryBlock + 43200;
    } else {
      console.warn(`⚠️  Could not find boundary for ${date.toISOString().split('T')[0]}`);
    }
    
    progress.update(i + 1);
  }
  
  progress.finish();
  console.log(`✅ Found ${Object.keys(boundaries).length} boundaries`);
  return boundaries;
}

// Simple progress bar
function createProgressBar(total, description = '') {
  let current = 0;
  return {
    update(value) {
      current = value;
      const percent = Math.round((current / total) * 100);
      const bar = '█'.repeat(Math.floor(percent / 2)) + '░'.repeat(50 - Math.floor(percent / 2));
      process.stderr.write(`\r${description} [${bar}] ${percent}% (${current}/${total})`);
      if (current === total) process.stderr.write('\n');
    },
    finish() {
      if (current < total) this.update(total);
      process.stderr.write('\n');
    }
  };
}

// Scan BeraChef activations
async function scanBeraChefActivations(validators, dayRanges, rpcUrl) {
  console.log('🔍 Scanning BeraChef ActivateRewardAllocation events...');
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const activateTopic0 = ethers.id(CONFIG.ACTIVATE_EVENT_SIG);
  
  const pubkeyTopics = new Set();
  const topicToPubkey = new Map();
  
  for (const v of validators) {
    const pk = v.pubkey.startsWith('0x') ? v.pubkey : `0x${v.pubkey}`;
    const topic = ethers.keccak256(pk).toLowerCase();
    pubkeyTopics.add(topic);
    topicToPubkey.set(topic, pk.toLowerCase());
  }
  
  const allRanges = Object.values(dayRanges);
  const overallStartBlock = Math.min(...allRanges.map(r => r.startBlock));
  const overallEndBlock = Math.max(...allRanges.map(r => r.endBlock));
  
  const activationsByValidator = {};
  for (const v of validators) {
    const pk = v.pubkey.toLowerCase();
    activationsByValidator[pk] = [];
  }
  
  const chunkSize = 2000;
  let allLogs = [];
  
  for (let fromBlock = overallStartBlock; fromBlock <= overallEndBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, overallEndBlock);
    
    try {
      const logs = await provider.getLogs({
        address: CONFIG.BERACHEF_CONTRACT,
        topics: [activateTopic0],
        fromBlock: fromBlock,
        toBlock: toBlock
      });
      
      allLogs.push(...logs);
    } catch (error) {
      console.warn(`⚠️  Failed to get logs for blocks ${fromBlock}-${toBlock}: ${error.message}`);
    }
  }
  
  for (const log of allLogs) {
    const topicPub = (log.topics?.[1] || '').toLowerCase();
    if (!pubkeyTopics.has(topicPub)) continue;
    
    const pubkey = topicToPubkey.get(topicPub);
    if (!pubkey || !activationsByValidator[pubkey]) continue;
    
    const blockNumber = typeof log.blockNumber === 'number' ? log.blockNumber : parseInt(log.blockNumber.toString(), 10);
    activationsByValidator[pubkey].push(blockNumber);
  }
  
  for (const pubkey in activationsByValidator) {
    activationsByValidator[pubkey].sort((a, b) => a - b);
  }
  
  console.log(`✅ Found ${allLogs.length} activation events`);
  
  return activationsByValidator;
}

// Scan incentive distributions
async function scanIncentiveDistributions(validators, dayRanges, rpcUrl) {
  console.log('🔍 Scanning BGTBoosterIncentivesProcessed events...');
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const iface = new ethers.Interface([
    'event BGTBoosterIncentivesProcessed(bytes indexed pubkey, address indexed token, uint256 bgtEmitted, uint256 amount)'
  ]);
  const boosterTopic0 = ethers.id(CONFIG.BOOSTER_EVENT_SIG);
  
  const pubkeyTopics = new Set();
  const topicToPubkey = new Map();
  
  for (const v of validators) {
    const pk = v.pubkey.startsWith('0x') ? v.pubkey : `0x${v.pubkey}`;
    const topic = ethers.keccak256(pk).toLowerCase();
    pubkeyTopics.add(topic);
    topicToPubkey.set(topic, pk.toLowerCase());
  }
  
  const allRanges = Object.values(dayRanges);
  const overallStartBlock = Math.min(...allRanges.map(r => r.startBlock));
  const overallEndBlock = Math.max(...allRanges.map(r => r.endBlock));
  
  function getDateForBlock(blockNumber) {
    for (const [date, range] of Object.entries(dayRanges)) {
      if (blockNumber >= range.startBlock && blockNumber <= range.endBlock) {
        return date;
      }
    }
    return null;
  }
  
  const dailyDistributions = {};
  for (const date of Object.keys(dayRanges)) {
    dailyDistributions[date] = {};
  }
  
  const blockProposers = new Map();
  
  const chunkSize = 2000;
  let allLogs = [];
  
  for (let fromBlock = Math.max(1, overallStartBlock - 1); fromBlock <= overallEndBlock; fromBlock += chunkSize) {
    const toBlock = Math.min(fromBlock + chunkSize - 1, overallEndBlock);
    
    try {
      const logs = await provider.getLogs({
        topics: [boosterTopic0],
        fromBlock: fromBlock,
        toBlock: toBlock
      });
      
      allLogs.push(...logs);
    } catch (error) {
      console.warn(`⚠️  Failed to get logs for blocks ${fromBlock}-${toBlock}: ${error.message}`);
    }
  }
  
  for (const log of allLogs) {
    const topicPub = (log.topics?.[1] || '').toLowerCase();
    if (!pubkeyTopics.has(topicPub)) continue;
    
    const pubkey = topicToPubkey.get(topicPub);
    if (!pubkey) continue;
    
    const eventBlockNumber = typeof log.blockNumber === 'number' ? log.blockNumber : parseInt(log.blockNumber.toString(), 10);
    const proposedBlockNumber = eventBlockNumber - 1;
    
    if (proposedBlockNumber >= overallStartBlock && proposedBlockNumber <= overallEndBlock) {
      blockProposers.set(proposedBlockNumber, pubkey);
    }
    
    const date = getDateForBlock(eventBlockNumber);
    if (!date) continue;
    
    try {
      const parsed = iface.parseLog(log);
      const token = parsed.args.token.toLowerCase();
      const amount = BigInt(parsed.args.amount.toString());
      
      if (!dailyDistributions[date][pubkey]) {
        dailyDistributions[date][pubkey] = {};
      }
      
      if (!dailyDistributions[date][pubkey][token]) {
        dailyDistributions[date][pubkey][token] = 0n;
      }
      
      dailyDistributions[date][pubkey][token] += amount;
    } catch (error) {
      console.warn(`⚠️  Failed to parse log at block ${eventBlockNumber}: ${error.message}`);
    }
  }
  
  console.log(`✅ Processed ${allLogs.length} incentive distribution events`);
  console.log(`✅ Extracted block proposer info for ${blockProposers.size} blocks`);
  
  return { dailyDistributions, blockProposers };
}

// Determine automated cutting board blocks
async function determineACBBlocks(
  validator,
  date,
  dayRange,
  activationsByValidator,
  blockProposers
) {
  const pubkey = validator.pubkey.toLowerCase();
  const activationBlocks = activationsByValidator[pubkey] || [];
  
  const validatorBlocks = [];
  for (let blockNum = dayRange.startBlock; blockNum <= dayRange.endBlock; blockNum++) {
    const blockPubkey = blockProposers.get(blockNum);
    if (blockPubkey && blockPubkey.toLowerCase() === pubkey.toLowerCase()) {
      validatorBlocks.push(blockNum);
    }
  }
  
  if (validatorBlocks.length === 0) {
    return {
      totalBlocks: 0,
      acbBlocks: 0,
      percentage: 0
    };
  }
  
  const acbBlocks = [];
  
  for (const blockNum of validatorBlocks) {
    const lastActivationBeforeBlock = activationBlocks.filter(b => b <= blockNum).pop();
    
    if (!lastActivationBeforeBlock) {
      acbBlocks.push(blockNum);
    } else {
      const blocksSinceActivation = blockNum - lastActivationBeforeBlock;
      if (blocksSinceActivation >= CONFIG.AUTOMATED_CUTTING_BOARD_BLOCKS) {
        acbBlocks.push(blockNum);
      }
    }
  }
  
  const percentage = validatorBlocks.length > 0 ? (acbBlocks.length / validatorBlocks.length) * 100 : 0;
  
  return {
    totalBlocks: validatorBlocks.length,
    acbBlocks: acbBlocks.length,
    percentage: percentage
  };
}

// Compute USD valuations
async function computeUsdValuations(dailyDistributions, dayRanges, rpcUrl) {
  console.log('💰 Computing USD valuations...');
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  const tokenSet = new Set();
  for (const date of Object.keys(dayRanges)) {
    const dayData = dailyDistributions[date] || {};
    for (const pubkey in dayData) {
      const tokens = dayData[pubkey] || {};
      Object.keys(tokens).forEach(t => tokenSet.add(t));
    }
  }
  
  const tokenList = Array.from(tokenSet);
  console.log(`📊 Fetching metadata for ${tokenList.length} unique tokens...`);
  
  for (const token of tokenList) {
    await getTokenDecimals(provider, token);
  }
  
  for (const token of tokenList) {
    await getUsdRatePerToken(token);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  const dailyUsd = {};
  
  for (const date of Object.keys(dayRanges)) {
    dailyUsd[date] = {};
    const dayData = dailyDistributions[date] || {};
    
    for (const pubkey in dayData) {
      const tokens = dayData[pubkey] || {};
      let totalUsd = 0;
      
      for (const [token, amountBI] of Object.entries(tokens)) {
        const decimals = tokenDecimalsCache.get(token) ?? 18;
        const rate = tokenUsdRateCache.get(token) ?? 0;
        const rateBI = BigInt(Math.floor(rate * 1e18));
        const tokenUSDWei = (amountBI * rateBI) / (10n ** BigInt(decimals));
        totalUsd += parseFloat(tokenUSDWei.toString()) / 1e18;
      }
      
      dailyUsd[date][pubkey] = totalUsd;
    }
  }
  
  console.log('✅ USD valuations computed');
  
  return dailyUsd;
}

// Generate CSV output
function generateCSV(results, dates, outputFile) {
  console.log(`📝 Generating CSV output to ${outputFile}...`);
  
  const validatorMap = new Map();
  for (const result of results) {
    const key = result.pubkey;
    if (!validatorMap.has(key)) {
      validatorMap.set(key, {
        name: result.name,
        pubkey: result.pubkey,
        proposer: result.proposer,
        finalStake: result.finalStake,
        dailyData: {}
      });
    }
    validatorMap.get(key).dailyData[result.date] = {
      acbPercentage: result.acbPercentage,
      usdValue: result.usdValue
    };
  }
  
  const sortedDates = dates.sort();
  const headers = ['Validator Name', 'Validator Pubkey', 'Proposer Address'];
  for (const date of sortedDates) {
    headers.push(`${date} ACB %`, `${date} USD`);
  }
  headers.push('Final Stake');
  
  const rows = [headers.join(',')];
  
  for (const validator of validatorMap.values()) {
    const escapedName = validator.name.includes(',') || validator.name.includes('"') 
      ? `"${validator.name.replace(/"/g, '""')}"` 
      : validator.name;
    
    const row = [escapedName, validator.pubkey, validator.proposer];
    
    for (const date of sortedDates) {
      const dayData = validator.dailyData[date] || { acbPercentage: 0, usdValue: 0 };
      row.push(dayData.acbPercentage.toFixed(2));
      row.push(dayData.usdValue.toFixed(6));
    }
    
    row.push(validator.finalStake.toFixed(6));
    rows.push(row.join(','));
  }
  
  fs.writeFileSync(outputFile, rows.join('\n'));
  console.log(`✅ CSV written to ${outputFile}`);
}

// Parse command line arguments
function parseArgs() {
  const argv = yargs(hideBin(process.argv))
    .option('start-date', {
      alias: 's',
      type: 'string',
      description: 'Start date for analysis (YYYY-MM-DD format, defaults to 2025-12-16 or calculated from end-date - days)'
    })
    .option('end-date', {
      alias: 'e',
      type: 'string',
      description: 'End date for analysis (YYYY-MM-DD format, defaults to end of yesterday)'
    })
    .option('days', {
      alias: 'd',
      type: 'number',
      description: 'Number of days to analyze (used with start-date or end-date)'
    })
    .option('chain', {
      alias: 'c',
      type: 'string',
      default: 'mainnet',
      choices: ['mainnet', 'bepolia'],
      description: 'Chain to analyze'
    })
    .option('rpc', {
      alias: 'r',
      type: 'string',
      description: 'Custom execution layer RPC endpoint URL'
    })
    .option('cl-rpc', {
      type: 'string',
      description: 'Custom consensus layer RPC endpoint URL'
    })
    .option('validator-db', {
      alias: 'v',
      type: 'string',
      description: 'Path to validator database (SQLite file)'
    })
    .option('help', {
      alias: 'h',
      type: 'boolean',
      description: 'Show help'
    })
    .strict()
    .help()
    .argv;
  
  let startDate;
  let endDate;
  
  if (argv['end-date'] && argv.days && !argv['start-date']) {
    endDate = new Date(argv['end-date'] + 'T23:59:59.999Z');
    startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - (argv.days - 1));
    startDate.setUTCHours(0, 0, 0, 0);
  } else {
    if (argv['start-date']) {
      startDate = new Date(argv['start-date'] + 'T00:00:00.000Z');
    } else {
      startDate = new Date('2025-12-16T00:00:00.000Z');
    }
    
    if (argv['end-date']) {
      endDate = new Date(argv['end-date'] + 'T23:59:59.999Z');
    } else if (argv.days) {
      endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + argv.days - 1);
      endDate.setUTCHours(23, 59, 59, 999);
    } else {
      endDate = new Date();
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      endDate.setUTCHours(23, 59, 59, 999);
    }
  }
  
  if (startDate > endDate) {
    throw new Error(`Start date (${startDate.toISOString().split('T')[0]}) must be before or equal to end date (${endDate.toISOString().split('T')[0]})`);
  }
  
  const chain = argv.chain;
  const network = CONFIG.NETWORKS[chain];
  
  let rpcUrl = argv.rpc || network.el;
  let clUrl = argv['cl-rpc'] || network.cl;
  
  // Determine validator database path
  let validatorDbPath = argv['validator-db'];
  if (!validatorDbPath) {
    // Default to validator.sqlite in the same directory as the script
    validatorDbPath = path.join(__dirname, 'validator.sqlite');
  }
  
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate,
    chain: chain,
    rpc: rpcUrl,
    cl: clUrl,
    validatorDb: validatorDbPath,
    help: argv.help
  };
}

// Main function
async function main() {
  const config = parseArgs();
  
  if (config.help) {
    console.log(`
Cutting Board Usage Analysis Script

Usage:
  node scan-cutting-board-usage.js [options]

Options:
  -s, --start-date=DATE      Start date for analysis (YYYY-MM-DD, default: 2025-12-16)
  -e, --end-date=DATE         End date for analysis (YYYY-MM-DD, defaults to end of yesterday)
  -d, --days=N                Number of days to analyze from start date
  -c, --chain=NAME            Chain to analyze: mainnet|bepolia (default: mainnet)
  -r, --rpc=URL               Custom execution layer RPC endpoint URL
  --cl-rpc=URL                Custom consensus layer RPC endpoint URL
  -v, --validator-db=PATH     Path to validator database (SQLite file, default: ./validator.sqlite)
  -h, --help                  Show this help message

Examples:
  node scan-cutting-board-usage.js
  node scan-cutting-board-usage.js --start-date=2025-12-18 --days=7
  node scan-cutting-board-usage.js --start-date=2025-12-26 --end-date=2025-12-31
  node scan-cutting-board-usage.js --validator-db=/path/to/validators.db
`);
    process.exit(0);
  }
  
  try {
    console.log('🚀 Starting Cutting Board Analysis...\n');
    console.log(`📅 Analysis period: ${config.startDate} to ${config.endDate.toISOString().split('T')[0]}`);
    console.log(`⛓️  Chain: ${config.chain}`);
    console.log(`📁 Validator DB: ${config.validatorDb}\n`);
    
    // Generate date range for analysis
    const startDate = new Date(config.startDate + 'T00:00:00.000Z');
    const dates = [];
    const currentDate = new Date(startDate);
    while (currentDate <= config.endDate) {
      dates.push(new Date(currentDate));
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    const nextDay = new Date(dates[dates.length - 1]);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    dates.push(nextDay);
    
    // Generate extended date range for activation scanning
    const activationStartDate = new Date(startDate);
    activationStartDate.setUTCDate(activationStartDate.getUTCDate() - 7);
    const activationDates = [];
    const activationCurrentDate = new Date(activationStartDate);
    while (activationCurrentDate <= config.endDate) {
      activationDates.push(new Date(activationCurrentDate));
      activationCurrentDate.setUTCDate(activationCurrentDate.getUTCDate() + 1);
    }
    activationDates.push(nextDay);
    
    // Load validators
    const validators = await loadValidators(config.validatorDb);
    
    if (validators.length === 0) {
      throw new Error('No validators loaded');
    }
    
    // Find day boundaries once for extended period
    const allBoundaries = await findDayBoundaries(activationDates, config.cl);
    
    // Extract boundaries for analysis period
    const dayBoundaries = {};
    for (const date of dates) {
      const dateStr = date.toISOString().split('T')[0];
      if (allBoundaries[dateStr]) {
        dayBoundaries[dateStr] = allBoundaries[dateStr];
      }
    }
    
    // Calculate day ranges
    const sortedDates = Object.keys(dayBoundaries).sort();
    const dayRanges = {};
    
    for (let i = 0; i < sortedDates.length - 1; i++) {
      const currentDate = sortedDates[i];
      const nextDate = sortedDates[i + 1];
      dayRanges[currentDate] = {
        startBlock: dayBoundaries[currentDate],
        endBlock: dayBoundaries[nextDate] - 1
      };
    }
    
    delete dayRanges[sortedDates[sortedDates.length - 1]];
    
    // Calculate activation scanning day ranges
    const sortedActivationDates = Object.keys(allBoundaries).sort();
    const activationDayRanges = {};
    
    for (let i = 0; i < sortedActivationDates.length - 1; i++) {
      const currentDate = sortedActivationDates[i];
      const nextDate = sortedActivationDates[i + 1];
      activationDayRanges[currentDate] = {
        startBlock: allBoundaries[currentDate],
        endBlock: allBoundaries[nextDate] - 1
      };
    }
    
    // Scan BeraChef activations
    const activationsByValidator = await scanBeraChefActivations(validators, activationDayRanges, config.rpc);
    
    // Scan incentive distributions
    const { dailyDistributions, blockProposers } = await scanIncentiveDistributions(validators, dayRanges, config.rpc);
    
    // Compute USD valuations
    const dailyUsd = await computeUsdValuations(dailyDistributions, dayRanges, config.rpc);
    
    // Get final stake for all validators
    console.log('📊 Fetching final stake amounts...');
    const validatorFetcher = new ValidatorFetcher(config.cl);
    const finalBlock = Math.max(...Object.values(dayRanges).map(r => r.endBlock));
    const finalStakes = await validatorFetcher.getValidators(finalBlock);
    
    // Build results
    console.log('📊 Analyzing cutting board usage...');
    const results = [];
    const totalDays = Object.keys(dayRanges).length;
    let processedDays = 0;
    
    for (const validator of validators) {
      for (const date of Object.keys(dayRanges).sort()) {
        const dayRange = dayRanges[date];
        const pubkey = validator.pubkey.toLowerCase();
        
        const cuttingBoardData = await determineACBBlocks(
          validator,
          date,
          dayRange,
          activationsByValidator,
          blockProposers
        );
        
        const usdValue = dailyUsd[date]?.[pubkey] || 0;
        
        const finalStake = finalStakes?.[validator.proposer]?.voting_power || validator.votingPower || 0;
        
        results.push({
          name: validator.name,
          pubkey: validator.pubkey,
          proposer: validator.proposer,
          date: date,
          acbPercentage: cuttingBoardData.percentage,
          usdValue: usdValue,
          finalStake: finalStake
        });
        
        processedDays++;
        if (processedDays % 10 === 0) {
          process.stderr.write(`\rProgress: ${processedDays}/${totalDays * validators.length} validator-days analyzed`);
        }
      }
    }
    
    process.stderr.write('\n');
    
    // Generate CSV
    const analysisDates = Object.keys(dayRanges).sort();
    generateCSV(results, analysisDates, 'cutting-board-analysis.csv');
    
    console.log('\n✅ Analysis complete!');
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };

