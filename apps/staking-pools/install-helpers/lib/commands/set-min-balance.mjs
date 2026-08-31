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
import { createChainReader } from '../chain-reader.mjs';
import { createSignerFromEnv } from '../signers.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { runTransaction } from '../tx-pipeline.mjs';
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
  const verbose = Boolean(options.verbose);
  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const pubkey = getValidatorPubkey(env);
  const chainReader = createChainReader(rpcUrl, options.fetchImpl);
  const predicted = await predictPoolAddresses(factory, rpcUrl, pubkey, chainReader);
  const signer = createSignerFromEnv({
    env,
    rpcUrl,
    fetchImpl: options.fetchImpl,
    signingPreference: options.signingPreference,
  });
  const { bera, wei } = resolveMinBalanceAmount(options);

  if (verbose) {
    logInfo(`Target SmartOperator: ${predicted.smartOperator}`);
    logInfo(`setMinEffectiveBalance amount: ${bera} BERA (${wei} wei)`);
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl,
    smartOperator: predicted.smartOperator,
    wei,
    bera,
    chainReader,
    signer,
    verbose,
  };

  return runTransaction(ctx, {
    label: 'setMinEffectiveBalance',
    target: ctx.smartOperator,
    signature: 'setMinEffectiveBalance(uint256)',
    buildCalldataArgs: () => [ctx.wei],
    decodeDryRun: async () => {
      if (verbose) {
        logSuccess(`Preflight OK — setMinEffectiveBalance(${ctx.wei})`);
      }
    },
  });
}
