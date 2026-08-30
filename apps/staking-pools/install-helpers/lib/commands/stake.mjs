import { logInfo, logSuccess } from '../log.mjs';
import { resolveOperatorPool, resolveFromAddress } from '../pool-target.mjs';
import { createSignerFromEnv } from '../signers.mjs';
import { runTransaction } from '../tx-pipeline.mjs';
import { beraToWei, normalizeAddress } from '../units.mjs';

export async function runStake(options) {
  const env = options.env ?? process.env;
  const verbose = Boolean(options.verbose);
  const receiver = normalizeAddress(options.receiver);
  if (!receiver) {
    throw new Error('--receiver must be a valid EVM address (gets stBERA)');
  }
  const { decimal, wei } = beraToWei(options.amount, '--amount');
  const from = options.from ? normalizeAddress(options.from) : receiver;
  if (options.from && !from) {
    throw new Error('--from must be a valid EVM address');
  }

  const pool = await resolveOperatorPool(options, env);
  const signer = createSignerFromEnv({
    env,
    rpcUrl: pool.rpcUrl,
    fetchImpl: options.fetchImpl,
    signingPreference: options.signingPreference,
  });

  if (verbose) {
    logInfo(`Staking pool / stBERA: ${pool.stakingPool}`);
    logInfo(`Amount: ${decimal} BERA (${wei} wei)`);
    logInfo(`Receiver of stBERA: ${receiver}`);
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl: pool.rpcUrl,
    from,
    stakingPool: pool.stakingPool,
    receiver,
    chainReader: pool.chainReader,
    signer,
    verbose,
    value: `${decimal}ether`,
  };

  return runTransaction(ctx, {
    label: 'submit',
    target: ctx.stakingPool,
    signature: 'submit(address)',
    value: ctx.value,
    buildCalldataArgs: () => [ctx.receiver],
    decodeDryRun: async () => {
      if (verbose) {
        logSuccess(`Preflight OK — submit(${ctx.receiver}) value ${ctx.value}`);
      }
    },
  });
}
