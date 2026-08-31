import {
  DEFAULT_MIN_EFFECTIVE_BALANCE_BERA,
  DEFAULT_MIN_EFFECTIVE_BALANCE_WEI,
} from '../constants.mjs';
import { resolveRpcUrl, getFactoryAddress } from '../config.mjs';
import { predictPoolAddresses } from '../beacond.mjs';
import { createChainReader } from '../chain-reader.mjs';
import { resolveStandaloneIdentity } from '../identity.mjs';
import { createSignerFromEnv } from '../signers.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { awaitConfirmedWrite } from '../confirmed-write.mjs';
import { runTransaction } from '../tx-pipeline.mjs';
import { beraToWei, normalizeAddress } from '../units.mjs';

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
  const { network, pubkey } = resolveStandaloneIdentity(env, options);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const chainReader = createChainReader(rpcUrl, options.fetchImpl);
  const predicted = await predictPoolAddresses(factory, rpcUrl, pubkey, chainReader);
  const signer = options.signer ?? createSignerFromEnv({
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

  let from = normalizeAddress(options.from);
  if (!from && signer.mode === 'hot-key' && signer.getFundingAddress) {
    from = await signer.getFundingAddress();
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl,
    from,
    smartOperator: predicted.smartOperator,
    wei,
    bera,
    chainReader,
    signer,
    verbose,
    receiptsPath: options.receiptsPath,
    stakingPool: predicted.stakingPool,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
  };

  const descriptor = {
    label: 'setMinEffectiveBalance',
    target: ctx.smartOperator,
    signature: 'setMinEffectiveBalance(uint256)',
    buildCalldataArgs: () => [ctx.wei],
    decodeDryRun: async () => {
      if (verbose) {
        logSuccess(`Preflight OK — setMinEffectiveBalance(${ctx.wei})`);
      }
    },
  };

  return awaitConfirmedWrite({
    ctx,
    runTx: () => runTransaction(ctx, descriptor),
    landedFn: async () => {
      const current = await ctx.chainReader.call(
        predicted.stakingPool,
        'minEffectiveBalance()(uint256)',
      );
      return BigInt(current.decoded?.[0] ?? 0) === BigInt(ctx.wei);
    },
    action: 'set-min-balance',
    addresses: {
      pool: predicted.stakingPool,
      operator: predicted.smartOperator,
    },
    amount: bera,
    scanAddress: predicted.stakingPool,
    waitForLanding: options.waitForLanding !== false,
  });
}
