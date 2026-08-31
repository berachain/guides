#!/usr/bin/env node
/**
 * VC-5: side-by-side default vs --verbose install output (real anvil + CL-double).
 * Run from apps/staking-pools/install-helpers: node test/vc-drivers/run-vc-5.mjs
 *
 * Captures genuine install console output through deploy + register milestones.
 * Full activate may revert on anvil (fixture proofs); stopping after register is enough
 * for default-vs-verbose contrast per AC-6.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClDouble } from '../helpers/cl-double.mjs';
import { startAnvilFork } from '../helpers/anvil-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-5-output-modes.txt');
const FAKE_BEACOND = join(ROOT, 'helpers/fake-beacond.sh');
const CLI_DIR = join(ROOT, '..');

function randomPubkey() {
  return `0x${Array.from({ length: 48 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('')}`;
}

function runInstallCapture({ verbose, env, stopAfter }) {
  return new Promise((resolve, reject) => {
    const args = verbose ? ['pool-cli.mjs', 'install', '--verbose'] : ['pool-cli.mjs', 'install'];
    const child = spawn('node', args, {
      cwd: CLI_DIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let stopped = false;

    const maybeStop = () => {
      if (stopped || !stopAfter(out)) return;
      stopped = true;
      setTimeout(() => child.kill('SIGTERM'), verbose ? 2500 : 400);
    };

    child.stdout.on('data', (chunk) => {
      out += chunk;
      maybeStop();
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
      maybeStop();
    });

    child.stdin.write('y\n');
    child.stdin.end();

    child.on('close', () => {
      resolve(out);
    });
    child.on('error', reject);
  });
}

async function captureOnce({ verbose, env, cl }) {
  cl.setValidatorIncluded(true);
  return runInstallCapture({
    verbose,
    env,
    stopAfter: (out) => out.includes('Registered (index'),
  });
}

async function main() {
  mkdirSync(dirname(ARTIFACT), { recursive: true });

  const pubkeyDefault = randomPubkey();
  const anvilDefault = await startAnvilFork();
  const clDefault = await createClDouble({
    rpcUrl: anvilDefault.rpcUrl,
    pubkey: pubkeyDefault,
    validatorIndex: '36',
    includeValidator: true,
  });
  const clUrlDefault = await clDefault.listen(13510);

  const baseEnv = {
    ...process.env,
    BEACOND_HOME: '/tmp/beacond-vc5',
    BEACOND_BIN: FAKE_BEACOND,
    CLI_CHAIN: 'bepolia',
  };

  let defaultOut;
  try {
    defaultOut = await captureOnce({
      verbose: false,
      cl: clDefault,
      env: {
        ...baseEnv,
        VC_PUBKEY: pubkeyDefault,
        RPC_URL: anvilDefault.rpcUrl,
        EL_RPC_URL: anvilDefault.rpcUrl,
        CL_NODE_API_URL: clUrlDefault,
        PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      },
    });
  } finally {
    clDefault.close();
    anvilDefault.stop();
  }

  const pubkeyVerbose = randomPubkey();
  const anvilVerbose = await startAnvilFork();
  const clVerbose = await createClDouble({
    rpcUrl: anvilVerbose.rpcUrl,
    pubkey: pubkeyVerbose,
    validatorIndex: '36',
    includeValidator: true,
  });
  const clUrlVerbose = await clVerbose.listen(13511);

  let verboseOut;
  try {
    verboseOut = await captureOnce({
      verbose: true,
      cl: clVerbose,
      env: {
        ...baseEnv,
        VC_PUBKEY: pubkeyVerbose,
        RPC_URL: anvilVerbose.rpcUrl,
        EL_RPC_URL: anvilVerbose.rpcUrl,
        CL_NODE_API_URL: clUrlVerbose,
        PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      },
    });
  } finally {
    clVerbose.close();
    anvilVerbose.stop();
  }

  if (!defaultOut.includes('Deployed.') || !defaultOut.includes('Registered (index')) {
    throw new Error('default install capture missing expected milestone lines');
  }
  if (!verboseOut.includes('Deployed.') || !verboseOut.includes('[info]')) {
    throw new Error('verbose install capture missing expected detail lines');
  }

  const text = [
    '=== VC-5: default vs --verbose install (real anvil bepolia fork + CL-double) ===',
    '',
    '--- DEFAULT (node pool-cli.mjs install) ---',
    defaultOut.trimEnd(),
    '',
    '--- VERBOSE (node pool-cli.mjs install --verbose) ---',
    verboseOut.trimEnd(),
    '',
  ].join('\n');

  writeFileSync(ARTIFACT, text, 'utf8');
  console.log(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
