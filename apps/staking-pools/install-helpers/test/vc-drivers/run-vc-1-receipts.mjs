#!/usr/bin/env node
/**
 * VC-1 — hot-key install receipts. Implementation Review from worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-vc-1-receipts.mjs
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

function spawnInstall(env) {
  return new Promise((resolve, reject) => {
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
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', reject);
  });
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const receiptsPath = join(ARTIFACT_DIR, 'vc-1-receipts.jsonl');
  rmSync(receiptsPath, { force: true });
  const anvil = await startAnvilFork();
  const cl = await createClDouble({
    rpcUrl: anvil.rpcUrl,
    pubkey: FIXTURE_PUBKEY,
    includeValidator: false,
  });
  const clUrl = await cl.listen(13521);
  setTimeout(() => cl.setValidatorIncluded(true), 8000);

  const env = {
    ...process.env,
    BEACOND_HOME: '/tmp/beacond-vc1-receipts',
    BEACOND_BIN: FAKE_BEACOND,
    VC_PUBKEY: FIXTURE_PUBKEY,
    CLI_CHAIN: 'bepolia',
    RPC_URL: anvil.rpcUrl,
    EL_RPC_URL: anvil.rpcUrl,
    CL_NODE_API_URL: clUrl,
    PRIVATE_KEY: ANVIL_KEY,
    RECEIPTS_PATH: receiptsPath,
  };

  let result;
  try {
    result = await spawnInstall(env);
  } finally {
    cl.close();
    anvil.stop();
  }

  writeFileSync(join(ARTIFACT_DIR, 'vc-1-receipts-install.txt'), result.out, 'utf8');
  if (result.code !== 0) {
    throw new Error(`pool-cli install exited ${result.code}`);
  }
  if (!result.out.includes('Deployed.') || !result.out.includes('Activated.') || !result.out.includes('Done.')) {
    throw new Error('VC-1 terminal missing Deployed./Activated./Done.');
  }

  const records = readReceipts(receiptsPath);
  const actions = records.map((row) => row.action);
  if (actions.join(',') !== 'deploy,activate,stake') {
    throw new Error(`VC-1 receipts actions were ${actions.join(',')}, expected deploy,activate,stake`);
  }
  for (const row of records) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(row.hash)) {
      throw new Error(`VC-1 ${row.action} hash is not a 32-byte hex: ${row.hash}`);
    }
    if (!row.addresses?.pool || !row.timestamp) {
      throw new Error(`VC-1 ${row.action} missing pool address or timestamp`);
    }
  }
  writeFileSync(
    join(ARTIFACT_DIR, 'vc-1-receipts-verified.txt'),
    [
      `records=${records.length}`,
      `actions=${actions.join(',')}`,
      ...records.map((row) => `${row.action} ${row.hash} pool=${row.addresses.pool} amount=${row.amount}`),
    ].join('\n'),
    'utf8',
  );
  console.log(readFileSync(join(ARTIFACT_DIR, 'vc-1-receipts-verified.txt'), 'utf8'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
