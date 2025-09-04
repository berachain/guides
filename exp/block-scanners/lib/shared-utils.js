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
const config = require('../../config');
const { ConfigHelper } = require('../../config');

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
  BlockFetcher,
  StatUtils,
  ProgressReporter,
  ConfigHelper,
  config
};
