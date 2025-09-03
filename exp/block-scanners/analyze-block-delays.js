#!/usr/bin/env node

/**
 * Berachain Block Delay Analysis Script
 * 
 * This script analyzes how each validator's block proposals affect the timing
 * and participation in subsequent blocks. It measures delays and signature counts
 * in blocks that follow each proposer's blocks. No more table-eliding around here!
 * 
 * Key Features:
 * - Efficient single-pass block fetching (no re-querying)
 * - Millisecond-accurate timing analysis between consecutive blocks
 * - Signature count analysis for blocks following each proposer
 * - Statistical analysis: min, max, average, median for both timing and signatures
 * - Validator name lookup via database
 * 
 * Usage: node analyze-proposer-impact.js
 * 
 * Configuration:
 * - BLOCK_COUNT: Number of blocks to analyze (default: 1000)
 * - BASE_URL: Berachain node endpoint
 */

const axios = require('axios');
const { spawn } = require('child_process');
const Table = require('cli-table3');

const BASE_URL = 'http://37.27.231.195:59820';
const BLOCK_COUNT = 1000; // Analyze 1,000 blocks

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

async function getCurrentBlock() {
    try {
        const response = await axios.get(`${BASE_URL}/status`);
        return response.data.result.sync_info.latest_block_height;
    } catch (error) {
        console.error('Error fetching current block height:', error.message);
        return null;
    }
}

async function getBlock(blockHeight) {
    try {
        const response = await axios.get(`${BASE_URL}/block?height=${blockHeight}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching block ${blockHeight}:`, error.message);
        return null;
    }
}

function calculateStats(values) {
    if (values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    return {
        count: values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / values.length,
        median: sorted.length % 2 === 0 
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)]
    };
}

async function analyzeBlockDelays() {
    // Initialize validator name database
    const validatorDbPath = '../cometbft-decoder/validators_correlated.db';
    const validatorDB = new ValidatorNameDB(validatorDbPath);
    
    console.log('🔍 Fetching current block height...');
    const currentBlock = await getCurrentBlock();
    if (!currentBlock) {
        console.error('❌ Failed to get current block height');
        process.exit(1);
    }
    
    const startBlock = parseInt(currentBlock);
    const endBlock = startBlock - BLOCK_COUNT + 1;
    
    console.log(`📊 Current block: ${startBlock}`);
    console.log(`📊 Analyzing ${BLOCK_COUNT.toLocaleString()} blocks backwards from ${startBlock} to ${endBlock}`);
    console.log('=' .repeat(80));
    
    // Storage for all block data (to avoid re-querying)
    const blocks = [];
    
    // Fetch all blocks in one pass
    for (let i = 0; i < BLOCK_COUNT; i++) {
        const blockHeight = startBlock - i;
        process.stdout.write(`\rFetching block ${blockHeight.toLocaleString()}... (${(i + 1).toLocaleString()}/${BLOCK_COUNT.toLocaleString()})`);
        
        const blockData = await getBlock(blockHeight);
        if (!blockData || !blockData.result || !blockData.result.block) {
            console.error(`\nFailed to get block ${blockHeight}`);
            continue;
        }
        
        const block = blockData.result.block;
        const signatures = block.last_commit?.signatures || [];
        const proposer = block.header?.proposer_address;
        const timestamp = block.header?.time;
        
        blocks.push({
            height: blockHeight,
            proposer: proposer || 'unknown',
            timestamp: timestamp,
            signatureCount: signatures.length,
            timestampMs: timestamp ? new Date(timestamp).getTime() : null
        });
        
        // Small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    
    console.log('\n\n📊 Analyzing proposer impact on subsequent blocks...');
    
    // Map to store impact data for each proposer
    const proposerImpacts = new Map();
    
    // Analyze consecutive block pairs
    // Note: blocks are in reverse chronological order, so block[i+1] comes before block[i] chronologically
    for (let i = 0; i < blocks.length - 1; i++) {
        const nextBlock = blocks[i];      // This block comes after chronologically  
        const currentBlock = blocks[i + 1]; // This block comes before chronologically
        
        if (currentBlock.proposer === 'unknown' || !currentBlock.timestampMs || !nextBlock.timestampMs) {
            continue;
        }
        
        // Calculate delay between current block and next block
        const delayMs = nextBlock.timestampMs - currentBlock.timestampMs;
        
        // Initialize proposer stats if not exists
        if (!proposerImpacts.has(currentBlock.proposer)) {
            proposerImpacts.set(currentBlock.proposer, {
                nextBlockDelays: [],
                nextBlockSignatures: []
            });
        }
        
        const stats = proposerImpacts.get(currentBlock.proposer);
        stats.nextBlockDelays.push(delayMs);
        stats.nextBlockSignatures.push(nextBlock.signatureCount);
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('🎯 PROPOSER IMPACT ANALYSIS COMPLETE');
    console.log('=' .repeat(80));
    
    // Calculate statistics for each proposer
    const proposerAnalysis = [];
    for (const [proposer, data] of proposerImpacts.entries()) {
        const delayStats = calculateStats(data.nextBlockDelays);
        const signatureStats = calculateStats(data.nextBlockSignatures);
        
        if (delayStats && signatureStats && delayStats.count >= 3) { // Minimum 3 samples for meaningful stats
            proposerAnalysis.push({
                proposer,
                sampleCount: delayStats.count,
                delayStats,
                signatureStats
            });
        }
    }
    
    // Sort by average delay (descending)
    proposerAnalysis.sort((a, b) => b.delayStats.avg - a.delayStats.avg);
    
    // Display results
    console.log(`\n📈 BLOCK DELAY ANALYSIS - Impact on Subsequent Blocks:`);
    console.log(`Found ${proposerAnalysis.length} proposers with sufficient data (3+ blocks)\n`);
    
    // Create combined table with both timing and signature analysis
    const analysisTable = new Table({
        head: ['Validator Name', 'Proposer Address', 'Samples', 'Avg Delay (ms)', 'Med Delay (ms)', 'Min/Max Delay', 'Avg Sigs', 'Sig Range'],
        colWidths: [25, 45, 10, 15, 15, 15, 12, 12]
    });
    
    for (const analysis of proposerAnalysis) {
        // Get proposer name from database - show full name without eliding
        const proposerName = await validatorDB.getValidatorName(analysis.proposer);
        const validatorDisplay = proposerName || 'Unknown Validator';
        
        const delayRange = `${analysis.delayStats.min}-${analysis.delayStats.max}`;
        const sigRange = `${analysis.signatureStats.min}-${analysis.signatureStats.max}`;
        
        analysisTable.push([
            validatorDisplay,
            analysis.proposer,
            analysis.sampleCount.toString(),
            Math.round(analysis.delayStats.avg).toString(),
            Math.round(analysis.delayStats.median).toString(),
            delayRange,
            analysis.signatureStats.avg.toFixed(1),
            sigRange
        ]);
    }
    
    console.log(analysisTable.toString());
    
    // Overall statistics
    const allDelays = [];
    const allSignatures = [];
    for (const [_, data] of proposerImpacts.entries()) {
        allDelays.push(...data.nextBlockDelays);
        allSignatures.push(...data.nextBlockSignatures);
    }
    
    const overallDelayStats = calculateStats(allDelays);
    const overallSignatureStats = calculateStats(allSignatures);
    
    console.log(`\n📊 OVERALL STATISTICS:`);
    console.log(`Total block pairs analyzed: ${allDelays.length.toLocaleString()}`);
    console.log(`Total proposers with data: ${proposerImpacts.size.toLocaleString()}`);
    console.log(`\nBlock Timing:`);
    console.log(`  Average delay: ${Math.round(overallDelayStats.avg).toLocaleString()} ms (${(overallDelayStats.avg / 1000).toFixed(2)} seconds)`);
    console.log(`  Median delay: ${overallDelayStats.median.toLocaleString()} ms`);
    console.log(`  Range: ${overallDelayStats.min.toLocaleString()} - ${overallDelayStats.max.toLocaleString()} ms`);
    console.log(`\nSignature Counts:`);
    console.log(`  Average signatures: ${overallSignatureStats.avg.toFixed(1)}`);
    console.log(`  Median signatures: ${overallSignatureStats.median}`);
    console.log(`  Range: ${overallSignatureStats.min} - ${overallSignatureStats.max} signatures`);
    
    console.log(`\n✅ Block delay analysis completed successfully!`);
    
    // Return data for potential further analysis
    return {
        proposerAnalysis,
        overallStats: {
            delays: overallDelayStats,
            signatures: overallSignatureStats
        },
        totalPairs: allDelays.length,
        totalProposers: proposerImpacts.size
    };
}

// Run the analysis
if (require.main === module) {
    analyzeBlockDelays()
        .then(results => {
            process.exit(0);
        })
        .catch(error => {
            console.error(`\n❌ Script failed:`, error);
            process.exit(1);
        });
}

module.exports = { analyzeBlockDelays };
