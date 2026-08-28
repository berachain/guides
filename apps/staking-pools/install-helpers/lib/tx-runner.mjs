import {
  runCast,
  buildWalletArgs,
  buildEmitWalletArgs,
  formatCastCommand,
} from './cast.mjs';
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

  const calldataArgs = buildCalldataArgs(ctx);
  const dryRunArgv = [
    'call',
    target,
    signature,
    ...calldataArgs,
    '-r',
    ctx.rpcUrl,
  ];
  if (value) {
    dryRunArgv.push('--value', value);
  }

  logInfo(`Preflighting ${label} via cast call...`);
  const dryRun = runCast(dryRunArgv, { env: ctx.env });
  ctx.lastDryRunArgv = ['cast', ...dryRunArgv];

  if (dryRun.status !== 0) {
    const message = (dryRun.stderr || dryRun.stdout).trim() || `${label} preflight failed`;
    const decoded = decodePreflightError ? decodePreflightError(message) : message;
    throw new Error(decoded);
  }

  if (decodeDryRun) {
    await decodeDryRun(ctx, dryRun);
  } else {
    logSuccess(`${label} preflight OK`);
  }

  if (beforeEmit) {
    beforeEmit(ctx);
  }

  const emitArgv = buildEmitSendArgv(
    target,
    signature,
    calldataArgs,
    ctx.rpcUrl,
    ctx.env,
    value,
  );
  ctx.lastSendArgv = ['cast', ...emitArgv];
  logInfo('Copy and run on your signing machine (ledger on laptop):');
  console.log(formatCastCommand(emitArgv));
  console.log('');

  if (!ctx.execute) {
    return { mode: 'emit', dryRunArgv: ctx.lastDryRunArgv, sendArgv: ctx.lastSendArgv };
  }

  if (!ctx.env.PRIVATE_KEY?.trim()) {
    logWarn(
      'Refusing --execute without PRIVATE_KEY on this host. Use the emitted cast send on a signing machine.',
    );
    return {
      mode: 'emit',
      executeRefused: true,
      dryRunArgv: ctx.lastDryRunArgv,
      sendArgv: ctx.lastSendArgv,
    };
  }

  if (beforeExecute) {
    beforeExecute(ctx);
  }

  const sendArgv = [
    'send',
    target,
    signature,
    ...calldataArgs,
    '-r',
    ctx.rpcUrl,
    ...buildWalletArgs(ctx.env),
  ];
  if (value) {
    sendArgv.push('--value', value);
  }

  logInfo(`Broadcasting ${label} via cast send (hot key on validator)...`);
  const send = runCast(sendArgv, { env: ctx.env });
  ctx.lastExecuteArgv = ['cast', ...sendArgv];

  if (send.status !== 0) {
    throw new Error(send.stderr || send.stdout || `${label} broadcast failed`);
  }

  const txHash = extractTxHash(send.stdout + send.stderr);
  if (onExecuteSuccess) {
    onExecuteSuccess(ctx, txHash, send);
  } else if (txHash) {
    logSuccess(`${label} broadcast: ${txHash}`);
  } else {
    logSuccess(`${label} broadcast complete`);
    process.stdout.write(send.stdout);
  }

  return {
    mode: 'execute',
    dryRunArgv: ctx.lastDryRunArgv,
    sendArgv: ctx.lastSendArgv,
    executeArgv: ctx.lastExecuteArgv,
    txHash,
  };
}

function extractTxHash(output) {
  const match = String(output).match(/0x[0-9a-fA-F]{64}/);
  return match ? match[0] : '';
}

export function buildCallOnlyArgv(target, signature, calldataArgs, rpcUrl, value) {
  const argv = ['call', target, signature, ...calldataArgs, '-r', rpcUrl];
  if (value) argv.push('--value', value);
  return argv;
}

export function buildEmitSendArgv(target, signature, calldataArgs, rpcUrl, env, value) {
  const argv = [
    'send',
    target,
    signature,
    ...calldataArgs,
    '-r',
    rpcUrl,
    ...buildEmitWalletArgs(env),
  ];
  if (value) argv.push('--value', value);
  return argv;
}

export function buildSendArgv(target, signature, calldataArgs, rpcUrl, env, value) {
  const argv = [
    'send',
    target,
    signature,
    ...calldataArgs,
    '-r',
    rpcUrl,
    ...buildWalletArgs(env),
  ];
  if (value) argv.push('--value', value);
  return argv;
}
