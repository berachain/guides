#!/usr/bin/env node

/**
 * Analyze Gas and Fees - EIP-1559
 * 
 * Features:
 * - Accepts date range (--from-day, --to-day; UTC YYYY-MM-DD) or block range (--start, --end)
 * - Computes per-transaction metrics: total fee paid (gwei), priority fee per gas (gwei), effective gas price (gwei), gas used
 * - Builds 20-bucket histograms over entire range for: total fee paid, priority fee per gas, effective gas price, gas used
 * - Produces per-day statistics table: counts, min/max/median/avg and totals for fees, gas price, gas used
 */

const axios = require('axios');
const http = require('http');
const https = require('https');
const { ConfigHelper } = require('./lib/shared-utils');

// -------- CLI --------
const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const fromArg = args.find(a => a.startsWith('--from-day='));
const toArg = args.find(a => a.startsWith('--to-day='));
const startArg = args.find(a => a.startsWith('--start='));
const endArg = args.find(a => a.startsWith('--end='));
const blocksArg = args.find(a => a.startsWith('--blocks='));
const networkArg = args.find(a => a.startsWith('--network=')) ||
                   args.find(a => a.startsWith('--chain=')) ||
                   (args.includes('-c') ? args[args.indexOf('-c') + 1] : null);
const chainName = networkArg ? (networkArg.includes('=') ? networkArg.split('=')[1] : networkArg) : 'mainnet';
const concArg = args.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = Math.max(1, parseInt(concArg?.split('=')[1] || '12', 10));

function printHelp() {
  console.log(`
Analyze Gas and Fees (EIP-1559)

Usage: node analyze-gas-fees.js [options]

Range (choose one):
  --from-day=YYYY-MM-DD   Start day (UTC). If only --to-day is set, from-day defaults to 20 days before to-day.
  --to-day=YYYY-MM-DD     End day (UTC). If only --from-day is set, to-day defaults to today (UTC).
  --start=N               Start block (inclusive)
  --end=N                 End block (inclusive). Requires --start
  --blocks=N              Analyze last N blocks from head (ignored if start/end or from/to provided)

Defaults:
  If no range flags are provided, analyzes the last 1000 blocks from head.

Other:
  -c, --chain=NAME        Network: mainnet|bepolia (default: mainnet)
  --concurrency=N         Parallel request concurrency (default: 12)        
  -h, --help              Show help

Outputs:
  - 20-bucket histograms for: total fee paid (gwei), priority fee per gas (gwei), effective gas price (gwei), gas used
  - Per-day table: day, tx count, min/max/median/avg total fee paid, total fees; min/max/median/avg gas price; min/max/median/avg gas used, total gas
`);
}

if (showHelp) {
  printHelp();
  process.exit(0);
}

// -------- RPC helpers (EL) --------
const EL_URL = ConfigHelper.getRpcUrl('el', chainName);

const keepAliveAgent = EL_URL.startsWith('https')
  ? new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY * 2 })
  : new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY * 2 });

async function elRpc(method, params = []) {
  const { data } = await axios.post(EL_URL, { jsonrpc: '2.0', id: 1, method, params }, {
    timeout: 30000,
    httpAgent: keepAliveAgent,
    httpsAgent: keepAliveAgent
  });
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

async function getLatestBlockNumber() {
  const hex = await elRpc('eth_blockNumber');
  return parseInt(hex, 16);
}

async function getBlockByNumber(blockNumber) {
  const hexNum = '0x' + blockNumber.toString(16);
  return await elRpc('eth_getBlockByNumber', [hexNum, false]);
}

async function getTxReceipt(txHash) {
  return await elRpc('eth_getTransactionReceipt', [txHash]);
}

// -------- Date helpers --------
const SECONDS_PER_DAY = 86400;
function parseYmdToUtcDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toYmdUTC(tsSec) {
  const d = new Date(tsSec * 1000);
  return d.toISOString().split('T')[0];
}

// Bracketed binary search to find first block with timestamp >= targetTs
async function findFirstBlockAtOrAfter(targetTs, latestBlock) {
  // quick guesses
  let low = 1;
  let high = latestBlock;
  // binary search
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const blk = await getBlockByNumber(mid);
    const ts = parseInt(blk.timestamp, 16);
    if (ts >= targetTs) high = mid; else low = mid + 1;
  }
  return low;
}

// -------- Stats helpers --------
function computeBasicStats(values) {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((s, v) => s + v, 0);
  const avg = sum / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { min, max, avg, median };
}

function buildHistogram(values, numBuckets = 30) {
  if (values.length === 0) return { buckets: [], counts: [] };
  // Avoid spread on very large arrays to prevent call stack overflow
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return { buckets: [[min, max]], counts: [values.length] };
  const width = (max - min) / numBuckets;
  const buckets = Array.from({ length: numBuckets }, (_, i) => [min + i * width, i === numBuckets - 1 ? max : min + (i + 1) * width]);
  const counts = new Array(numBuckets).fill(0);
  for (const v of values) {
    const idx = Math.min(numBuckets - 1, Math.max(0, Math.floor((v - min) / width)));
    counts[idx] += 1;
  }
  return { buckets, counts };
}

// -------- Main --------
(async function main() {
  try {
    const latest = await getLatestBlockNumber();

    // Determine block range
    let startBlock = null;
    let endBlock = null;

    if (startArg && endArg) {
      startBlock = parseInt(startArg.split('=')[1], 10);
      endBlock = parseInt(endArg.split('=')[1], 10);
      if (!(startBlock >= 1 && endBlock >= startBlock)) throw new Error('Invalid --start/--end');
    } else if (fromArg || toArg) {
      const toDay = toArg ? parseYmdToUtcDate(toArg.split('=')[1]) : (d => { d.setUTCHours(0,0,0,0); return d; })(new Date());
      if (!toDay) throw new Error('Invalid --to-day (YYYY-MM-DD)');
      let fromDay = fromArg ? parseYmdToUtcDate(fromArg.split('=')[1]) : new Date(toDay);
      if (!fromArg) fromDay.setUTCDate(fromDay.getUTCDate() - 19); // default 20 days inclusive
      if (fromDay > toDay) throw new Error('--from-day must be <= --to-day');
      const fromTs = Math.floor(fromDay.getTime() / 1000);
      const toPlusOne = new Date(toDay); toPlusOne.setUTCDate(toPlusOne.getUTCDate() + 1);
      const toPlusOneTs = Math.floor(toPlusOne.getTime() / 1000);
      startBlock = await findFirstBlockAtOrAfter(fromTs, latest);
      const endPlusOne = await findFirstBlockAtOrAfter(toPlusOneTs, latest);
      endBlock = Math.max(startBlock, endPlusOne - 1);
    } else if (blocksArg) {
      const count = parseInt(blocksArg.split('=')[1], 10) || 1000;
      endBlock = latest;
      startBlock = Math.max(1, latest - count + 1);
    } else {
      const count = 1000;
      endBlock = latest;
      startBlock = Math.max(1, latest - count + 1);
    }

    console.error(`Analyzing blocks ${startBlock}..${endBlock} on ${chainName}`);

    // Accumulators
    const all_totalFeeGwei = [];
    const all_priorityGwei = [];
    const all_effPriceGwei = [];
    const all_gasUsed = [];
    const perDay = new Map(); // ymd -> { fees[], prices[], gasUsed[], count, totalFeeGwei, totalGas }

    // Scan blocks with concurrency
    const totalBlocks = endBlock - startBlock + 1;
    let processedBlocks = 0;
    function printProgress() {
      const pct = Math.floor((processedBlocks / totalBlocks) * 100);
      process.stderr.write(`\rBlocks: ${processedBlocks}/${totalBlocks} (${pct}%)`);
      if (processedBlocks === totalBlocks) process.stderr.write('\n');
    }

    // Simple concurrency pool over block numbers
    const blockQueue = [];
    for (let bn = startBlock; bn <= endBlock; bn++) blockQueue.push(bn);

    async function worker() {
      while (blockQueue.length > 0) {
        const bn = blockQueue.shift();
        try {
          const block = await getBlockByNumber(bn);
          if (!block) { processedBlocks++; printProgress(); continue; }
          const baseFeeWei = block.baseFeePerGas ? parseInt(block.baseFeePerGas, 16) : 0;
          const ts = parseInt(block.timestamp, 16);
          const day = toYmdUTC(ts);

          // Initialize daily entry
          if (!perDay.has(day)) perDay.set(day, { fees: [], prices: [], gas: [], count: 0, totalFeeGwei: 0, totalGas: 0 });
          const dayEntry = perDay.get(day);

          const txs = block.transactions || [];
          // Fetch receipts in parallel with a bounded inner concurrency
          const innerLimit = Math.min(CONCURRENCY, 16);
          const chunks = [];
          for (let i = 0; i < txs.length; i += innerLimit) chunks.push(txs.slice(i, i + innerLimit));
          for (const chunk of chunks) {
            const receipts = await Promise.all(chunk.map(h => getTxReceipt(h).catch(() => null)));
            for (const r of receipts) {
              if (!r) continue;
              const gasUsed = parseInt(r.gasUsed, 16) || 0;
              const effPriceWei = r.effectiveGasPrice ? parseInt(r.effectiveGasPrice, 16) : 0;
              const priorityWei = Math.max(0, effPriceWei - baseFeeWei);
              const totalFeeWei = BigInt(gasUsed) * BigInt(effPriceWei);

              const effPriceGwei = effPriceWei / 1e9;
              const priorityGwei = priorityWei / 1e9;
              const totalFeeGwei = Number(totalFeeWei / 1000000000n);

              all_totalFeeGwei.push(totalFeeGwei);
              all_priorityGwei.push(priorityGwei);
              all_effPriceGwei.push(effPriceGwei);
              all_gasUsed.push(gasUsed);

              dayEntry.fees.push(totalFeeGwei);
              dayEntry.prices.push(effPriceGwei);
              dayEntry.gas.push(gasUsed);
              dayEntry.count += 1;
              dayEntry.totalFeeGwei += totalFeeGwei;
              dayEntry.totalGas += gasUsed;
            }
          }
        } catch (e) {
          // continue
        } finally {
          processedBlocks++;
          printProgress();
        }
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    // Histograms
    function printHistogram(title, values, unit) {
      const { buckets, counts } = buildHistogram(values, 30);
      const decimals = unit === 'gas' ? 0 : 2;
      console.log(`\nHistogram: ${title}`);
      console.log('low,high,count');
      for (let i = 0; i < buckets.length; i++) {
        const [lo, hi] = buckets[i];
        console.log(`${lo.toFixed(decimals)},${hi.toFixed(decimals)},${counts[i]}`);
      }
    }

    printHistogram('Total fee paid (gwei)', all_totalFeeGwei, 'gwei');
    printHistogram('Priority fee per gas (gwei)', all_priorityGwei, 'gwei');
    printHistogram('Effective gas price (gwei)', all_effPriceGwei, 'gwei');
    printHistogram('Gas used', all_gasUsed, 'gas');

    // Per-day table
    console.log(`\nPer-day statistics:`);
    console.log('Day,Tx Count,Fee(min),Fee(max),Fee(median),Fee(avg),Total Fee (gwei),Price(min),Price(max),Price(median),Price(avg),Gas(min),Gas(max),Gas(median),Gas(avg),Total Gas');
    const daysSorted = Array.from(perDay.keys()).sort();
    for (const day of daysSorted) {
      const d = perDay.get(day);
      const feeStats = computeBasicStats(d.fees);
      const priceStats = computeBasicStats(d.prices);
      const gasStats = computeBasicStats(d.gas);
      console.log([
        day,
        d.count,
        feeStats.min.toFixed(2), feeStats.max.toFixed(2), feeStats.median.toFixed(2), feeStats.avg.toFixed(2), d.totalFeeGwei.toFixed(2),
        priceStats.min.toFixed(2), priceStats.max.toFixed(2), priceStats.median.toFixed(2), priceStats.avg.toFixed(2),
        gasStats.min.toFixed(0), gasStats.max.toFixed(0), gasStats.median.toFixed(0), gasStats.avg.toFixed(2), d.totalGas.toFixed(0)
      ].join(','));
    }

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();


