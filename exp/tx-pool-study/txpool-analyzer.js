#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const { createReadStream } = require('fs');

const EL_ETHRPC_URL = 'http://37.27.231.195:59810';

// Help text
function showHelp() {
  console.log(`
Transaction Pool Analyzer

Analyzes transaction pool data to determine which addresses have successfully
transacted since the pool snapshot was taken.

USAGE:
  node txpool-analyzer.js [OPTIONS] [FILE]

ARGUMENTS:
  FILE                    Path to txpool JSON file (if not provided, reads from stdin)

OPTIONS:
  -h, --help             Show this help message
  -r, --rpc-url URL      RPC URL for nonce queries (default: ${EL_ETHRPC_URL})
  -b, --batch-size N     Number of concurrent RPC calls (default: 20)

EXAMPLES:
  # Analyze from file
  node txpool-analyzer.js merged_txpool.txt

  # Analyze from stdin
  cat txpool_data.json | node txpool-analyzer.js

  # Use custom RPC URL
  node txpool-analyzer.js --rpc-url http://localhost:8545 txpool.txt

  # Use smaller batch size for slower RPC
  node txpool-analyzer.js --batch-size 5 txpool.txt

DESCRIPTION:
  This tool compares the current nonce of addresses in a transaction pool
  snapshot with their actual current nonces from the blockchain. This helps
  determine which transactions have been executed and which are still pending.

  The tool expects JSON input in the format returned by eth_txPoolContent:
  {
    "result": {
      "pending": {
        "0x...": {
          "0x0": { ... },
          "0x1": { ... }
        }
      }
    }
  }
`);
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    rpcUrl: EL_ETHRPC_URL,
    batchSize: 20,
    inputFile: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-h' || arg === '--help') {
      showHelp();
      process.exit(0);
    } else if (arg === '-r' || arg === '--rpc-url') {
      if (i + 1 < args.length) {
        options.rpcUrl = args[++i];
      } else {
        console.error('Error: --rpc-url requires a URL argument');
        process.exit(1);
      }
    } else if (arg === '-b' || arg === '--batch-size') {
      if (i + 1 < args.length) {
        const batchSize = parseInt(args[++i], 10);
        if (isNaN(batchSize) || batchSize < 1) {
          console.error('Error: --batch-size must be a positive integer');
          process.exit(1);
        }
        options.batchSize = batchSize;
      } else {
        console.error('Error: --batch-size requires a number argument');
        process.exit(1);
      }
    } else if (!arg.startsWith('-')) {
      // This is the input file
      if (options.inputFile) {
        console.error('Error: Multiple input files specified');
        process.exit(1);
      }
      options.inputFile = arg;
    } else {
      console.error(`Error: Unknown option ${arg}`);
      console.error('Use --help for usage information');
      process.exit(1);
    }
  }

  return options;
}

// Read input data from file or stdin
async function readInputData(inputFile) {
  return new Promise((resolve, reject) => {
    let inputStream;
    
    if (inputFile) {
      // Read from file
      if (!fs.existsSync(inputFile)) {
        reject(new Error(`File not found: ${inputFile}`));
        return;
      }
      inputStream = createReadStream(inputFile);
    } else {
      // Read from stdin
      inputStream = process.stdin;
    }

    let data = '';
    inputStream.on('data', chunk => {
      data += chunk;
    });
    
    inputStream.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Failed to parse JSON: ${error.message}`));
      }
    });
    
    inputStream.on('error', error => {
      reject(new Error(`Input error: ${error.message}`));
    });
  });
}

// Function to make RPC call
function makeRpcCall(address, rpcUrl) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getTransactionCount",
      params: [address, "latest"],
      id: 1
    });

    const url = new URL(rpcUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.result) {
            resolve({
              address,
              nonce: parseInt(response.result, 16)
            });
          } else {
            reject(new Error(`RPC error for ${address}: ${response.error?.message || 'Unknown error'}`));
          }
        } catch (e) {
          reject(new Error(`Parse error for ${address}: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Request error for ${address}: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout for ${address}`));
    });

    req.write(postData);
    req.end();
  });
}

// Process addresses in batches
async function checkAllNonces(addresses, rpcUrl, batchSize) {
  const results = [];
  
  console.log(`Checking nonces for ${addresses.length} addresses in batches of ${batchSize}...\n`);
  
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const batchNum = Math.floor(i/batchSize) + 1;
    const totalBatches = Math.ceil(addresses.length/batchSize);
    
    process.stdout.write(`Processing batch ${batchNum}/${totalBatches} (${batch.length} addresses)... `);
    
    const batchPromises = batch.map(addr => 
      makeRpcCall(addr, rpcUrl).catch(err => {
        return { address: addr, nonce: null, error: err.message };
      })
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    const successful = batchResults.filter(r => r.nonce !== null).length;
    console.log(`${successful}/${batch.length} successful`);
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}

// Analyze the results
function analyzeResults(nonceResults, pendingTxs) {
  const nonceMap = new Map();
  nonceResults.forEach(result => {
    if (result.nonce !== null) {
      nonceMap.set(result.address.toLowerCase(), result.nonce);
    }
  });

  console.log('\n=== DETAILED ANALYSIS ===\n');

  let totalAddresses = 0;
  let addressesWithCurrentNonce = 0;
  let addressesThatTransacted = 0;
  let addressesStillWaiting = 0;
  let addressesWithLowerNonce = 0;

  const analysisResults = [];

  // Analyze each address
  for (const [address, txs] of Object.entries(pendingTxs)) {
    totalAddresses++;
    
    const currentNonce = nonceMap.get(address.toLowerCase());
    if (currentNonce === undefined) {
      continue;
    }
    addressesWithCurrentNonce++;

    // Get the highest nonce in the pending transactions for this address
    const pendingNonces = Object.keys(txs).map(n => parseInt(n, 16)).sort((a, b) => b - a);
    const highestPendingNonce = pendingNonces[0];

    const hasTransacted = currentNonce > highestPendingNonce;
    const stillWaiting = currentNonce === highestPendingNonce;
    const hasLowerNonce = currentNonce < highestPendingNonce;

    if (hasTransacted) {
      addressesThatTransacted++;
    } else if (stillWaiting) {
      addressesStillWaiting++;
    } else if (hasLowerNonce) {
      addressesWithLowerNonce++;
    }

    analysisResults.push({
      address,
      currentNonce,
      highestPendingNonce,
      hasTransacted,
      stillWaiting,
      hasLowerNonce,
      pendingTxCount: Object.keys(txs).length,
      nonceGap: currentNonce - highestPendingNonce
    });
  }

  // Sort by nonce gap (descending) to see the most interesting cases
  analysisResults.sort((a, b) => b.nonceGap - a.nonceGap);

  console.log(`Total addresses in transaction pool: ${totalAddresses}`);
  console.log(`Addresses with current nonce data: ${addressesWithCurrentNonce}`);
  console.log(`Addresses that have transacted (current > highest pending): ${addressesThatTransacted}`);
  console.log(`Addresses still waiting for execution (current = highest pending): ${addressesStillWaiting}`);
  console.log(`Addresses with lower current nonce (current < highest pending): ${addressesWithLowerNonce}\n`);

  // Show addresses that have transacted
  const transactedAddresses = analysisResults.filter(r => r.hasTransacted);
  if (transactedAddresses.length > 0) {
    console.log('=== ADDRESSES THAT HAVE TRANSACTED ===');
    transactedAddresses.forEach(result => {
      console.log(`${result.address}: nonce ${result.highestPendingNonce} → ${result.currentNonce} (gap: +${result.nonceGap})`);
    });
    console.log('');
  }

  // Show addresses still waiting
  const waitingAddresses = analysisResults.filter(r => r.stillWaiting);
  if (waitingAddresses.length > 0) {
    console.log('=== ADDRESSES STILL WAITING FOR EXECUTION ===');
    waitingAddresses.forEach(result => {
      console.log(`${result.address}: nonce ${result.currentNonce} (${result.pendingTxCount} pending txs waiting)`);
    });
    console.log('');
  }

  // Show addresses with lower nonces (interesting case)
  const lowerNonceAddresses = analysisResults.filter(r => r.hasLowerNonce && r.nonceGap >= -100);
  if (lowerNonceAddresses.length > 0) {
    console.log('=== ADDRESSES WITH LOWER CURRENT NONCE (Sample of 10) ===');
    lowerNonceAddresses.slice(0, 10).forEach(result => {
      console.log(`${result.address}: pending nonce ${result.highestPendingNonce}, current nonce ${result.currentNonce} (gap: ${result.nonceGap})`);
    });
    console.log('');
  }

  // Summary statistics
  const nonceGaps = analysisResults.map(r => r.nonceGap);
  const avgGap = nonceGaps.reduce((a, b) => a + b, 0) / nonceGaps.length;
  const maxGap = Math.max(...nonceGaps);
  const minGap = Math.min(...nonceGaps);

  console.log('=== SUMMARY STATISTICS ===');
  console.log(`Average nonce gap: ${avgGap.toFixed(2)}`);
  console.log(`Maximum nonce gap: ${maxGap}`);
  console.log(`Minimum nonce gap: ${minGap}`);

  // Count by gap ranges
  const gapRanges = {
    '0 (still waiting)': analysisResults.filter(r => r.nonceGap === 0).length,
    '1-10 (transacted)': analysisResults.filter(r => r.nonceGap >= 1 && r.nonceGap <= 10).length,
    '11-100 (transacted)': analysisResults.filter(r => r.nonceGap >= 11 && r.nonceGap <= 100).length,
    '101-1000 (transacted)': analysisResults.filter(r => r.nonceGap >= 101 && r.nonceGap <= 1000).length,
    '1000+ (transacted)': analysisResults.filter(r => r.nonceGap > 1000).length,
    'Negative (lower current)': analysisResults.filter(r => r.nonceGap < 0).length
  };

  console.log('\n=== NONCE GAP DISTRIBUTION ===');
  Object.entries(gapRanges).forEach(([range, count]) => {
    console.log(`${range.padEnd(30)}: ${count} addresses`);
  });

  // Transaction count analysis
  const txCounts = analysisResults.map(r => r.pendingTxCount);
  const avgTxCount = txCounts.reduce((a, b) => a + b, 0) / txCounts.length;
  const maxTxCount = Math.max(...txCounts);
  const minTxCount = Math.min(...txCounts);

  console.log('\n=== PENDING TRANSACTION STATISTICS ===');
  console.log(`Average pending transactions per address: ${avgTxCount.toFixed(2)}`);
  console.log(`Maximum pending transactions: ${maxTxCount}`);
  console.log(`Minimum pending transactions: ${minTxCount}`);

  console.log('\n=== CONCLUSION ===');
  if (transactedAddresses.length === 0) {
    console.log('❌ No addresses from the transaction pool have successfully transacted yet.');
    console.log('   This could mean:');
    console.log('   - The transaction pool data is very recent');
    console.log('   - The transactions are still waiting due to low gas prices or other issues');
    console.log('   - There was a significant time gap between pool capture and nonce check');
  } else {
    console.log(`✅ ${transactedAddresses.length} addresses have successfully transacted since the pool snapshot.`);
  }

  console.log(`📊 ${waitingAddresses.length} addresses still have transactions waiting for execution.`);
  console.log(`⚠️  ${addressesWithLowerNonce} addresses have lower current nonces than their pending transactions.`);
}

// Main execution
async function main() {
  try {
    const options = parseArgs();
    
    console.log('=== TRANSACTION POOL ANALYSIS ===\n');
    console.log('Using EL RPC:', options.rpcUrl);
    
    // Read input data
    const txPoolData = await readInputData(options.inputFile);
    
    if (!txPoolData.result || !txPoolData.result.pending) {
      throw new Error('Invalid txpool data format. Expected {result: {pending: {...}}}');
    }
    
    const pendingTxs = txPoolData.result.pending;
    console.log('Pool snapshot contains', Object.keys(pendingTxs).length, 'addresses\n');
    
    const addresses = Object.keys(pendingTxs);
    const nonceResults = await checkAllNonces(addresses, options.rpcUrl, options.batchSize);
    analyzeResults(nonceResults, pendingTxs);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
