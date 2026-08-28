import { resolveRpcUrl, getFactoryAddress } from './config.mjs';
import {
  assertValidatorPreflight,
  detectNetwork,
  getCoreContracts,
  getValidatorPubkey,
  getWithdrawalVault,
} from './beacond.mjs';
import { runCast } from './cast.mjs';
import { normalizeAddress } from './units.mjs';

export function resolveOperatorPool(options = {}, env = process.env) {
  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const pubkey = getValidatorPubkey(env);
  const withdrawalVault = getWithdrawalVault(network, env);

  let stakingPool = '';
  if (options.stakingPool) {
    stakingPool = normalizeAddress(options.stakingPool);
    if (!stakingPool) {
      throw new Error('--staking-pool must be a valid EVM address');
    }
  } else {
    stakingPool = getCoreContracts(factory, rpcUrl, pubkey).stakingPool;
  }

  return { network, rpcUrl, factory, pubkey, withdrawalVault, stakingPool };
}

export function resolveFromAddress(options = {}, env = process.env) {
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
  const result = runCast(['wallet', 'address', '--private-key', privateKey], { env });
  const address = normalizeAddress(result.stdout.trim());
  if (result.status !== 0 || !address) {
    throw new Error('Could not derive --from from PRIVATE_KEY');
  }
  return address;
}
