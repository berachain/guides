#!/usr/bin/env node

/**
 * Count missed votes for a validator over recent blocks.
 *
 * last_commit in block H records votes for block H-1.
 *
 * Usage: node check-validator-voting.js -p VALIDATOR_ADDRESS [--blocks 100]
 */

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { ValidatorNameDB, BlockFetcher, ConfigHelper } = require('./lib/shared-utils');
const { resolveValidatorNames, normalizeAddress: normalizeMetadataAddress } = require('./lib/metadata-validators');

// Berachain mainnet CL RPC: flag 1 = absent, flags 4/5/6 = voted (Hub uptime ≈ flag-5 rate).
const ABSENT_FLAGS = new Set([1]);
const VOTED_FLAGS = new Set([4, 5, 6]);

function normalizeAddress(address) {
  return address.replace(/^0x/i, '').toUpperCase();
}

function classifyVote(signatures, validatorAddress) {
  const target = normalizeAddress(validatorAddress);

  for (const sig of signatures) {
    if (!sig?.validator_address) continue;
    if (normalizeAddress(sig.validator_address) !== target) continue;
    if (ABSENT_FLAGS.has(sig.block_id_flag)) return 'missed';
    if (VOTED_FLAGS.has(sig.block_id_flag)) return 'voted';
    return 'unknown';
  }

  return 'not_in_set';
}

async function countMissedVotes({
  baseUrl,
  validatorAddress,
  blockCount,
}) {
  const fetcher = new BlockFetcher(baseUrl);
  const headHeight = await fetcher.getCurrentBlock();
  if (!headHeight) {
    throw new Error('Failed to fetch latest block height');
  }

  const opportunities = Math.min(blockCount, headHeight);
  const endBlock = headHeight - 1;
  const startBlock = endBlock - opportunities + 1;

  let missedVotes = 0;
  let votedCount = 0;
  let notInSetCount = 0;

  for (let height = headHeight; height > headHeight - opportunities; height--) {
    const blockData = await fetcher.getBlock(height);
    const block = blockData?.result?.block;
    if (!block) {
      throw new Error(`Failed to fetch block ${height}`);
    }

    const signatures = block.last_commit?.signatures || [];
    const status = classifyVote(signatures, validatorAddress);

    if (status === 'missed' || status === 'not_in_set') missedVotes++;
    else if (status === 'voted') votedCount++;
    else notInSetCount++;
  }

  const missRatePct = opportunities > 0
    ? (missedVotes / opportunities) * 100
    : 0;

  return {
    headHeight,
    blockCount: opportunities,
    startBlock,
    endBlock,
    missedVotes,
    votedCount,
    notInSetCount,
    missRatePct,
  };
}

function printHumanResult(result, validatorAddress, validatorName, chainName) {
  const label = validatorName
    ? `${validatorName} (${validatorAddress})`
    : validatorAddress;

  console.log(`Validator: ${label}`);
  console.log(`Chain: ${chainName}`);
  console.log(`Head height: ${result.headHeight}`);
  console.log(`Window: last ${result.blockCount} blocks (${result.startBlock}–${result.endBlock})`);
  console.log(`Missed votes: ${result.missedVotes} / ${result.blockCount} (${result.missRatePct.toFixed(1)}%)`);
  console.log(`Voted: ${result.votedCount}`);

  if (result.notInSetCount > 0) {
    console.log(`Not in validator set: ${result.notInSetCount} blocks`);
  }
}

function buildArgv() {
  return yargs(hideBin(process.argv))
    .scriptName('check-validator-voting')
    .usage('$0 -p VALIDATOR [--blocks N] [options]')
    .option('validator', {
      alias: 'p',
      type: 'string',
      demandOption: true,
      describe: 'Validator proposer address (with or without 0x prefix)',
    })
    .option('blocks', {
      alias: 'b',
      type: 'number',
      default: 100,
      describe: 'Number of recent blocks to check',
    })
    .option('chain', {
      alias: 'c',
      type: 'string',
      default: 'mainnet',
      choices: ['mainnet', 'bepolia'],
      describe: 'Network to check',
    })
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Emit machine-readable JSON on stdout',
    })
    .option('fail-over', {
      type: 'number',
      describe: 'Exit 1 if missed votes exceed this count (for scripts/alerts)',
    })
    .example('$0 -p 497D6DE4FA4F3FADE96D7AB1942A7E258D42F4CE', 'Miss count over last 100 blocks')
    .example('$0 -p 0xABC... -b 500 --json', 'Last 500 blocks, JSON output')
    .strict()
    .help()
    .alias('help', 'h')
    .argv;
}

async function main() {
  const argv = buildArgv();
  const validatorAddress = normalizeAddress(argv.validator);
  const chainConfig = ConfigHelper.getChainConfig(argv.chain);
  const baseUrl = ConfigHelper.getBlockScannerUrl(argv.chain);

  const result = await countMissedVotes({
    baseUrl,
    validatorAddress,
    blockCount: argv.blocks,
  });

  const validatorDB = new ValidatorNameDB();
  const { names, metadataSource } = await resolveValidatorNames(
    argv.chain,
    baseUrl,
    result.headHeight,
    [validatorAddress],
    { validatorDB },
  );
  const validatorName = names.get(normalizeMetadataAddress(validatorAddress)) || null;

  const payload = {
    validator: validatorAddress,
    validator_name: validatorName || null,
    chain: argv.chain,
    chain_name: chainConfig.name,
    rpc_url: baseUrl,
    metadata_source: metadataSource || null,
    ...result,
    miss_rate_pct: Number(result.missRatePct.toFixed(2)),
  };

  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanResult(result, validatorAddress, validatorName, chainConfig.name);
  }

  const failOver = argv['fail-over'];
  if (failOver !== undefined && result.missedVotes > failOver) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`check-validator-voting failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  ABSENT_FLAGS,
  classifyVote,
  countMissedVotes,
  normalizeAddress,
};
