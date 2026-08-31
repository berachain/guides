import { WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY } from '../constants.mjs';
import { createSignerFromEnv } from '../signers.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { resolveFromAddress, resolveOperatorPool } from '../pool-target.mjs';
import { awaitConfirmedWrite } from '../confirmed-write.mjs';
import {
  exclusiveFromBlock,
  RECEIPT_EVENT_ABIS,
  recoverEventArgsFromReceipt,
  recoverTxHash,
} from '../receipt-events.mjs';
import { decodeWithdrawalRevert } from '../revert-decoder.mjs';
import { runTransaction } from '../tx-pipeline.mjs';
import { beraToGwei, beraToWei } from '../units.mjs';

export async function runUnstake(options) {
  const env = options.env ?? process.env;
  const verbose = Boolean(options.verbose);
  const mode = resolveUnstakeMode(options);
  const pool = await resolveOperatorPool(options, env);
  const from = await resolveFromAddress(options, env);
  const signer = options.signer ?? createSignerFromEnv({
    env,
    rpcUrl: pool.rpcUrl,
    fetchImpl: options.fetchImpl,
    signingPreference: options.signingPreference,
  });

  await assertPoolActive(pool.stakingPool, pool.chainReader);

  if (verbose) {
    logInfo(`Staking pool: ${pool.stakingPool}`);
    logInfo(`Withdrawal vault: ${pool.withdrawalVault}`);
    logInfo(`From (stBERA holder): ${from}`);
  }

  const extras = {
    receiptsPath: options.receiptsPath,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    waitForLanding: options.waitForLanding,
  };

  if (mode === 'finalize') {
    return finalizeRequest(options, pool, from, env, signer, verbose, extras);
  }
  if (mode === 'assets') {
    return requestByAssets(options, pool, from, env, signer, verbose, extras);
  }
  return requestByShares(options, pool, from, env, signer, verbose, extras);
}

function eventLanded(chainReader, address, action, fromBlock) {
  return async () => {
    try {
      await recoverTxHash(chainReader, {
        address,
        eventAbi: RECEIPT_EVENT_ABIS[action],
        fromBlock,
      });
      return true;
    } catch {
      return false;
    }
  };
}

export function resolveUnstakeMode(options) {
  const hasAmount = hasValue(options.amount);
  const hasShares = hasValue(options.shares);
  // --finalize's *presence* selects finalize mode, regardless of whether a
  // valid id followed it — an empty string means "finalize every ready
  // request," not "no --finalize passed." See resolveFinalizeTarget.
  const hasFinalize = options.finalize !== undefined;
  const count = [hasAmount, hasShares, hasFinalize].filter(Boolean).length;
  if (count !== 1) {
    throw new Error('Pass exactly one of --amount, --shares, or --finalize [requestId]');
  }
  if (hasFinalize) return 'finalize';
  if (hasAmount) return 'assets';
  return 'shares';
}

/**
 * Decides single-ID vs finalize-all from the captured --finalize value.
 * Empty/absent → finalize-all. A valid non-negative integer → single-ID.
 * Anything else is a clear parse error (no silent fallback to finalize-all).
 */
export function resolveFinalizeTarget(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (value === '') {
    return { mode: 'all' };
  }
  if (/^[0-9]+$/.test(value)) {
    return { mode: 'single', requestId: value };
  }
  throw new Error(
    '--finalize must be a request id (uint256), or omitted to finalize every ready request',
  );
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

async function assertPoolActive(stakingPool, chainReader) {
  const result = await chainReader.call(stakingPool, 'isActive()(bool)');
  if (result.decoded?.[0] !== true) {
    throw new Error('Pool is not active. Cannot request withdrawal.');
  }
}

async function finalizeRequest(options, pool, from, env, signer, verbose, extras) {
  const target = resolveFinalizeTarget(options.finalize);
  if (target.mode === 'all') {
    return finalizeAllReady(pool, from, env, signer, verbose, extras);
  }
  const requestId = target.requestId;

  if (verbose) {
    logInfo(`Finalize withdrawal request: ${requestId}`);
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl: pool.rpcUrl,
    from,
    withdrawalVault: pool.withdrawalVault,
    requestId,
    chainReader: pool.chainReader,
    signer,
    verbose,
    ...extras,
  };

  const fromBlock =
    signer.mode === 'cold-signing' ? await exclusiveFromBlock(pool.chainReader) : '0x0';
  return awaitConfirmedWrite({
    ctx,
    runTx: () =>
      runTransaction(ctx, {
        label: 'finalizeWithdrawalRequest',
        target: ctx.withdrawalVault,
        signature: 'finalizeWithdrawalRequest(uint256)',
        buildCalldataArgs: () => [ctx.requestId],
        decodePreflightError: decodeWithdrawalRevert,
        decodeDryRun: async () => {
          if (verbose) {
            logSuccess(`Preflight OK — finalizeWithdrawalRequest(${ctx.requestId})`);
          }
        },
      }),
    landedFn: eventLanded(
      pool.chainReader,
      pool.withdrawalVault,
      'unstake.finalizeWithdrawalRequest',
      fromBlock,
    ),
    action: 'unstake.finalizeWithdrawalRequest',
    addresses: { pool: pool.stakingPool, withdrawalVault: pool.withdrawalVault },
    amount: requestId,
    scanAddress: pool.withdrawalVault,
    waitForLanding: extras.waitForLanding !== false,
  });
}

async function enumerateWithdrawalRequests(chainReader, vault, holder) {
  const balanceResult = await chainReader.call(vault, 'balanceOf(address)(uint256)', [holder]);
  const count = Number(balanceResult.decoded?.[0] ?? 0);
  const latestBlock = BigInt(await chainReader.getBlockNumber());

  const ready = [];
  const notReady = [];
  for (let i = 0; i < count; i += 1) {
    const idResult = await chainReader.call(
      vault,
      'tokenOfOwnerByIndex(address,uint256)(uint256)',
      [holder, i],
    );
    const requestId = String(idResult.decoded?.[0]);
    const requestResult = await chainReader.call(
      vault,
      'getWithdrawalRequest(uint256)(bytes,uint256,uint256,address,uint256)',
      [requestId],
    );
    const requestBlock = BigInt(requestResult.decoded?.[4] ?? 0);
    const readyAtBlock = requestBlock + WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY;
    if (latestBlock >= readyAtBlock) {
      ready.push(requestId);
    } else {
      notReady.push({ requestId, readyAtBlock: readyAtBlock.toString() });
    }
  }
  return { count, ready, notReady };
}

async function finalizeAllReady(pool, from, env, signer, verbose, extras) {
  const { count, ready, notReady } = await enumerateWithdrawalRequests(
    pool.chainReader,
    pool.withdrawalVault,
    from,
  );

  if (count === 0) {
    logInfo(`No pending requests for this holder (${from}).`);
    return { mode: 'none', ready: [], notReady: [] };
  }
  if (ready.length === 0) {
    logInfo('No withdrawal requests are ready to finalize yet:');
    for (const entry of notReady) {
      logInfo(`  request ${entry.requestId} becomes ready at block ${entry.readyAtBlock}`);
    }
    return { mode: 'none', ready: [], notReady };
  }
  if (verbose) {
    logInfo(`Finalizing ${ready.length} ready withdrawal request(s): ${ready.join(', ')}`);
    if (notReady.length > 0) {
      for (const entry of notReady) {
        logInfo(`  (leaving request ${entry.requestId} — ready at block ${entry.readyAtBlock})`);
      }
    }
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl: pool.rpcUrl,
    from,
    withdrawalVault: pool.withdrawalVault,
    requestIds: ready,
    chainReader: pool.chainReader,
    signer,
    verbose,
    ...extras,
  };

  const fromBlock =
    signer.mode === 'cold-signing' ? await exclusiveFromBlock(pool.chainReader) : '0x0';

  const result = await awaitConfirmedWrite({
    ctx,
    runTx: () =>
      runTransaction(ctx, {
        label: 'finalizeWithdrawalRequests',
        target: ctx.withdrawalVault,
        signature: 'finalizeWithdrawalRequests(uint256[])',
        buildCalldataArgs: () => [ctx.requestIds],
        decodePreflightError: decodeWithdrawalRevert,
        decodeDryRun: async () => {
          if (verbose) {
            logSuccess(`Preflight OK — finalizeWithdrawalRequests([${ctx.requestIds.join(',')}])`);
          }
        },
      }),
    landedFn: eventLanded(
      pool.chainReader,
      pool.withdrawalVault,
      'unstake.finalizeWithdrawalRequests',
      fromBlock,
    ),
    action: 'unstake.finalizeWithdrawalRequests',
    addresses: { pool: pool.stakingPool, withdrawalVault: pool.withdrawalVault },
    amount: String(ready.length),
    scanAddress: pool.withdrawalVault,
    waitForLanding: extras.waitForLanding !== false,
    deriveReceiptFields: async (hash) => ({
      requestIds: await recoverEventArgsFromReceipt(pool.chainReader, {
        hash,
        address: pool.withdrawalVault,
        eventAbi: RECEIPT_EVENT_ABIS['unstake.finalizeWithdrawalRequests'],
        argName: 'requestId',
      }),
    }),
  });
  return { notReady, ...result };
}

async function requestByAssets(options, pool, from, env, signer, verbose, extras) {
  const { decimal, gwei } = beraToGwei(options.amount, '--amount');
  const feeWei = await resolveFee({
    options,
    chainReader: pool.chainReader,
    vault: pool.withdrawalVault,
  });

  if (verbose) {
    logInfo(`Withdraw: ${decimal} BERA (${gwei} gwei)`);
    logInfo(`EIP-7002 max fee: ${feeWei} wei`);
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl: pool.rpcUrl,
    from,
    withdrawalVault: pool.withdrawalVault,
    pubkey: pool.pubkey,
    gwei,
    feeWei,
    chainReader: pool.chainReader,
    signer,
    verbose,
    ...extras,
  };

  const fromBlock =
    signer.mode === 'cold-signing' ? await exclusiveFromBlock(pool.chainReader) : '0x0';
  const result = await awaitConfirmedWrite({
    ctx,
    runTx: () =>
      runTransaction(ctx, {
        label: 'requestWithdrawal',
        target: ctx.withdrawalVault,
        signature: 'requestWithdrawal(bytes,uint64,uint256)(uint256)',
        value: ctx.feeWei,
        buildCalldataArgs: () => [ctx.pubkey, ctx.gwei, ctx.feeWei],
        decodePreflightError: decodeWithdrawalRevert,
        decodeDryRun: async (_ctx, dryRun) => {
          if (verbose) {
            const requestId = dryRun.decoded?.[0]?.toString?.() ?? '';
            logSuccess(
              `Preflight OK — requestWithdrawal creates NFT${requestId ? ` (preview id ${requestId})` : ''}`,
            );
          }
        },
        beforeEmit: () => {
          if (verbose) {
            logInfo('After the cooldown, finalize with: node pool-cli.mjs unstake --finalize <requestId> (or --finalize with no id, for every ready request)');
          }
        },
      }),
    landedFn: eventLanded(pool.chainReader, pool.withdrawalVault, 'unstake.requestWithdrawal', fromBlock),
    action: 'unstake.requestWithdrawal',
    addresses: { pool: pool.stakingPool, withdrawalVault: pool.withdrawalVault },
    amount: decimal,
    scanAddress: pool.withdrawalVault,
    waitForLanding: extras.waitForLanding !== false,
    deriveReceiptFields: async (hash) => ({
      requestId: (await recoverEventArgsFromReceipt(pool.chainReader, {
        hash,
        address: pool.withdrawalVault,
        eventAbi: RECEIPT_EVENT_ABIS['unstake.requestWithdrawal'],
        argName: 'requestId',
      }))[0],
    }),
  });
  if (result.requestId) {
    logSuccess(`Withdrawal request created: id ${result.requestId}`);
  }
  return result;
}

async function requestByShares(options, pool, from, env, signer, verbose, extras) {
  const { decimal, wei } = beraToWei(options.shares, '--shares');
  const feeWei = await resolveFee({
    options,
    chainReader: pool.chainReader,
    vault: pool.withdrawalVault,
  });

  if (verbose) {
    logInfo(`Redeem: ${decimal} stBERA (${wei} wei)`);
    logInfo(`EIP-7002 max fee: ${feeWei} wei`);
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl: pool.rpcUrl,
    from,
    withdrawalVault: pool.withdrawalVault,
    pubkey: pool.pubkey,
    sharesWei: wei,
    feeWei,
    chainReader: pool.chainReader,
    signer,
    verbose,
    ...extras,
  };

  const fromBlock =
    signer.mode === 'cold-signing' ? await exclusiveFromBlock(pool.chainReader) : '0x0';
  const result = await awaitConfirmedWrite({
    ctx,
    runTx: () =>
      runTransaction(ctx, {
        label: 'requestRedeem',
        target: ctx.withdrawalVault,
        signature: 'requestRedeem(bytes,uint256,uint256)(uint256)',
        value: ctx.feeWei,
        buildCalldataArgs: () => [ctx.pubkey, ctx.sharesWei, ctx.feeWei],
        decodePreflightError: decodeWithdrawalRevert,
        decodeDryRun: async (_ctx, dryRun) => {
          if (verbose) {
            const requestId = dryRun.decoded?.[0]?.toString?.() ?? '';
            logSuccess(
              `Preflight OK — requestRedeem creates NFT${requestId ? ` (preview id ${requestId})` : ''}`,
            );
          }
        },
        beforeEmit: () => {
          if (verbose) {
            logInfo('After the cooldown, finalize with: node pool-cli.mjs unstake --finalize <requestId> (or --finalize with no id, for every ready request)');
          }
        },
      }),
    landedFn: eventLanded(pool.chainReader, pool.withdrawalVault, 'unstake.requestRedeem', fromBlock),
    action: 'unstake.requestRedeem',
    addresses: { pool: pool.stakingPool, withdrawalVault: pool.withdrawalVault },
    amount: decimal,
    scanAddress: pool.withdrawalVault,
    waitForLanding: extras.waitForLanding !== false,
    deriveReceiptFields: async (hash) => ({
      requestId: (await recoverEventArgsFromReceipt(pool.chainReader, {
        hash,
        address: pool.withdrawalVault,
        eventAbi: RECEIPT_EVENT_ABIS['unstake.requestRedeem'],
        argName: 'requestId',
      }))[0],
    }),
  });
  if (result.requestId) {
    logSuccess(`Withdrawal request created: id ${result.requestId}`);
  }
  return result;
}

export async function resolveFee({ options, chainReader, vault }) {
  if (hasValue(options.maxFee)) {
    return beraToWei(options.maxFee, '--max-fee').wei;
  }
  const result = await chainReader.call(vault, 'getWithdrawalRequestFee()(uint256)');
  const fee = result.decoded?.[0];
  if (fee === undefined || fee === null) {
    throw new Error('Could not read the EIP-7002 withdrawal request fee from the vault');
  }
  return String(fee);
}
