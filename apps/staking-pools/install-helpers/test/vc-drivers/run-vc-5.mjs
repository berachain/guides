#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-5-output-modes.txt');

async function capture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['pool-cli.mjs', ...args], {
      cwd: join(ROOT, '..'),
      env: { ...process.env, BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => {
      if (code !== 0 && !args.includes('--help')) reject(new Error(out));
      else resolve(out);
    });
  });
}

async function main() {
  mkdirSync(dirname(ARTIFACT), { recursive: true });
  const help = await capture(['--help']);
  const text = [
    '=== VC-5 output modes (install --help shows milestone vs verbose flags) ===',
    '',
    '--- default install milestone shape (from installation.mdx) ---',
    'Deployed. Predicted pool: 0x...',
    'Waiting for validator registration...',
    'Registered (index N).',
    'Activated.',
    'Staked N BERA.',
    'Done.',
    '',
    '--- verbose flag surface ---',
    help,
  ].join('\n');
  writeFileSync(ARTIFACT, text, 'utf8');
  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
