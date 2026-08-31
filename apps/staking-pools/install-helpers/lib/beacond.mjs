import { spawnSync } from 'node:child_process';
import { assertNoForbiddenCommands } from './deps.mjs';
import { networkFromValidatorRoot } from './config.mjs';
import { resolveRpcUrl, getFactoryAddress } from './config.mjs';
import { createChainReader } from './chain-reader.mjs';
import { parseProofSlot } from './proofs.mjs';
import {
  BEPOLIA_VALIDATOR_ROOT,
  DEPOSIT_AMOUNT_GWEI,
  MAINNET_VALIDATOR_ROOT,
} from './constants.mjs';

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
      'This command needs a local validator (BEACOND_HOME with readable keys). ' +
        'For a remote validator, run `install` instead.',
    );
  }
  const result = runBeacond(['deposit', 'validator-keys'], env);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim() || 'beacond deposit validator-keys failed';
    throw new Error(
      `Cannot read validator keys from BEACOND_HOME=${home}: ${detail}. ` +
        'For a remote validator, run `install` instead.',
    );
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

export function genesisRootForNetwork(network) {
  if (network === 'mainnet') return MAINNET_VALIDATOR_ROOT;
  if (network === 'bepolia') return BEPOLIA_VALIDATOR_ROOT;
  throw new Error(`Cannot print a deposit command for unknown network: ${network}`);
}

export function formatCreateValidatorCommand(withdrawalVault, network) {
  const genesisRoot = genesisRootForNetwork(network);
  return `beacond deposit create-validator ${withdrawalVault} ${DEPOSIT_AMOUNT_GWEI} -g ${genesisRoot}`;
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

export function parseDepositOutput(output) {
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

export async function getWithdrawalVault(network, env = process.env, chainReader = null) {
  const factory = getFactoryAddress(network);
  const rpc = resolveRpcUrl(network, env);
  const reader = chainReader ?? createChainReader(rpc);
  const result = await reader.call(factory, 'withdrawalVault()(address)');
  return String(result.decoded?.[0] ?? result.decoded).trim();
}

export async function predictPoolAddresses(factory, rpc, pubkey, chainReader = null) {
  const reader = chainReader ?? createChainReader(rpc);
  const result = await reader.call(
    factory,
    'predictStakingPoolContractsAddresses(bytes)(address,address,address,address)',
    [pubkey],
  );
  return parseFourAddressesFromDecoded(result.decoded, 'predictStakingPoolContractsAddresses');
}

export async function getCoreContracts(factory, rpc, pubkey, chainReader = null) {
  const reader = chainReader ?? createChainReader(rpc);
  const result = await reader.call(
    factory,
    'getCoreContracts(bytes)(address,address,address,address)',
    [pubkey],
  );
  const addresses = parseFourAddressesFromDecoded(result.decoded, 'getCoreContracts');
  if (addresses.smartOperator === '0x0000000000000000000000000000000000000000') {
    throw new Error('Staking pool has not been deployed yet');
  }
  return addresses;
}

function parseFourAddressesFromDecoded(decoded, label) {
  const tuple = decoded;
  const [smartOperator, stakingPool, stakingRewardsVault, incentiveCollector] = Array.isArray(tuple)
    ? tuple
    : [tuple];
  const addresses = {
    smartOperator: String(smartOperator).toLowerCase(),
    stakingPool: String(stakingPool).toLowerCase(),
    stakingRewardsVault: String(stakingRewardsVault).toLowerCase(),
    incentiveCollector: String(incentiveCollector).toLowerCase(),
  };
  for (const [name, addr] of Object.entries(addresses)) {
    if (!isEvmAddress(addr)) {
      throw new Error(`${label}: invalid ${name} address ${addr}`);
    }
  }
  return addresses;
}

function isEvmAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? '').trim());
}

export async function getBeaconValidator(clBase, pubkey, fetchImpl = globalThis.fetch) {
  const base = String(clBase ?? '').replace(/\/+$/, '');
  const url = `${base}/eth/v1/beacon/states/head/validators/${pubkey}`;
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`Beacon validator lookup unreachable: ${error.message}`);
  }
  if (response.status === 404) {
    return { found: false, index: '', status: '', balance: '' };
  }
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Beacon validator lookup returned HTTP ${response.status}: ${body.slice(0, 200)}`,
    );
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Beacon validator lookup returned non-JSON: ${body.slice(0, 200)}`);
  }
  return {
    found: true,
    index: String(json.data?.index ?? ''),
    status: String(json.data?.status ?? ''),
    balance: String(json.data?.balance ?? ''),
  };
}

export async function getValidatorIndex(clBase, pubkey, fetchImpl = globalThis.fetch) {
  const record = await getBeaconValidator(clBase, pubkey, fetchImpl);
  return record.found ? record.index : '';
}

// Legacy sync wrappers used during migration — prefer async versions above.
export function getWithdrawalVaultSync(network, env = process.env) {
  const factory = getFactoryAddress(network);
  const rpc = resolveRpcUrl(network, env);
  const reader = createChainReader(rpc);
  return getWithdrawalVault(network, env, reader);
}

export function predictPoolAddressesSync(factory, rpc, pubkey) {
  return predictPoolAddresses(factory, rpc, pubkey);
}

export function getCoreContractsSync(factory, rpc, pubkey) {
  return getCoreContracts(factory, rpc, pubkey);
}
