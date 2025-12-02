#!/usr/bin/env node

/**
 * Staking Pool Event Scanner
 *
 * Scans a staking pool contract for all events and decodes them, with
 * special attention to SharesMinted to track shareholders.
 *
 * Usage:
 *   ./scan-pool-events.js --pool 0x... --start 10000000 --chain bepolia
 *   ./scan-pool-events.js --pool 0x... --start 10000000 --end 10050000 --rpc http://host:port
 *
 * Notes:
 * - No external dependencies; uses JSON-RPC directly via http/https.
 * - Decodes common OpenZeppelin and pool-specific events.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// RPC defaults
const RPC_BY_CHAIN = {
  mainnet: 'https://rpc.berachain.com',
  bepolia: 'https://bepolia.rpc.berachain.com'
};

// Known event topics → decoder
// These are keccak256(eventSignature) precomputed values.
// Covers OZ Ownable2StepUpgradeable, OZ Pausable, and pool-specific events.
const EVENT_DECODERS = {
  // OpenZeppelin Ownable2StepUpgradeable
  '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0': {
    name: 'OwnershipTransferred',
    decode: (log) => {
      const previousOwner = topicToAddress(log.topics[1]);
      const newOwner = topicToAddress(log.topics[2]);
      return { previousOwner, newOwner };
    }
  },
  '0xc7f505b2f371ae2175ee4913f4499e1f2633a7b5936321eed1cdaeb6115181d2': {
    name: 'OwnershipTransferStarted',
    decode: (log) => {
      const previousOwner = topicToAddress(log.topics[1]);
      const newOwner = topicToAddress(log.topics[2]);
      return { previousOwner, newOwner };
    }
  },

  // OpenZeppelin PausableUpgradeable
  '0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258': {
    name: 'Paused',
    decode: (log) => {
      // Some OZ variants do not index the account; handle both possibilities
      const account = log.topics.length > 1 ? topicToAddress(log.topics[1]) : dataWordToAddress(log.data.slice(2, 66));
      return { account };
    }
  },
  '0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa': {
    name: 'Unpaused',
    decode: (log) => {
      const account = log.topics.length > 1 ? topicToAddress(log.topics[1]) : dataWordToAddress(log.data.slice(2, 66));
      return { account };
    }
  },

  // Pool share/accounting events
  // event SharesMinted(address indexed to, uint256 amount)
  '0x6332ddaa8a69b5eb2524ec7ca317b7c2b01ecf678d584031415f81270977b8fc': {
    name: 'SharesMinted',
    decode: (log) => {
      const to = topicToAddress(log.topics[1]);
      const amount = hexToBigInt(log.data.slice(2, 66)).toString();
      return { to, amount };
    }
  },
  // event SharesBurned(address indexed from, uint256 amount)
  '0xdb79cc492679ef2624944d6ed3cdbad5b974b5550de330ae18922f2944eec78a': {
    name: 'SharesBurned',
    decode: (log) => {
      const from = topicToAddress(log.topics[1]);
      const amount = hexToBigInt(log.data.slice(2, 66)).toString();
      return { from, amount };
    }
  },
  // event TotalDepositsUpdated(uint256 newTotalDeposits)
  '0x8f8beec7c09513a4066b76964ff338179905ff1a3cc184dbabe9620b02440b98': {
    name: 'TotalDepositsUpdated',
    decode: (log) => {
      const newTotalDeposits = hexToBigInt(log.data.slice(2, 66)).toString();
      return { newTotalDeposits };
    }
  },
  // event StakingRewardsReceived(uint256 amount)
  '0x3f0a75be02a4aead211a44563999d8da86f037a96c01479fcd97f72ca38009b7': {
    name: 'StakingRewardsReceived',
    decode: (log) => {
      const amount = hexToBigInt(log.data.slice(2, 66)).toString();
      return { amount };
    }
  },
  // event MinEffectiveBalanceUpdated(uint256 newMinEffectiveBalance)
  '0xdbb3b22b33ed00477e9a19dfb79d0561baaad1a9717bbc31d735b2e58d2bc15e': {
    name: 'MinEffectiveBalanceUpdated',
    decode: (log) => {
      const newMinEffectiveBalance = hexToBigInt(log.data.slice(2, 66)).toString();
      return { newMinEffectiveBalance };
    }
  },
  // event MaxCapacityReached(bytes pubkey)
  '0x1e13e9eadf12c0d69b4ce6fbf1acbe3c138b8ebebfe72651a1e1a81e6ca32ebf': {
    name: 'MaxCapacityReached',
    decode: (log) => {
      // ABI encoding: offset (32) | length (32) | data (padded)
      const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
      if (!data || data.length < 128) return { pubkey: '0x' };
      const len = Number('0x' + data.slice(64, 128));
      const bytesHex = data.slice(128, 128 + len * 2);
      return { pubkey: '0x' + bytesHex };
    }
  },

  // Already decoded by prior scripts, included here for completeness:
  // event StakingPoolActivated()
  '0x6aee0ab7a0c7abd80ab954b2673f8441259943fb9b330238d9a50623b56f4a62': {
    name: 'StakingPoolActivated',
    decode: () => ({})
  },
  // event ActiveThresholdReached()
  '0x4d5f67b0cd8166aa1f51bf14453372241e82f226cdd5b710ec9e193469e859ae': {
    name: 'ActiveThresholdReached',
    decode: () => ({})
  },
  // event FullExitTriggered()
  '0x752dcc9268177303179c90855086eabd90ea7945fb4ff4bb12834990a6d369fa': {
    name: 'FullExitTriggered',
    decode: () => ({})
  }
};

// Some topics above for zero-arg pool events are included to avoid Unknown labels.
// If these specific precomputed values diverge, the rest of the decoders still cover the problematic Unknowns
// shown by the user (Ownership*, Paused/Unpaused, SharesMinted, TotalDepositsUpdated).

function parseArgs() {
  const yargs = require('yargs/yargs');
  const { hideBin } = require('yargs/helpers');
  
  const argv = yargs(hideBin(process.argv))
    .option('pool', {
      type: 'string',
      demandOption: true,
      description: 'Pool address (required)'
    })
    .option('start', {
      type: 'number',
      demandOption: true,
      description: 'Start block number (required)'
    })
    .option('end', {
      type: 'number',
      description: 'End block number'
    })
    .option('chain', {
      type: 'string',
      default: 'bepolia',
      choices: ['mainnet', 'bepolia'],
      description: 'Chain to use'
    })
    .option('rpc', {
      type: 'string',
      description: 'RPC endpoint URL'
    })
    .option('pubkey', {
      type: 'string',
      description: 'Validator pubkey'
    })
    .option('include-delegated', {
      type: 'boolean',
      default: false,
      description: 'Include delegated pool events'
    })
    .option('help', {
      alias: 'h',
      type: 'boolean',
      description: 'Show help'
    })
    .strict()
    .help()
    .argv;
  
  if (argv.help) {
    return { help: true };
  }
  
  const cfg = {
    pool: argv.pool,
    start: argv.start,
    end: argv.end !== undefined ? argv.end : null,
    chain: argv.chain,
    rpc: argv.rpc || null,
    pubkey: argv.pubkey || null,
    includeDelegated: argv['include-delegated']
  };
  
  cfg.rpc = cfg.rpc || RPC_BY_CHAIN[cfg.chain];
  return cfg;
}

async function rpcRequest(url, method, params = []) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const postData = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 30000
    };
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.result);
        } catch (e) {
          reject(new Error(`Failed to parse RPC response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('RPC request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

async function getLatestBlock(rpc) {
  const hex = await rpcRequest(rpc, 'eth_blockNumber');
  return parseInt(hex, 16);
}

async function getLogs(rpc, fromBlock, toBlock, address) {
  return rpcRequest(rpc, 'eth_getLogs', [
    {
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      address
    }
  ]);
}

function topicToAddress(topic) {
  if (!topic || topic.length < 66) return '0x0000000000000000000000000000000000000000';
  return '0x' + topic.slice(topic.length - 40);
}

function dataWordToAddress(wordHex) {
  if (!wordHex || wordHex.length < 64) return '0x0000000000000000000000000000000000000000';
  return '0x' + wordHex.slice(24);
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return 0n;
  return BigInt('0x' + hex.replace(/^0x/, ''));
}

function formatAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 10) + '...' + addr.slice(-6);
}

function weiToDecimalString(valueBigInt, decimals) {
  const negative = valueBigInt < 0n;
  const v = negative ? -valueBigInt : valueBigInt;
  const base = 10n ** BigInt(decimals);
  const intPart = v / base;
  const fracPart = v % base;
  const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
  const result = fracStr.length > 0 ? `${intPart.toString()}.${fracStr}` : intPart.toString();
  return negative ? `-${result}` : result;
}

function decodeEvent(log) {
  const decoder = EVENT_DECODERS[log.topics[0]];
  if (!decoder) return { name: 'Unknown', details: `topic0: ${log.topics[0]}` };
  try {
    const decoded = decoder.decode(log) || {};
    const name = decoder.name;
    const details = formatDetails(name, decoded);
    return { name, details, decoded };
  } catch (e) {
    return { name: 'Unknown', details: `decode error: ${e.message}` };
  }
}

function formatDetails(name, decoded) {
  switch (name) {
    case 'SharesMinted':
      return `to=${formatAddress(decoded.to)} amount=${decoded.amount}`;
    case 'SharesBurned':
      return `from=${formatAddress(decoded.from)} amount=${decoded.amount}`;
    case 'StakingRewardsReceived':
      return `amount=${decoded.amount}`;
    case 'MinEffectiveBalanceUpdated':
      return `newMinEffectiveBalance=${decoded.newMinEffectiveBalance}`;
    case 'MaxCapacityReached':
      return `pubkey=${decoded.pubkey}`;
    case 'OwnershipTransferred':
      return `prev=${formatAddress(decoded.previousOwner)} new=${formatAddress(decoded.newOwner)}`;
    case 'OwnershipTransferStarted':
      return `prev=${formatAddress(decoded.previousOwner)} new=${formatAddress(decoded.newOwner)}`;
    case 'Paused':
    case 'Unpaused':
      return `account=${formatAddress(decoded.account)}`;
    case 'TotalDepositsUpdated':
      return `newTotalDeposits=${decoded.newTotalDeposits}`;
    default:
      return '-';
  }
}

function padRight(str, n) {
  if (str.length >= n) return str;
  return str + ' '.repeat(n - str.length);
}

function padLeft(str, n) {
  if (str.length >= n) return str;
  return ' '.repeat(n - str.length) + str;
}

async function main() {
  const cfg = parseArgs();
  if (cfg.help) {
    if (cfg.error) console.error(`Error: ${cfg.error}`);
    console.log(`\nStaking Pool Event Scanner\n\n` +
      `Required:\n` +
      `  --pool <address>         Pool contract address\n` +
      `  --start <block>          Start block (inclusive)\n\n` +
      `Optional:\n` +
      `  --end <block>            End block (inclusive, defaults to latest)\n` +
      `  --chain <name>           mainnet | bepolia (default: bepolia)\n` +
      `  --rpc <url>              Override RPC URL\n` +
      `  --include-delegated      Also scan DelegationHandler logs for this validator\n` +
      `  --pubkey <hex>           Validator compressed pubkey (needed with --include-delegated)\n`);
    process.exit(cfg.error ? 1 : 0);
  }

  const latest = await getLatestBlock(cfg.rpc);
  const start = cfg.start;
  const end = cfg.end != null ? cfg.end : latest;

  console.log(`\nScanning pool: ${cfg.pool}`);
  console.log(`Chain: ${cfg.chain}`);
  console.log(`RPC URL: ${cfg.rpc}`);
  console.log(`\nScanning from block ${start} to ${end}...`);

  const chunkSize = 10000;
  const events = [];
  const counts = new Map();
  const shareholderBalances = new Map(); // address -> BigInt shares
  let found = 0;

  // Optionally include DelegationHandler address
  const addresses = [cfg.pool];
  const DELEGATION_HANDLER_FACTORY_BY_CHAIN = {
    mainnet: '0x0000000000000000000000000000000000000000',
    bepolia: '0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c'
  };
  async function maybeResolveDelegationHandler() {
    try {
      if (!cfg.includeDelegated || !cfg.pubkey) return null;
      const factory = DELEGATION_HANDLER_FACTORY_BY_CHAIN[cfg.chain];
      if (!factory || factory === '0x0000000000000000000000000000000000000000') return null;
      // delegationHandlers(bytes)(address)
      const selector = '0x50684886'; // keccak4: delegationHandlers(bytes)
      const pubkeyHex = cfg.pubkey.startsWith('0x') ? cfg.pubkey.slice(2) : cfg.pubkey;
      // ABI-encode dynamic bytes: offset (0x20), length (0x40 = 64 bytes), then pubkey (assumed 48 bytes? Here use provided length)
      // To avoid a full ABI encoder here, rely on cast alternative: but we keep simple by building standard encoding for bytes
      // bytes encoding: offset 0x20, length N, data (padded)
      const len = (pubkeyHex.length / 2).toString(16).padStart(64, '0');
      const padded = pubkeyHex.padEnd(Math.ceil(pubkeyHex.length / 64) * 64, '0');
      const data = '0x' + selector + '0000000000000000000000000000000000000000000000000000000000000020' + len + padded;
      const result = await rpcRequest(cfg.rpc, 'eth_call', [{ to: factory, data }, 'latest']);
      if (!result || result === '0x' || result.length < 66) return null;
      const addr = '0x' + result.slice(result.length - 40);
      if (/^0x0{40}$/.test(addr.slice(2))) return null;
      return addr;
    } catch (_) {
      return null;
    }
  }

  const delegationHandler = await maybeResolveDelegationHandler();
  if (delegationHandler) addresses.push(delegationHandler);

  for (let from = start; from <= end; from += chunkSize) {
    const to = Math.min(end, from + chunkSize - 1);
    const logs = await getLogs(cfg.rpc, from, to, addresses.length === 1 ? addresses[0] : addresses);
    for (const log of logs) {
      const { name, details, decoded } = decodeEvent(log);
      events.push({
        blockNumber: parseInt(log.blockNumber, 16),
        txHash: log.transactionHash,
        name,
        details
      });
      counts.set(name, (counts.get(name) || 0) + 1);
      found++;

      // Aggregate shareholder balances from pool events only
      if (log.address.toLowerCase() === cfg.pool.toLowerCase()) {
        if (name === 'SharesMinted' && decoded && decoded.to) {
          const key = decoded.to.toLowerCase();
          const prev = shareholderBalances.get(key) || 0n;
          shareholderBalances.set(key, prev + BigInt(decoded.amount));
        } else if (name === 'SharesBurned' && decoded && decoded.from) {
          const key = decoded.from.toLowerCase();
          const prev = shareholderBalances.get(key) || 0n;
          shareholderBalances.set(key, prev - BigInt(decoded.amount));
        }
      }
    }
    const progress = (((Math.min(to, end) - start + 1) / (end - start + 1)) * 100).toFixed(1);
    process.stdout.write(`Progress: ${padLeft(progress, 5)}% (blocks ${from}-${to}) | Events found: ${found}\r`);
  }
  process.stdout.write('\n\n');

  console.log(`Total events found: ${found}\n`);

  // Sort by blockNumber asc, then tx
  events.sort((a, b) => (a.blockNumber === b.blockNumber ? a.txHash.localeCompare(b.txHash) : a.blockNumber - b.blockNumber));

  // Print table header (show full transaction hash)
  const TXW = 66;
  const headers = [padRight('Block', 8), padRight('Tx Hash', TXW), padRight('Event', 26), 'Details'];
  console.log('┌' + '─'.repeat(10) + '┬' + '─'.repeat(TXW) + '┬' + '─'.repeat(28) + '┬' + '─'.repeat(80) + '┐');
  console.log('│ ' + headers.join(' │ ') + ' │');
  console.log('├' + '─'.repeat(10) + '┼' + '─'.repeat(TXW) + '┼' + '─'.repeat(28) + '┼' + '─'.repeat(80) + '┤');

  for (const e of events) {
    console.log(
      '│ ' +
        padRight(String(e.blockNumber), 8) + ' │ ' +
        padRight(e.txHash, TXW) + ' │ ' +
        padRight(e.name, 26) + ' │ ' +
        padRight(e.details, 78) + ' │'
    );
  }
  console.log('└' + '─'.repeat(10) + '┴' + '─'.repeat(TXW) + '┴' + '─'.repeat(28) + '┴' + '─'.repeat(80) + '┘');

  // Summary
  console.log('\n=== Event Summary ===\n');
  const summary = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const sHeader = [padRight('Event Type', 36), padRight('Count', 6)];
  console.log('┌' + '─'.repeat(36) + '┬' + '─'.repeat(8) + '┐');
  console.log('│ ' + sHeader.join(' │ ') + ' │');
  console.log('├' + '─'.repeat(36) + '┼' + '─'.repeat(8) + '┤');
  for (const [name, count] of summary) {
    console.log('│ ' + padRight(name, 36) + ' │ ' + padRight(String(count), 6) + ' │');
  }
  console.log('└' + '─'.repeat(36) + '┴' + '─'.repeat(8) + '┘');

  // Shareholders
  if (shareholderBalances.size > 0) {
    console.log('\n=== Shareholders (aggregated from SharesMinted/Burned) ===\n');
    // sort by balance desc
    const entries = Array.from(shareholderBalances.entries()).sort((a, b) => (b[1] > a[1] ? 1 : -1));
    const hHeader = [padRight('Address (full)', 42), padRight('Shares (stBERA)', 24)];
    console.log('┌' + '─'.repeat(44) + '┬' + '─'.repeat(26) + '┐');
    console.log('│ ' + hHeader.join(' │ ') + ' │');
    console.log('├' + '─'.repeat(44) + '┼' + '─'.repeat(26) + '┤');
    for (const [addr, bal] of entries) {
      const human = weiToDecimalString(bal, 18);
      console.log('│ ' + padRight(addr, 42) + ' │ ' + padRight(human, 24) + ' │');
    }
    console.log('└' + '─'.repeat(44) + '┴' + '─'.repeat(26) + '┘');
  }
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});


