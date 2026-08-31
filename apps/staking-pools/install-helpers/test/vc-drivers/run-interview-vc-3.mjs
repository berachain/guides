#!/usr/bin/env node
/**
 * VC-3 — non-TTY refusal when exactly one fact is missing.
 * Worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-interview-vc-3.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPERS = join(ROOT, '..');
const ARTIFACT_DIR = join(ROOT, 'vc-artifacts');
const OUT = join(ARTIFACT_DIR, 'vc-interview-3-nontty-refusal.txt');
const FAKE_BEACOND = join(ROOT, 'helpers/fake-beacond.sh');

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const child = spawn(
    'node',
    ['pool-cli.mjs', 'install'],
    {
      cwd: HELPERS,
      env: {
        ...process.env,
        BEACOND_HOME: '/tmp/beacond-vc3',
        BEACOND_BIN: FAKE_BEACOND,
        CLI_CHAIN: 'bepolia',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  child.stdin.end();

  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    out += chunk;
    process.stderr.write(chunk);
  });

  const timedOut = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(true);
    }, 8000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

  writeFileSync(OUT, out, 'utf8');

  if (timedOut) {
    throw new Error('VC-3 hung on non-TTY stdin');
  }
  if (!/Non-interactive stdin cannot prompt/i.test(out)) {
    throw new Error(`VC-3 missing named refusal:\n${out}`);
  }
  if (!/--funding-address/.test(out)) {
    throw new Error(`VC-3 did not name --funding-address:\n${out}`);
  }
  if (/--signing-preference/.test(out)) {
    throw new Error(`VC-3 must not name --signing-preference (Phase A drops it as a missing fact):\n${out}`);
  }
  if (/Proceed\?/i.test(out)) {
    throw new Error('VC-3 reached confirmation');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
