#!/usr/bin/env node
/**
 * VC-2 (BERA-965) — direct fee read replaces the probe ladder.
 * anvil-backed unstake --amount with no --max-fee.
 * Worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-vc-965-2-direct-fee-read.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChainReader } from '../../lib/chain-reader.mjs';
import { runInstall } from '../../lib/commands/install.mjs';
import { runUnstake } from '../../lib/commands/unstake.mjs';
import { DEPOSIT_AMOUNT_GWEI } from '../../lib/constants.mjs';
import { readReceipts } from '../../lib/receipts.mjs';
import { createClDouble } from '../helpers/cl-double.mjs';
import { clearBeacondStub, installBeacondStub, startAnvilFork } from '../helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from '../helpers/validator-proof-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-965-2-direct-fee-read.txt');
const MOCK_VAULT_ROOT = join(ROOT, 'helpers/mock-vault');
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const FIXTURE = loadValidatorProofFixtures();
const OUT = [];
function log(line = '') {
  OUT.push(line);
  console.log(line);
}

function etchMockWithdrawalVault(rpcUrl, target) {
  const createOut = spawnSync(
    'forge',
    ['create', 'MockWithdrawalVault.sol:MockWithdrawalVault', '--rpc-url', rpcUrl, '--private-key', ANVIL_KEY, '--broadcast'],
    { cwd: MOCK_VAULT_ROOT, encoding: 'utf8' },
  );
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
  const clUrl = await cl.listen(13950 + Math.floor(Math.random() * 40));
  const dir = mkdtempSync(join(tmpdir(), 'vc-965-2-'));
  const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
  const env = { CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY };

  try {
    const reader = createChainReader(anvil.rpcUrl);
    const feeResult = await reader.call(FIXTURE.withdrawalAddress, 'getWithdrawalRequestFee()(uint256)');
    log(`Real EIP-7002 fee read directly off the vault: ${feeResult.decoded[0]} wei`);
    log('');

    const installResult = await runInstall({
      env, pubkey: FIXTURE.pubkey, network: 'bepolia',
      deposit: buildDeposit(FIXTURE.pubkey, FIXTURE.withdrawalAddress),
      operator: ANVIL_ADDR, sharesRecipient: ANVIL_ADDR, fundingAddress: ANVIL_ADDR,
      scenarioPath: join(dir, 'staking-pool-scenario.json'), skipConfirmation: true, isTTY: false, receiptsPath,
    });
    log(`install: done=${installResult.done}`);
    const stakingPool = readReceipts(receiptsPath).find((row) => row.action === 'deploy').addresses.pool;

    installBeacondStub(FIXTURE.pubkey);
    log('');
    log('$ node pool-cli.mjs unstake --amount 1 --from 0xf39F...9226 (no --max-fee)');
    const result = await runUnstake({
      amount: '1', from: ANVIL_ADDR, stakingPool,
      env: { ...env, BEACOND_HOME: '/tmp/beacond-vc965-2' }, receiptsPath,
    });
    log(`unstake: mode=${result.mode} hash=${result.hash} requestId=${result.requestId}`);
    const receipt = readReceipts(receiptsPath).find((row) => row.action === 'unstake.requestWithdrawal');
    log(`receipt: ${JSON.stringify(receipt)}`);

    mkdirSync(dirname(ARTIFACT), { recursive: true });
    writeFileSync(ARTIFACT, OUT.join('\n') + '\n', 'utf8');

    if (result.mode !== 'execute') throw new Error('VC-2 failed: unstake did not execute');
  } finally {
    cl.close();
    anvil.stop();
    clearBeacondStub();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
