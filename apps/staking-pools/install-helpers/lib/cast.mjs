import { spawnSync } from 'node:child_process';
import { assertNoForbiddenCommands } from './deps.mjs';
import { parseProofSlot } from './proofs.mjs';

let castRunner = null;

export function setCastRunner(runner) {
  castRunner = runner;
}

export function getCastRunner() {
  return castRunner ?? defaultCastRunner;
}

function defaultCastRunner(argv, options = {}) {
  assertNoForbiddenCommands(['cast', ...argv]);
  const result = spawnSync('cast', argv, {
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    argv: ['cast', ...argv],
  };
}

export function runCast(argv, options = {}) {
  return getCastRunner()(argv, options);
}

export function buildEmitWalletArgs() {
  return ['--ledger'];
}

export function buildWalletArgs(env = process.env) {
  const privateKey = env.PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required for --execute');
  }
  return ['--private-key', privateKey];
}

export function parseCastTuple(raw) {
  const normalized = String(raw)
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .trim();
  return normalized
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function stripScientificNotation(raw) {
  const first = String(raw ?? '').trim().split(/\s+/)[0];
  if (/^-?[0-9]+(\.[0-9]+)?[eE][+-]?[0-9]+$/.test(first)) {
    return BigInt(Math.round(Number(first))).toString();
  }
  return first;
}

export async function castFromWei(wei, unit = 'ether') {
  const result = runCast(['from-wei', stripScientificNotation(wei), unit]);
  if (result.status !== 0) {
    return stripScientificNotation(wei);
  }
  return result.stdout.trim();
}

export function formatCastCommand(argv) {
  return ['cast', ...argv].join(' ');
}

export function unwrapCastJson(raw) {
  const parsed = JSON.parse(String(raw ?? '').trim() || 'null');
  if (parsed && typeof parsed === 'object' && 'schema_version' in parsed) {
    if (parsed.success === false) {
      const errors = Array.isArray(parsed.errors) ? parsed.errors.filter(Boolean).join('; ') : '';
      throw new Error(errors || 'cast --json returned success=false');
    }
    return parsed.data;
  }
  return parsed;
}

export function parseCastBlockNumber(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new Error('cast block-number returned empty output');
  }
  if (trimmed.startsWith('{')) {
    const data = unwrapCastJson(trimmed);
    if (data && typeof data === 'object' && data.number != null) {
      return parseProofSlot(data.number);
    }
    return parseProofSlot(data);
  }
  return parseProofSlot(trimmed.split(/\s+/)[0]);
}
