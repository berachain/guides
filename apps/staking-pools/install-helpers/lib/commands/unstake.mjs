import { createSignerFromEnv } from '../signers.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { resolveFromAddress, resolveOperatorPool } from '../pool-target.mjs';
import { awaitConfirmedWrite } from '../confirmed-write.mjs';
import { exclusiveFromBlock, RECEIPT_EVENT_ABIS, recoverTxHash } from '../receipt-events.mjs';
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
  const hasFinalize = hasValue(options.finalize);
  const count = [hasAmount, hasShares, hasFinalize].filter(Boolean).length;
  if (count !== 1) {
    throw new Error('Pass exactly one of --amount, --shares, or --finalize <requestId>');
  }
  if (hasFinalize) return 'finalize';
  if (hasAmount) return 'assets';
  return 'shares';
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
  const requestId = String(options.finalize).trim();
  if (!/^[0-9]+$/.test(requestId)) {
    throw new Error('--finalize must be a request id (uint256)');
  }

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
  return awaitConfirmedWrite({
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
            logInfo('After the cooldown, finalize with: node pool-cli.mjs unstake --finalize <requestId>');
          }
        },
      }),
    landedFn: eventLanded(pool.chainReader, pool.withdrawalVault, 'unstake.requestWithdrawal', fromBlock),
    action: 'unstake.requestWithdrawal',
    addresses: { pool: pool.stakingPool, withdrawalVault: pool.withdrawalVault },
    amount: decimal,
    scanAddress: pool.withdrawalVault,
    waitForLanding: extras.waitForLanding !== false,
  });
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
  return awaitConfirmedWrite({
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
            logInfo('After the cooldown, finalize with: node pool-cli.mjs unstake --finalize <requestId>');
          }
        },
      }),
    landedFn: eventLanded(pool.chainReader, pool.withdrawalVault, 'unstake.requestRedeem', fromBlock),
    action: 'unstake.requestRedeem',
    addresses: { pool: pool.stakingPool, withdrawalVault: pool.withdrawalVault },
    amount: decimal,
    scanAddress: pool.withdrawalVault,
    waitForLanding: extras.waitForLanding !== false,
  });
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
