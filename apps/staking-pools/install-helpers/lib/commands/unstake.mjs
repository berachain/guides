import { WITHDRAWAL_FEE_CANDIDATES_WEI } from '../constants.mjs';
import { runCast } from '../cast.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { resolveFromAddress, resolveOperatorPool } from '../pool-target.mjs';
import { decodeWithdrawalRevert } from '../revert-decoder.mjs';
import { runTransaction } from '../tx-runner.mjs';
import { beraToGwei, beraToWei } from '../units.mjs';

export async function runUnstake(options) {
  const env = options.env ?? process.env;
  const mode = resolveUnstakeMode(options);
  const pool = resolveOperatorPool(options, env);
  const from = resolveFromAddress(options, env);

  assertPoolActive(pool.stakingPool, pool.rpcUrl, env);

  logInfo(`Staking pool: ${pool.stakingPool}`);
  logInfo(`Withdrawal vault: ${pool.withdrawalVault}`);
  logInfo(`From (stBERA holder): ${from}`);

  if (mode === 'finalize') {
    return finalizeRequest(options, pool, from, env);
  }
  if (mode === 'assets') {
    return requestByAssets(options, pool, from, env);
  }
  return requestByShares(options, pool, from, env);
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

function assertPoolActive(stakingPool, rpcUrl, env) {
  const result = runCast(['call', stakingPool, 'isActive()(bool)', '-r', rpcUrl], { env });
  if (result.status !== 0 || result.stdout.trim() !== 'true') {
    throw new Error('Pool is not active. Cannot request withdrawal.');
  }
}

async function finalizeRequest(options, pool, from, env) {
  const requestId = String(options.finalize).trim();
  if (!/^[0-9]+$/.test(requestId)) {
    throw new Error('--finalize must be a request id (uint256)');
  }

  logInfo(`Finalize withdrawal request: ${requestId}`);

  const ctx = {
    execute: options.execute,
    env,
    rpcUrl: pool.rpcUrl,
    from,
    withdrawalVault: pool.withdrawalVault,
    requestId,
  };

  return runTransaction(ctx, {
    label: 'finalizeWithdrawalRequest',
    target: ctx.withdrawalVault,
    signature: 'finalizeWithdrawalRequest(uint256)',
    buildCalldataArgs: () => [ctx.requestId],
    decodePreflightError: decodeWithdrawalRevert,
    decodeDryRun: async () => {
      logSuccess(`Preflight OK — finalizeWithdrawalRequest(${ctx.requestId})`);
    },
  });
}

async function requestByAssets(options, pool, from, env) {
  const { decimal, gwei } = beraToGwei(options.amount, '--amount');
  const feeWei = resolveFee({
    options,
    env,
    from,
    vault: pool.withdrawalVault,
    rpcUrl: pool.rpcUrl,
    signature: 'requestWithdrawal(bytes,uint64,uint256)(uint256)',
    argsBeforeFee: [pool.pubkey, gwei],
  });

  logInfo(`Withdraw: ${decimal} BERA (${gwei} gwei)`);
  logInfo(`EIP-7002 max fee: ${feeWei} wei`);

  const ctx = {
    execute: options.execute,
    env,
    rpcUrl: pool.rpcUrl,
    from,
    withdrawalVault: pool.withdrawalVault,
    pubkey: pool.pubkey,
    gwei,
    feeWei,
  };

  return runTransaction(ctx, {
    label: 'requestWithdrawal',
    target: ctx.withdrawalVault,
    signature: 'requestWithdrawal(bytes,uint64,uint256)(uint256)',
    value: ctx.feeWei,
    buildCalldataArgs: () => [ctx.pubkey, ctx.gwei, ctx.feeWei],
    decodePreflightError: decodeWithdrawalRevert,
    decodeDryRun: async (_ctx, dryRun) => {
      const requestId = dryRun.stdout.trim();
      logSuccess(
        `Preflight OK — requestWithdrawal creates NFT${requestId ? ` (preview id ${requestId})` : ''}`,
      );
    },
    beforeEmit: () => {
      logInfo('After the cooldown, finalize with: node pool-cli.mjs unstake --finalize <requestId>');
    },
  });
}

async function requestByShares(options, pool, from, env) {
  const { decimal, wei } = beraToWei(options.shares, '--shares');
  const feeWei = resolveFee({
    options,
    env,
    from,
    vault: pool.withdrawalVault,
    rpcUrl: pool.rpcUrl,
    signature: 'requestRedeem(bytes,uint256,uint256)(uint256)',
    argsBeforeFee: [pool.pubkey, wei],
  });

  logInfo(`Redeem: ${decimal} stBERA (${wei} wei)`);
  logInfo(`EIP-7002 max fee: ${feeWei} wei`);

  const ctx = {
    execute: options.execute,
    env,
    rpcUrl: pool.rpcUrl,
    from,
    withdrawalVault: pool.withdrawalVault,
    pubkey: pool.pubkey,
    sharesWei: wei,
    feeWei,
  };

  return runTransaction(ctx, {
    label: 'requestRedeem',
    target: ctx.withdrawalVault,
    signature: 'requestRedeem(bytes,uint256,uint256)(uint256)',
    value: ctx.feeWei,
    buildCalldataArgs: () => [ctx.pubkey, ctx.sharesWei, ctx.feeWei],
    decodePreflightError: decodeWithdrawalRevert,
    decodeDryRun: async (_ctx, dryRun) => {
      const requestId = dryRun.stdout.trim();
      logSuccess(
        `Preflight OK — requestRedeem creates NFT${requestId ? ` (preview id ${requestId})` : ''}`,
      );
    },
    beforeEmit: () => {
      logInfo('After the cooldown, finalize with: node pool-cli.mjs unstake --finalize <requestId>');
    },
  });
}

function resolveFee({ options, env, from, vault, rpcUrl, signature, argsBeforeFee }) {
  if (hasValue(options.maxFee)) {
    return beraToWei(options.maxFee, '--max-fee').wei;
  }
  return probeWithdrawalFee({ env, from, vault, rpcUrl, signature, argsBeforeFee });
}

export function probeWithdrawalFee({ env, from, vault, rpcUrl, signature, argsBeforeFee }) {
  let lastError = '';
  for (const fee of WITHDRAWAL_FEE_CANDIDATES_WEI) {
    const result = runCast(
      [
        'call',
        vault,
        signature,
        ...argsBeforeFee,
        fee,
        '-r',
        rpcUrl,
        '--from',
        from,
        '--value',
        fee,
      ],
      { env },
    );
    if (result.status === 0) {
      return fee;
    }
    lastError = (result.stderr || result.stdout).trim();
  }
  throw new Error(
    decodeWithdrawalRevert(lastError) ||
      'Could not find a sufficient EIP-7002 fee (tried up to 0.01 BERA). Pass --max-fee.',
  );
}
