#!/usr/bin/env node
/**
 * VC-2 — scenario-file write, resume, and mismatch (anvil). Integration-shaped.
 * Worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-interview-vc-2.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWithdrawalVault } from '../../lib/beacond.mjs';
import { createChainReader } from '../../lib/chain-reader.mjs';
import { runInstall } from '../../lib/commands/install.mjs';
import { DEPOSIT_AMOUNT_GWEI } from '../../lib/constants.mjs';
import { createClDouble } from '../helpers/cl-double.mjs';
import { startAnvilFork } from '../helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from '../helpers/validator-proof-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = join(ROOT, 'vc-artifacts');
const OUT = join(ARTIFACT_DIR, 'vc-interview-2-scenario.txt');
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OPERATOR = `0x${'11'.repeat(20)}`;
const SHARES = `0x${'22'.repeat(20)}`;

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const lines = [];
  const log = (line = '') => {
    lines.push(line);
    console.log(line);
  };

  const fixtures = loadValidatorProofFixtures();
  const pubkey = fixtures.pubkey;
  const dir = mkdtempSync(join(tmpdir(), 'vc2-scenario-'));
  const scenarioPath = join(dir, 'staking-pool-scenario.json');
  const anvil = await startAnvilFork();
  const cl = await createClDouble({ rpcUrl: anvil.rpcUrl, pubkey, includeValidator: false });
  const clUrl = await cl.listen(13610 + Math.floor(Math.random() * 400));
  setTimeout(() => cl.setValidatorIncluded(true), 3000);

  try {
    const vault = await getWithdrawalVault(
      'bepolia',
      { RPC_URL: anvil.rpcUrl },
      createChainReader(anvil.rpcUrl),
    );
    const deposit = {
      pubkey,
      credentials: `0x010000000000000000000000${vault.slice(2).toLowerCase()}`,
      signature: `0x${'11'.repeat(96)}`,
      amount: DEPOSIT_AMOUNT_GWEI,
    };
    const env = {
      CLI_CHAIN: 'bepolia',
      RPC_URL: anvil.rpcUrl,
      CL_NODE_API_URL: clUrl,
      PRIVATE_KEY: ANVIL_KEY,
    };

    log('=== (a) first run writes scenario ===');
    const first = await runInstall({
      env,
      pubkey,
      network: 'bepolia',
      deposit,
      operator: OPERATOR,
      sharesRecipient: SHARES,
      scenarioPath,
      skipConfirmation: true,
      isTTY: false,
    });
    log(`first run done=${first.done}`);
    const recorded = JSON.parse(readFileSync(scenarioPath, 'utf8'));
    log(`scenario keys: ${Object.keys(recorded).join(', ')}`);
    log(`scenario: ${JSON.stringify(recorded, null, 2)}`);

    log('');
    log('=== (b) second run reads scenario and skips interview ===');
    const second = await runInstall({
      env: { RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY },
      deposit,
      scenarioPath,
      skipConfirmation: true,
      isTTY: false,
    });
    log(`second run done=${second.done}`);

    log('');
    log('=== (c) third run refuses mismatched pubkey ===');
    const badPath = join(dir, 'mismatch.json');
    writeFileSync(
      badPath,
      JSON.stringify({ ...recorded, pubkey: `0x${'cd'.repeat(48)}` }, null, 2),
    );
    try {
      await runInstall({
        env,
        pubkey,
        scenarioPath: badPath,
        skipConfirmation: true,
        isTTY: false,
      });
      throw new Error('mismatch run should have refused');
    } catch (error) {
      if (!/pubkey.*conflict|conflict.*pubkey/i.test(error.message)) {
        throw error;
      }
      log(`mismatch refusal: ${error.message}`);
    }

    if (!first.done || !second.done) {
      throw new Error('first or second run did not reach done');
    }
    if (JSON.stringify(Object.keys(recorded).sort()) !== JSON.stringify(['locality', 'network', 'operator', 'pubkey', 'sharesRecipient'].sort())) {
      throw new Error(`scenario keys not the locked set: ${Object.keys(recorded)}`);
    }
    log('');
    log('VC-2 pass: write, resume-without-questions, named pubkey conflict.');
  } finally {
    cl.close();
    anvil.stop();
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
