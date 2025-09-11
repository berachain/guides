#!/usr/bin/env node

/**
 * Analyze Blocks - Granular per-block CSV
 * Output per block:
 * - block number
 * - transaction count
 * - gas used total
 * - base fee (average per tx) in gwei
 * - priority fee (average per tx) in gwei
 */

const axios = require('axios');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { ConfigHelper } = require('./lib/shared-utils');

// CLI
const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const fromArg = args.find(a => a.startsWith('--from-day='));
const toArg = args.find(a => a.startsWith('--to-day='));
const startArg = args.find(a => a.startsWith('--start='));
const endArg = args.find(a => a.startsWith('--end='));
const blocksArg = args.find(a => a.startsWith('--blocks='));
const networkArg = args.find(a => a.startsWith('--network=')) || args.find(a => a.startsWith('--chain=')) || (args.includes('-c') ? args[args.indexOf('-c') + 1] : null);
const chainName = networkArg ? (networkArg.includes('=') ? networkArg.split('=')[1] : networkArg) : 'mainnet';
const concArg = args.find(a => a.startsWith('--concurrency='));
const outArg = args.find(a => a.startsWith('--out=')) || args.find(a => a.startsWith('--output='));
const OUTPUT_PATH = outArg ? (outArg.includes('=') ? outArg.split('=')[1] : null) : null;
const CONCURRENCY = Math.max(1, parseInt(concArg?.split('=')[1] || '12', 10));
const progressEnabled = args.includes('--progress') || Boolean(OUTPUT_PATH);

function printHelp() {
  console.log(`
Analyze Blocks - Granular per-block CSV

Usage: node analyze-block-granular.js [options]

Range (choose one):
  --from-day=YYYY-MM-DD   Start day (UTC). If only --to-day, defaults to 20 days before to-day.
  --to-day=YYYY-MM-DD     End day (UTC). If only --from-day, defaults to today (UTC).
  --start=N               Start block (inclusive)
  --end=N                 End block (inclusive). Requires --start
  --blocks=N              Analyze last N blocks from head (default if no other range flags)

Other:
  -c, --chain=NAME        Network: mainnet|bepolia (default: mainnet)
  --concurrency=N         Parallel request concurrency (default: 12)
  --out=FILE              Write CSV output to FILE (progress shown on stderr)
  --progress              Show a progress meter on stderr (enabled by default when --out is set)
  -h, --help              Show help

Output CSV columns:
  block,tx_count,gas_used_total,base_fee_avg_gwei,priority_fee_avg_gwei
`);
}

if (showHelp) {
  printHelp();
  process.exit(0);
}

// RPC helpers (EL)
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

// Date helpers
function parseYmdToUtcDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function findFirstBlockAtOrAfter(targetTs, latestBlock) {
  let low = 1;
  let high = latestBlock;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const blk = await getBlockByNumber(mid);
    const ts = parseInt(blk.timestamp, 16);
    if (ts >= targetTs) high = mid; else low = mid + 1;
  }
  return low;
}

// Formatting helpers
function format6(val) {
  if (!Number.isFinite(val)) return '0';
  const s = val.toFixed(6);
  return s.replace(/\.0+$/, '').replace(/\.(?=\s|$)/, '');
}

(async function main() {
  try {
    const latest = await getLatestBlockNumber();
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
      if (!fromArg) fromDay.setUTCDate(fromDay.getUTCDate() - 19);
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

    const totalBlocks = Math.max(0, endBlock - startBlock + 1);
    let processedBlocks = 0;
    function printProgress() {
      if (!progressEnabled) return;
      const pct = Math.floor((processedBlocks / totalBlocks) * 100);
      process.stderr.write(`\rBlocks: ${processedBlocks}/${totalBlocks} (${pct}%)`);
      if (processedBlocks === totalBlocks) process.stderr.write('\n');
    }

    const outStream = OUTPUT_PATH ? fs.createWriteStream(OUTPUT_PATH, { encoding: 'utf8' }) : null;
    const writeLine = (line) => {
      if (outStream) {
        outStream.write(line + '\n');
      } else {
        console.log(line);
      }
    };

    writeLine('block,tx_count,gas_used_total,base_fee_avg_gwei,priority_fee_avg_gwei');

    const blockQueue = [];
    for (let bn = startBlock; bn <= endBlock; bn++) blockQueue.push(bn);

    async function worker() {
      while (true) {
        const bn = blockQueue.shift();
        if (bn === undefined) break;
        try {
          const block = await getBlockByNumber(bn);
          if (!block) { processedBlocks++; printProgress(); continue; }
          const baseFeeWei = block.baseFeePerGas ? parseInt(block.baseFeePerGas, 16) : 0;
          const txs = block.transactions || [];

          if (txs.length === 0) {
            writeLine(`${bn},0,0,${format6(baseFeeWei/1e9)},0`);
            processedBlocks++;
            printProgress();
            continue;
          }

          let gasTotal = 0;
          let baseFeeSumGwei = 0;
          let prioritySumGwei = 0;

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
              gasTotal += gasUsed;
              baseFeeSumGwei += (baseFeeWei / 1e9);
              prioritySumGwei += (priorityWei / 1e9);
            }
          }

          const txCount = txs.length;
          const baseAvg = baseFeeSumGwei / txCount;
          const prioAvg = prioritySumGwei / txCount;
          writeLine(`${bn},${txCount},${gasTotal},${format6(baseAvg)},${format6(prioAvg)}`);
        } catch (e) {
          // skip on error
        } finally {
          processedBlocks++;
          printProgress();
        }
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    if (outStream) outStream.end();

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();


