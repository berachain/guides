import { ethers } from './ethers-bundle.mjs';
import { ethCallRevertData } from './chain-reader.mjs';
import { logInfo, logSuccess, logWarn } from './log.mjs';

export const SHARED_TX_RUNNER = Symbol('shared-tx-runner');

let lastRunnerId = SHARED_TX_RUNNER;

export function getSharedTxRunnerId() {
  return lastRunnerId;
}

export async function runTransaction(ctx, descriptor) {
  lastRunnerId = SHARED_TX_RUNNER;
  const {
    label,
    target,
    signature,
    value,
    buildCalldataArgs,
    prelude,
    decodeDryRun,
    decodePreflightError,
    beforeEmit,
    beforeExecute,
    onExecuteSuccess,
  } = descriptor;

  if (prelude) {
    await prelude(ctx);
  }

  const chainReader = ctx.chainReader;
  if (!chainReader) {
    throw new Error('ctx.chainReader is required');
  }
  const signer = ctx.signer;
  if (!signer) {
    throw new Error('ctx.signer is required');
  }

  const args = buildCalldataArgs(ctx);
  const callOptions = {};
  if (ctx.from) callOptions.from = ctx.from;
  const txValue = parseTxValue(value);
  if (txValue > 0n) callOptions.value = txValue;

  if (ctx.verbose) {
    logInfo(`Preflighting ${label} via eth_call...`);
  }

  const preflight = await ethCallRevertData(
    chainReader.rpcUrl,
    target,
    signature,
    args,
    callOptions,
    chainReader.fetchImpl,
  );

  ctx.lastDryRunArgs = { target, signature, args, value: txValue };

  if (!preflight.ok) {
    const message = (preflight.message || '').trim() || `${label} preflight failed`;
    const decoded = decodePreflightError ? decodePreflightError(message) : message;
    throw new Error(decoded);
  }

  if (decodeDryRun) {
    await decodeDryRun(ctx, preflight);
  } else if (ctx.verbose) {
    logSuccess(`${label} preflight OK`);
  }

  if (signer.mode === 'cold-signing') {
    if (beforeEmit) {
      beforeEmit(ctx);
    }
    const command = signer.emitCastSend({
      target,
      signature,
      args,
      value: txValue,
    });
    ctx.lastSendCommand = command;
    return { mode: 'emit', command, args, sendArgv: command.split(' ') };
  }

  if (!ctx.env.PRIVATE_KEY?.trim()) {
    logWarn('Refusing broadcast without PRIVATE_KEY on this host.');
    return { mode: 'emit', args };
  }

  if (beforeExecute) {
    beforeExecute(ctx);
  }

  const result = await signer.broadcast({
    target,
    signature,
    args,
    value: txValue,
    label,
    verbose: ctx.verbose,
  });

  if (onExecuteSuccess) {
    onExecuteSuccess(ctx, result.hash, result);
  } else if (ctx.verbose && result.hash) {
    logSuccess(`${label} broadcast: ${result.hash}`);
  }

  return { mode: 'execute', hash: result.hash, args };
}

function parseTxValue(value) {
  if (!value) return 0n;
  if (typeof value === 'bigint') return value;
  const raw = String(value).trim();
  if (raw.endsWith('ether')) {
    return ethers.parseEther(raw.replace(/ether$/, ''));
  }
  return BigInt(raw);
}
