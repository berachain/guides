#!/usr/bin/env node
/**
 * VC-3 — kill during deposited_awaiting_registration. Implementation Review from worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-vc-3-receipts.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClDouble } from '../helpers/cl-double.mjs';
import { startAnvilFork } from '../helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from '../helpers/validator-proof-fixtures.mjs';
import { readReceipts } from '../../lib/receipts.mjs';

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(DRIVER_DIR, '../..');
const ARTIFACT_DIR = join(DRIVER_DIR, '../vc-artifacts');
const FAKE_BEACOND = join(DRIVER_DIR, '../helpers/fake-beacond.sh');
const FIXTURE_PUBKEY = loadValidatorProofFixtures().pubkey;
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const receiptsPath = join(ARTIFACT_DIR, 'vc-3-receipts.jsonl');
  rmSync(receiptsPath, { force: true });
  const anvil = await startAnvilFork();
  const cl = await createClDouble({
    rpcUrl: anvil.rpcUrl,
    pubkey: FIXTURE_PUBKEY,
    includeValidator: false,
  });
  const clUrl = await cl.listen(13531);

  const env = {
    ...process.env,
    BEACOND_HOME: '/tmp/beacond-vc3-receipts',
    BEACOND_BIN: FAKE_BEACOND,
    VC_PUBKEY: FIXTURE_PUBKEY,
    CLI_CHAIN: 'bepolia',
    RPC_URL: anvil.rpcUrl,
    EL_RPC_URL: anvil.rpcUrl,
    CL_NODE_API_URL: clUrl,
    PRIVATE_KEY: ANVIL_KEY,
    RECEIPTS_PATH: receiptsPath,
  };

  const child = spawn(
    'node',
    [
      'pool-cli.mjs',
      'install',
      '--operator',
      ANVIL_ADDR,
      '--shares-recipient',
      ANVIL_ADDR,
    ],
    { cwd: HELPERS, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
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

  const started = Date.now();
  while (!out.includes('Waiting for validator registration')) {
    if (Date.now() - started > 120000) {
      child.kill('SIGTERM');
      throw new Error('timed out waiting for deposited_awaiting_registration');
    }
    await sleep(50);
  }

  const beforeKill = readReceipts(receiptsPath);
  writeFileSync(join(ARTIFACT_DIR, 'vc-3-before-kill.jsonl'), readFileSync(receiptsPath, 'utf8'));
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('close', resolve));
  cl.close();
  anvil.stop();

  const afterKill = readReceipts(receiptsPath);
  const raw = readFileSync(receiptsPath, 'utf8');
  writeFileSync(join(ARTIFACT_DIR, 'vc-3-after-kill.jsonl'), raw);
  writeFileSync(join(ARTIFACT_DIR, 'vc-3-install.txt'), out, 'utf8');

  if (beforeKill.length !== 1 || beforeKill[0].action !== 'deploy') {
    throw new Error(`VC-3 before kill expected one deploy receipt, got ${JSON.stringify(beforeKill)}`);
  }
  if (afterKill.length !== 1 || afterKill[0].action !== 'deploy') {
    throw new Error(`VC-3 after kill expected one deploy receipt, got ${JSON.stringify(afterKill)}`);
  }
  const lines = raw.split('\n').filter((line) => line.trim());
  if (lines.length !== 1) {
    throw new Error(`VC-3 raw file has ${lines.length} non-empty lines`);
  }
  JSON.parse(lines[0]);
  if (afterKill[0].hash.toLowerCase() !== beforeKill[0].hash.toLowerCase()) {
    throw new Error('VC-3 kill mutated the deploy receipt hash');
  }
  writeFileSync(
    join(ARTIFACT_DIR, 'vc-3-verified.txt'),
    [
      `before_kill=${beforeKill.length}`,
      `after_kill=${afterKill.length}`,
      `action=${afterKill[0].action}`,
      `hash=${afterKill[0].hash}`,
      'parse=ok',
    ].join('\n'),
    'utf8',
  );
  console.log('VC-3 verified: exactly one well-formed deploy receipt before and after kill.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
