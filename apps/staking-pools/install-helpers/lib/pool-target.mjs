import { resolveRpcUrl, getFactoryAddress } from './config.mjs';
import {
  assertValidatorPreflight,
  detectNetwork,
  getCoreContracts,
  getValidatorPubkey,
  getWithdrawalVault,
} from './beacond.mjs';
import { createChainReader, walletAddressFromPrivateKey } from './chain-reader.mjs';
import { normalizeAddress } from './units.mjs';

export async function resolveOperatorPool(options = {}, env = process.env) {
  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const pubkey = getValidatorPubkey(env);
  const chainReader = createChainReader(rpcUrl, options.fetchImpl);
  const withdrawalVault = await getWithdrawalVault(network, env, chainReader);

  let stakingPool = '';
  if (options.stakingPool) {
    stakingPool = normalizeAddress(options.stakingPool);
    if (!stakingPool) {
      throw new Error('--staking-pool must be a valid EVM address');
    }
  } else {
    stakingPool = (await getCoreContracts(factory, rpcUrl, pubkey, chainReader)).stakingPool;
  }

  return {
    network,
    rpcUrl,
    factory,
    pubkey,
    withdrawalVault,
    stakingPool,
    chainReader,
  };
}

export async function resolveFromAddress(options = {}, env = process.env) {
  const explicit = options.from || options.receiver;
  if (explicit) {
    const address = normalizeAddress(explicit);
    if (!address) {
      throw new Error('--from must be a valid EVM address');
    }
    return address;
  }
  const privateKey = env.PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error(
      'Pass --from (the address that holds BERA / stBERA), or set PRIVATE_KEY to derive it',
    );
  }
  return (await walletAddressFromPrivateKey(privateKey)).toLowerCase();
}
