/**
 * Shared utilities for Berachain block scanner experiments
 * 
 * This module provides common functionality used across multiple block scanner scripts:
 * - Validator name database lookups
 * - Block fetching from RPC endpoints
 * - Statistical calculations
 * - Progress reporting utilities
 */

const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const config = require('../../config');
const { ConfigHelper } = require('../../config');

// Common defaults and helpers shared across scanners
const DEFAULT_LOG_CHUNK_SIZE = parseInt(process.env.DEFAULT_LOG_CHUNK_SIZE || '50000', 10);

function hashEvent(signature) {
  return ethers.id(signature);
}

function decodeEventData(types, dataHex) {
  return ethers.AbiCoder.defaultAbiCoder().decode(types, dataHex);
}

async function withRetry(operation, maxRetries = 5, initialDelayMs = 500) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await operation();
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) throw err;
      const jitter = Math.floor(Math.random() * initialDelayMs);
      const delay = initialDelayMs * Math.pow(2, attempt - 1) + jitter;
      // Use a local promise-based delay to avoid introducing global sleep usage across scripts
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Simple SQLite wrapper to look up validator names from the validator database
 */
class ValidatorNameDB {
  constructor(dbPath = config.VALIDATOR_DB_PATH) {
    this.explicitDbPath = dbPath;
  }

  getCandidateDbPaths() {
    const candidates = [];
    // 1) Explicit path from config/env
    if (this.explicitDbPath) candidates.push(this.explicitDbPath);
    // 2) Common relative paths from this lib directory: exp/block-scanners/lib → exp/cometbft-decoder/*.db
    const base = path.resolve(__dirname, '..', '..', 'cometbft-decoder');
    candidates.push(path.join(base, 'validators_correlated.db'));
    candidates.push(path.join(base, 'validators.db'));
    // De-duplicate
    return Array.from(new Set(candidates));
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

  async getValidatorName(address) {
    try {
      const attempts = [];
      const addr = address || '';
      const with0x = addr.startsWith('0x') ? addr : `0x${addr}`;
      const without0x = addr.startsWith('0x') ? addr.slice(2) : addr;
      // Try common table/column combos
      const queries = [
        ['SELECT name FROM validators WHERE proposer_address = ?', addr],
        ['SELECT name FROM validators WHERE proposer_address = ?', with0x],
        ['SELECT name FROM validators WHERE proposer_address = ?', without0x],
        ['SELECT name FROM validators WHERE address = ?', addr],
        ['SELECT name FROM validators WHERE address = ?', with0x],
        ['SELECT name FROM validators WHERE address = ?', without0x],
        // Some DBs store mapping in a names table
        ['SELECT name FROM names WHERE address = ?', addr],
        ['SELECT name FROM names WHERE address = ?', with0x],
        ['SELECT name FROM names WHERE address = ?', without0x],
      ];
      for (const [sql, param] of queries) {
        const res = await this.query(sql, [param]);
        if (res && res.length > 0) {
          const n = res[0].name || res[0].Name || res[0].validator_name;
          if (n && n !== 'N/A') return n;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}

/**
 * Validator fetching utilities
 */
class ValidatorFetcher {
  constructor(clUrl) {
    this.clUrl = clUrl;
  }

  /**
   * Gets all validators at a specific block height with pagination support
   * @param {number} blockHeight - Block height to query
   * @param {number} perPage - Validators per page (default: 99999 to get all in one request)
   * @returns {Promise<Object|null>} Object with validator data or null on error
   */
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
          break; // No more validators to fetch
        }
        
        // Process each validator in this page
        response.data.result.validators.forEach(validator => {
          validators[validator.address] = {
            address: validator.address,
            voting_power: validator.voting_power / 1e9, // Convert GWEI to BERA
            pub_key: validator.pub_key.value
          };
        });
        
        // Check if we've reached the end of results or got all validators in one page
        if (response.data.result.validators.length < perPage) {
          break; // Last page
        }
        
        page++; // Continue to next page
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

/**
 * Block fetching utilities
 */
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

  async getBlock(blockHeight) {
    try {
      const response = await axios.get(`${this.baseUrl}/block?height=${blockHeight}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching block ${blockHeight}:`, error.message);
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

  /**
   * Binary search to find the first block with timestamp >= targetTimestamp
   * Precondition: timestamp(lowHeight) < targetTimestamp <= timestamp(highHeight)
   */
  async binarySearchBoundary(lowHeight, highHeight, targetTimestamp) {
    while (lowHeight + 1 < highHeight) {
      const mid = Math.floor((lowHeight + highHeight) / 2);
      const midTs = await this.getBlockTimestamp(mid);
      if (midTs === null) {
        break; // give up binary search if RPC fails
      }
      if (midTs >= targetTimestamp) {
        highHeight = mid;
      } else {
        lowHeight = mid;
      }
    }
    return highHeight;
  }

  /**
   * Find the block number closest to (at or after) a target timestamp using binary search
   * @param {number} targetTimestamp - Unix timestamp in seconds
   * @param {number} latestBlock - Latest known block number
   * @param {number} estimatedBlock - Optional initial estimate (will calculate if not provided)
   * @returns {Promise<number|null>} Block number or null if not found
   */
  async findBlockByTimestamp(targetTimestamp, latestBlock, estimatedBlock = null) {
    // Use provided estimate or calculate one based on known reference point
    const START_BLOCK = 933558;
    const START_TIMESTAMP = 1739205914; // 2025-02-10 16:45:14 UTC
    const BLOCK_TIME = 2; // 2 seconds per block (rough estimate for initial bracketing only)
    
    let estimate = estimatedBlock;
    if (!estimate) {
      const estimatedBlocks = Math.floor((targetTimestamp - START_TIMESTAMP) / BLOCK_TIME);
      estimate = Math.min(Math.max(START_BLOCK + estimatedBlocks, 2), latestBlock);
    }

    const estimateTs = await this.getBlockTimestamp(estimate);
    if (estimateTs === null) return null;

    let step = 1024;
    // Expand upward if estimate before target
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
      if (highTs < targetTimestamp) {
        return null; // Could not bracket target
      }
      return await this.binarySearchBoundary(lowH, highH, targetTimestamp);
    }

    // Expand downward if estimate on/after target
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
    if (lowTs >= targetTimestamp) {
      return null; // Could not bracket target
    }
    return await this.binarySearchBoundary(lowH, highH, targetTimestamp);
  }

  async fetchBlockRange(startBlock, blockCount, progressCallback = null) {
    const blocks = [];
    
    for (let i = 0; i < blockCount; i++) {
      const blockHeight = startBlock - i;
      
      if (progressCallback) {
        progressCallback(i + 1, blockCount, blockHeight);
      }
      
      const blockData = await this.getBlock(blockHeight);
      if (!blockData || !blockData.result || !blockData.result.block) {
        console.error(`Failed to get block ${blockHeight}`);
        continue;
      }
      
      const block = blockData.result.block;
      const signatures = block.last_commit?.signatures || [];
      const proposer = block.header?.proposer_address;
      const timestamp = block.header?.time;
      
      // Count signatures with valid block_id_flag (actual participation)
      // Based on Berachain's CometBFT implementation:
      // Flag 1: Valid vote, Flag 4: Valid vote, Flag 5: Absent/no vote, Flag 6: Valid vote
      const actualSignatureCount = signatures.filter(sig => sig && sig.block_id_flag !== 5).length;
      
      blocks.push({
        height: blockHeight,
        proposer: proposer || 'unknown',
        timestamp: timestamp,
        signatureCount: actualSignatureCount,
        totalValidators: signatures.length, // Total validator set size
        timestampMs: timestamp ? new Date(timestamp).getTime() : null,
        raw: block
      });
      
      // Rate limiting
      if (this.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
    }
    
    return blocks;
  }
}

/**
 * Statistical calculation utilities
 */
class StatUtils {
  static calculateStats(values) {
    if (values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    let varSum = 0;
    for (const v of values) {
      const d = v - avg;
      varSum += d * d;
    }
    const variance = varSum / values.length; // population variance
    const stddev = Math.sqrt(variance);
    
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg,
      stddev,
      median: sorted.length % 2 === 0 
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)]
    };
  }

  static formatNumber(num, decimals = 0) {
    if (decimals === 0) {
      return Math.round(num).toLocaleString();
    }
    return num.toFixed(decimals);
  }

  static formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

/**
 * Progress reporting utilities
 */
class ProgressReporter {
  static showProgress(current, total, blockHeight = null) {
    const percent = ((current / total) * 100).toFixed(1);
    const blockInfo = blockHeight ? ` (block ${blockHeight.toLocaleString()})` : '';
    process.stdout.write(`\rProgress: ${current.toLocaleString()}/${total.toLocaleString()} (${percent}%)${blockInfo}`);
  }

  static clearProgress() {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  static logStep(step, details = '') {
    console.log(`🔄 ${step}${details ? ': ' + details : ''}...`);
  }

  static logSuccess(message) {
    console.log(`✅ ${message}`);
  }

  static logError(message) {
    console.error(`❌ ${message}`);
  }
}

// ConfigHelper is re-exported from config.js

module.exports = {
  ValidatorNameDB,
  ValidatorFetcher,
  BlockFetcher,
  StatUtils,
  ProgressReporter,
  ConfigHelper,
  config
};
