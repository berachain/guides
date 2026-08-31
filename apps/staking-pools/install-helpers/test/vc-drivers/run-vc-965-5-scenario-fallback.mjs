#!/usr/bin/env node
/**
 * VC-5 (BERA-965) — standalone status/stake pick up the scenario file.
 * install writes a scenario file, then a standalone status invocation from
 * the same directory with no flags and no BEACOND_HOME.
 * Worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-vc-965-5-scenario-fallback.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInstall } from '../../lib/commands/install.mjs';
import { runStatus } from '../../lib/commands/status.mjs';
import { runStake } from '../../lib/commands/stake.mjs';
import { DEPOSIT_AMOUNT_GWEI } from '../../lib/constants.mjs';
import { readReceipts } from '../../lib/receipts.mjs';
import { createClDouble } from '../helpers/cl-double.mjs';
import { startAnvilFork } from '../helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from '../helpers/validator-proof-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-965-5-scenario-fallback.txt');
const MOCK_VAULT_ROOT = join(ROOT, 'helpers/mock-vault');
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const FIXTURE = loadValidatorProofFixtures();
const OUT = [];
function log(line = '') { OUT.push(line); console.log(line); }

function etchMockWithdrawalVault(rpcUrl, target) {
  const createOut = spawnSync('forge', ['create', 'MockWithdrawalVault.sol:MockWithdrawalVault', '--rpc-url', rpcUrl, '--private-key', ANVIL_KEY, '--broadcast'], { cwd: MOCK_VAULT_ROOT, encoding: 'utf8' });
  const deployed = createOut.stdout.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  const code = spawnSync('cast', ['code', deployed, '-r', rpcUrl], { encoding: 'utf8' });
  spawnSync('cast', ['rpc', 'anvil_setCode', target, code.stdout.trim(), '-r', rpcUrl], { encoding: 'utf8' });
}
function buildDeposit(pubkey, vault) {
  return { pubkey, credentials: `0x010000000000000000000000${vault.slice(2).toLowerCase()}`, signature: `0x${'11'.repeat(96)}`, amount: DEPOSIT_AMOUNT_GWEI };
}

async function main() {
  const anvil = await startAnvilFork();
  etchMockWithdrawalVault(anvil.rpcUrl, FIXTURE.withdrawalAddress);
  const cl = await createClDouble({ rpcUrl: anvil.rpcUrl, pubkey: FIXTURE.pubkey, includeValidator: true });
  const clUrl = await cl.listen(14010 + Math.floor(Math.random() * 40));
  const dir = mkdtempSync(join(tmpdir(), 'vc-965-5-'));
  const scenarioPath = join(dir, 'staking-pool-scenario.json');
  const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
  const installEnv = { CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY };

  try {
    log(`$ cd ${dir}`);
    log('$ node pool-cli.mjs install ...');
    const installResult = await runInstall({
      env: installEnv, pubkey: FIXTURE.pubkey, network: 'bepolia',
      deposit: buildDeposit(FIXTURE.pubkey, FIXTURE.withdrawalAddress),
      operator: ANVIL_ADDR, sharesRecipient: ANVIL_ADDR, fundingAddress: ANVIL_ADDR,
      scenarioPath, skipConfirmation: true, isTTY: false, receiptsPath,
    });
    log(`install: done=${installResult.done}`);
    log('');
    log(`staking-pool-scenario.json written by install:`);
    log(readFileSync(scenarioPath, 'utf8').trim());
    log('');

    const noBeacondEnv = { RPC_URL: anvil.rpcUrl, PRIVATE_KEY: ANVIL_KEY };
    log('$ node pool-cli.mjs status     (no BEACOND_HOME, no --chain, no --pubkey)');
    const statusResult = await runStatus({ scenarioPath, env: noBeacondEnv });
    log(`status: active=${statusResult.active} phase=${statusResult.phase} (resolved identity from the scenario file, no refusal)`);

    log('');
    log('$ node pool-cli.mjs stake --amount 1 --receiver 0xf39F...9226   (no BEACOND_HOME)');
    const stakeResult = await runStake({
      scenarioPath, env: noBeacondEnv, amount: '1', receiver: ANVIL_ADDR,
      stakingPool: statusResult.stakingPool, receiptsPath,
    });
    log(`stake: mode=${stakeResult.mode} hash=${stakeResult.hash}`);

    mkdirSync(dirname(ARTIFACT), { recursive: true });
    writeFileSync(ARTIFACT, OUT.join('\n') + '\n', 'utf8');

    if (statusResult.active !== true) throw new Error('VC-5 failed: status did not resolve/report correctly');
    if (stakeResult.mode !== 'execute') throw new Error('VC-5 failed: stake did not execute');
  } finally {
    cl.close();
    anvil.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
