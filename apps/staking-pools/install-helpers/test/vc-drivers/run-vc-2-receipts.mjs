#!/usr/bin/env node
/**
 * VC-2 — cold-signing receipts only after landing. Implementation Review from worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-vc-2-receipts.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAnvilFork } from '../helpers/anvil-harness.mjs';
import { readReceipts } from '../../lib/receipts.mjs';

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(DRIVER_DIR, '../..');
const ARTIFACT_DIR = join(DRIVER_DIR, '../vc-artifacts');
const FAKE_BEACOND = join(DRIVER_DIR, '../helpers/fake-beacond.sh');
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCastSend(out) {
  const line = out.split('\n').find((row) => row.startsWith('cast send '));
  if (!line) {
    throw new Error('pool-cli deploy did not print a cast send');
  }
  return line.trim();
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const receiptsPath = join(ARTIFACT_DIR, 'vc-2-receipts.jsonl');
  rmSync(receiptsPath, { force: true });
  const pubkey = `0x${'ab'.repeat(48)}`;
  const anvil = await startAnvilFork({ configureProofFixtures: false });

  const env = { ...process.env };
  delete env.PRIVATE_KEY;
  Object.assign(env, {
    BEACOND_HOME: '/tmp/beacond-vc2-receipts',
    BEACOND_BIN: FAKE_BEACOND,
    VC_PUBKEY: pubkey,
    CLI_CHAIN: 'bepolia',
    RPC_URL: anvil.rpcUrl,
    EL_RPC_URL: anvil.rpcUrl,
    RECEIPTS_PATH: receiptsPath,
  });

  const child = spawn(
    'node',
    ['pool-cli.mjs', 'deploy', '--op', ANVIL_ADDR, '--sr', ANVIL_ADDR],
    { cwd: HELPERS, env, stdio: ['ignore', 'pipe', 'pipe'] },
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

  const started = Date.now();
  while (!out.includes('cast send ')) {
    if (Date.now() - started > 60000) {
      child.kill('SIGTERM');
      throw new Error('timed out waiting for pool-cli deploy to print cast send');
    }
    await sleep(50);
  }

  await sleep(2000);
  const beforeLand = readReceipts(receiptsPath);
  if (beforeLand.length !== 0) {
    child.kill('SIGTERM');
    throw new Error(`VC-2 wrote ${beforeLand.length} receipt(s) at print-time`);
  }

  const printed = extractCastSend(out);
  const landCmd = printed.replace(/--ledger\b/, `--private-key ${ANVIL_KEY}`);
  const landed = spawnSync('sh', ['-c', landCmd], { encoding: 'utf8' });
  if (landed.status !== 0) {
    child.kill('SIGTERM');
    throw new Error(`landing printed cast send failed: ${landed.stderr || landed.stdout}`);
  }

  const code = await new Promise((resolve) => child.on('close', resolve));
  anvil.stop();

  writeFileSync(join(ARTIFACT_DIR, 'vc-2-cold-signing.txt'), `${out}\n--- landed ---\n${landed.stdout}`, 'utf8');
  if (code !== 0) {
    throw new Error(`pool-cli deploy exited ${code} after landing`);
  }

  const records = readReceipts(receiptsPath);
  if (records.length !== 1 || records[0].action !== 'deploy') {
    throw new Error(`VC-2 expected one deploy receipt, got ${JSON.stringify(records)}`);
  }
  const hashMatch = (landed.stdout || '').match(/transactionHash\s+(0x[0-9a-fA-F]{64})/i);
  if (!hashMatch) {
    throw new Error(`VC-2 could not parse transactionHash from cast send output:\n${landed.stdout}`);
  }
  if (records[0].hash.toLowerCase() !== hashMatch[1].toLowerCase()) {
    throw new Error(`VC-2 recovered hash ${records[0].hash} != landed ${hashMatch[1]}`);
  }
  writeFileSync(
    join(ARTIFACT_DIR, 'vc-2-verified.txt'),
    [
      'print_time_receipts=0',
      `after_land_receipts=${records.length}`,
      `action=${records[0].action}`,
      `hash=${records[0].hash}`,
      `landed_hash=${hashMatch[1]}`,
    ].join('\n'),
    'utf8',
  );
  console.log('VC-2 verified: no print-time receipt; one deploy receipt after landing.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
