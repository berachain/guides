import {
  DEFAULT_MIN_EFFECTIVE_BALANCE_BERA,
  DEFAULT_MIN_EFFECTIVE_BALANCE_WEI,
} from '../constants.mjs';
import { resolveRpcUrl, getFactoryAddress } from '../config.mjs';
import {
  assertValidatorPreflight,
  detectNetwork,
  getValidatorPubkey,
  predictPoolAddresses,
} from '../beacond.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { runTransaction } from '../tx-runner.mjs';
import { beraToWei } from '../units.mjs';

export function resolveMinBalanceAmount(options) {
  if (options.amount === undefined || options.amount === null || options.amount === '') {
    return {
      bera: DEFAULT_MIN_EFFECTIVE_BALANCE_BERA,
      wei: DEFAULT_MIN_EFFECTIVE_BALANCE_WEI,
    };
  }
  const parsed = beraToWei(options.amount, '--amount');
  return { bera: parsed.decimal, wei: parsed.wei };
}

export async function runSetMinBalance(options) {
  const env = options.env ?? process.env;
  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const pubkey = getValidatorPubkey(env);
  const predicted = predictPoolAddresses(factory, rpcUrl, pubkey);
  const { bera, wei } = resolveMinBalanceAmount(options);

  logInfo(`Target pool: ${predicted.stakingPool}`);
  logInfo(`setMinEffectiveBalance amount: ${bera} BERA (${wei} wei)`);

  const ctx = {
    execute: options.execute,
    env,
    rpcUrl,
    stakingPool: predicted.stakingPool,
    wei,
    bera,
  };

  return runTransaction(ctx, {
    label: 'setMinEffectiveBalance',
    target: ctx.stakingPool,
    signature: 'setMinEffectiveBalance(uint256)',
    buildCalldataArgs: () => [ctx.wei],
    decodeDryRun: async () => {
      logSuccess(`Preflight OK — setMinEffectiveBalance(${ctx.wei})`);
    },
  });
}
