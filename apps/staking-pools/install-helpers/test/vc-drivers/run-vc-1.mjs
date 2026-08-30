#!/usr/bin/env node
/**
 * VC driver scaffold — Implementation Review runs from worktree root:
 *   node test/vc-drivers/run-vc-1.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClDouble } from '../helpers/cl-double.mjs';
import {
  startAnvilFork,
} from '../helpers/anvil-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = join(ROOT, 'vc-artifacts');
const FAKE_BEACOND = join(ROOT, 'helpers/fake-beacond.sh');

function randomPubkey() {
  return `0x${Array.from({ length: 48 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('')}`;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const pubkey = randomPubkey();
  const anvil = await startAnvilFork();
  const cl = await createClDouble({
    rpcUrl: anvil.rpcUrl,
    pubkey,
    validatorIndex: '36',
    includeValidator: false,
  });
  const clUrl = await cl.listen(13501);

  // Simulate beacon inclusion after deploy phase would wait
  setTimeout(() => cl.setValidatorIncluded(true), 8000);

  const env = {
    ...process.env,
    BEACOND_HOME: '/tmp/beacond-vc1',
    BEACOND_BIN: FAKE_BEACOND,
    VC_PUBKEY: pubkey,
    CLI_CHAIN: 'bepolia',
    RPC_URL: anvil.rpcUrl,
    CL_NODE_API_URL: clUrl,
    PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  };

  const child = spawn('node', ['pool-cli.mjs', 'install'], {
    cwd: join(ROOT, '..'),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    out += chunk;
    process.stderr.write(chunk);
  });

  child.stdin.write('y\n');
  child.stdin.end();

  const code = await new Promise((resolve) => child.on('close', resolve));
  writeFileSync(join(ARTIFACT_DIR, 'vc-1-hotkey-install.txt'), out, 'utf8');

  cl.close();
  anvil.stop();

  if (code !== 0) {
    process.exit(code ?? 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
