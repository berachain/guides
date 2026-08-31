#!/usr/bin/env node
/**
 * VC-5: side-by-side default vs --verbose install output (real anvil + CL-double).
 * Run from apps/staking-pools/install-helpers: node test/vc-drivers/run-vc-5.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClDouble } from '../helpers/cl-double.mjs';
import { startAnvilFork } from '../helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from '../helpers/validator-proof-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-5-output-modes.txt');
const FAKE_BEACOND = join(ROOT, 'helpers/fake-beacond.sh');
const CLI_DIR = join(ROOT, '..');
const FIXTURE_PUBKEY = loadValidatorProofFixtures().pubkey;

function runInstallCapture({ verbose, env, cl }) {
  return new Promise((resolve, reject) => {
    cl.setValidatorIncluded(true);
    const args = verbose ? ['pool-cli.mjs', 'install', '--verbose'] : ['pool-cli.mjs', 'install'];
    const child = spawn('node', args, {
      cwd: CLI_DIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });

    child.stdin.write('y\n');
    child.stdin.end();

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${verbose ? 'verbose' : 'default'} install exited ${code}:\n${out}`));
        return;
      }
      resolve(out);
    });
    child.on('error', reject);
  });
}

async function captureMode({ verbose }) {
  const anvil = await startAnvilFork();
  const cl = await createClDouble({
    rpcUrl: anvil.rpcUrl,
    pubkey: FIXTURE_PUBKEY,
    includeValidator: false,
  });
  const clUrl = await cl.listen(verbose ? 13511 : 13510);

  setTimeout(() => cl.setValidatorIncluded(true), 8000);

  const baseEnv = {
    ...process.env,
    BEACOND_HOME: '/tmp/beacond-vc5',
    BEACOND_BIN: FAKE_BEACOND,
    VC_PUBKEY: FIXTURE_PUBKEY,
    CLI_CHAIN: 'bepolia',
    RPC_URL: anvil.rpcUrl,
    EL_RPC_URL: anvil.rpcUrl,
    CL_NODE_API_URL: clUrl,
    PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  };

  try {
    return await runInstallCapture({ verbose, env: baseEnv, cl });
  } finally {
    cl.close();
    anvil.stop();
  }
}

async function main() {
  mkdirSync(dirname(ARTIFACT), { recursive: true });

  const defaultOut = await captureMode({ verbose: false });
  const verboseOut = await captureMode({ verbose: true });

  if (!defaultOut.includes('Deployed.') || !defaultOut.includes('Done.')) {
    throw new Error('default install capture missing expected milestone lines through Done.');
  }
  if (!verboseOut.includes('Deployed.') || !verboseOut.includes('[info]') || !verboseOut.includes('Done.')) {
    throw new Error('verbose install capture missing expected detail lines through Done.');
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
