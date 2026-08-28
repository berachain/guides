import { spawnSync } from 'node:child_process';
import { assertNoForbiddenCommands } from './deps.mjs';
import { networkFromValidatorRoot } from './config.mjs';
import { resolveRpcUrl, getFactoryAddress } from './config.mjs';
import { runCast, parseCastTuple } from './cast.mjs';
import { DEPOSIT_AMOUNT_GWEI } from './constants.mjs';

export function resolveBeacondBin(env = process.env) {
  const configured = env.BEACOND_BIN?.trim() || 'beacond';
  if (configured.startsWith('/')) {
    return configured;
  }
  const which = spawnSync('command', ['-v', configured], {
    encoding: 'utf8',
    shell: true,
  });
  return which.status === 0 ? which.stdout.trim() : configured;
}

let beacondRunner = null;

export function setBeacondRunner(runner) {
  beacondRunner = runner;
}

export function runBeacond(args, env = process.env) {
  if (beacondRunner) {
    return beacondRunner(args, env);
  }
  const bin = resolveBeacondBin(env);
  const home = env.BEACOND_HOME?.trim();
  const fullArgs = home ? ['--home', home, ...args] : args;
  assertNoForbiddenCommands([bin, ...fullArgs]);
  const result = spawnSync(bin, fullArgs, {
    encoding: 'utf8',
    env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    argv: [bin, ...fullArgs],
  };
}

export function getValidatorPubkey(env = process.env) {
  const result = runBeacond(['deposit', 'validator-keys'], env);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'beacond deposit validator-keys failed');
  }
  const lines = result.stdout.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/Eth\/Beacon Pubkey \(Compressed 48-byte Hex\):/i.test(lines[i])) {
      const next = lines[i + 1]?.trim();
      if (next) return next;
    }
  }
  const match = result.stdout.match(/0x[0-9a-fA-F]{96}/);
  if (match) return match[0];
  throw new Error('Could not parse validator pubkey from beacond output');
}

export function assertValidatorPreflight(env = process.env) {
  const home = env.BEACOND_HOME?.trim();
  if (!home) {
    throw new Error(
      'BEACOND_HOME is required. Set BEACOND_HOME to your beacond data directory on this validator host.',
    );
  }
  const result = runBeacond(['deposit', 'validator-keys'], env);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim() || 'beacond deposit validator-keys failed';
    throw new Error(`Cannot read validator keys from BEACOND_HOME=${home}: ${detail}`);
  }
}

export function detectNetwork(env = process.env) {
  const explicit = env.CLI_CHAIN?.trim();
  if (explicit) return explicit;
  const home = env.BEACOND_HOME?.trim();
  if (!home) {
    throw new Error('Could not detect network. Set CLI_CHAIN or BEACOND_HOME.');
  }
  const result = runBeacond(
    ['genesis', 'validator-root', `${home}/config/genesis.json`],
    env,
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return 'unknown';
  }
  return networkFromValidatorRoot(result.stdout.trim());
}

export function getGenesisValidatorRoot(env = process.env) {
  const home = env.BEACOND_HOME?.trim();
  if (!home) {
    throw new Error('BEACOND_HOME is required');
  }
  const result = runBeacond(
    ['genesis', 'validator-root', `${home}/config/genesis.json`],
    env,
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('Could not read genesis validator root');
  }
  return result.stdout.trim();
}

export function createValidatorDeposit(withdrawalVault, env = process.env) {
  const genesisRoot = getGenesisValidatorRoot(env);
  const create = runBeacond(
    [
      'deposit',
      'create-validator',
      withdrawalVault,
      DEPOSIT_AMOUNT_GWEI,
      '-g',
      genesisRoot,
    ],
    env,
  );
  if (create.status !== 0 || !create.stdout.trim()) {
    throw new Error(create.stderr || create.stdout || 'deposit create-validator failed');
  }
  const fields = parseDepositOutput(create.stdout);
  const validate = runBeacond(
    [
      'deposit',
      'validate',
      fields.pubkey,
      fields.credentials,
      DEPOSIT_AMOUNT_GWEI,
      fields.signature,
      '-g',
      genesisRoot,
    ],
    env,
  );
  if (validate.status !== 0) {
    throw new Error(validate.stderr || validate.stdout || 'deposit validate failed');
  }
  return fields;
}

function parseDepositOutput(output) {
  const lines = output.split('\n');
  const fields = {};
  for (const line of lines) {
    if (line.includes('credentials:')) fields.credentials = line.split(/\s+/)[1];
    if (line.includes('signature:')) fields.signature = line.split(/\s+/)[1];
    if (line.includes('amount:')) fields.amount = line.split(/\s+/)[1];
    if (line.includes('pubkey:')) fields.pubkey = line.split(/\s+/)[1];
  }
  if (!fields.credentials || !fields.signature || !fields.pubkey) {
    throw new Error('Could not parse deposit parameters from beacond output');
  }
  return fields;
}

export function getWithdrawalVault(network, env = process.env) {
  const factory = getFactoryAddress(network);
  const rpc = resolveRpcUrl(network, env);
  const result = runCast([
    'call',
    factory,
    'withdrawalVault()(address)',
    '-r',
    rpc,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'withdrawalVault lookup failed');
  }
  return result.stdout.trim();
}

export function predictPoolAddresses(factory, rpc, pubkey) {
  const result = runCast([
    'call',
    factory,
    'predictStakingPoolContractsAddresses(bytes)(address,address,address,address)',
    pubkey,
    '-r',
    rpc,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'prediction call failed');
  }
  const [smartOperator, stakingPool, stakingRewardsVault, incentiveCollector] =
    parseCastTuple(result.stdout.trim());
  return { smartOperator, stakingPool, stakingRewardsVault, incentiveCollector };
}

export async function getValidatorIndex(clBase, pubkey, fetchImpl = globalThis.fetch) {
  const url = `${clBase}/eth/v1/beacon/states/head/validators`;
  const response = await fetchImpl(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`validators API returned HTTP ${response.status}`);
  }
  const json = JSON.parse(body);
  const match = json.data?.find((entry) => entry.validator?.pubkey === pubkey);
  return match?.index ?? '';
}
