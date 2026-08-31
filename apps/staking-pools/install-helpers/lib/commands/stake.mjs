import { logInfo, logSuccess } from '../log.mjs';
import { resolveOperatorPool, resolveFromAddress } from '../pool-target.mjs';
import { awaitConfirmedWrite } from '../confirmed-write.mjs';
import { exclusiveFromBlock, RECEIPT_EVENT_ABIS, recoverTxHash } from '../receipt-events.mjs';
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
  const signer = options.signer ?? createSignerFromEnv({
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
    receiptsPath: options.receiptsPath,
    amount: decimal,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    waitForLanding: options.waitForLanding,
  };

  return runStakeSubmit(ctx);
}

export async function runStakeSubmit(ctx) {
  const fromBlock =
    ctx.signer.mode === 'cold-signing' ? await exclusiveFromBlock(ctx.chainReader) : '0x0';
  return awaitConfirmedWrite({
    ctx,
    runTx: () =>
      runTransaction(ctx, {
        label: 'submit',
        target: ctx.stakingPool,
        signature: 'submit(address)',
        value: ctx.value,
        buildCalldataArgs: () => [ctx.receiver],
        decodeDryRun: async () => {
          if (ctx.verbose) {
            logSuccess(`Preflight OK — submit(${ctx.receiver}) value ${ctx.value}`);
          }
        },
      }),
    landedFn: async () => {
      try {
        await recoverTxHash(ctx.chainReader, {
          address: ctx.stakingPool,
          eventAbi: RECEIPT_EVENT_ABIS.stake,
          fromBlock,
        });
        return true;
      } catch {
        return false;
      }
    },
    action: 'stake',
    addresses: {
      pool: ctx.stakingPool,
      sharesRecipient: ctx.receiver,
    },
    amount: ctx.amount ?? String(ctx.value ?? '').replace(/ether$/, ''),
    scanAddress: ctx.stakingPool,
    waitForLanding: ctx.waitForLanding !== false,
  });
}
