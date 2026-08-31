#!/usr/bin/env node
/**
 * VC-3 (BERA-965) — --finalize with no value finalizes every ready request,
 * in both signing modes. Two withdrawal requests from the same holder, one
 * past the finalization delay, one not.
 * Worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-vc-965-3-finalize-all.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChainReader, sendContractTransaction } from '../../lib/chain-reader.mjs';
import { runInstall } from '../../lib/commands/install.mjs';
import { runUnstake } from '../../lib/commands/unstake.mjs';
import { DEPOSIT_AMOUNT_GWEI, WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY } from '../../lib/constants.mjs';
import { readReceipts } from '../../lib/receipts.mjs';
import { createColdSigningSigner } from '../../lib/signers.mjs';
import { createClDouble } from '../helpers/cl-double.mjs';
import { clearBeacondStub, installBeacondStub, startAnvilFork } from '../helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from '../helpers/validator-proof-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-965-3-finalize-all.txt');
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
function backdate(rpcUrl, vault, requestId, newBlock) {
  spawnSync('cast', ['send', vault, 'setRequestBlockForTesting(uint256,uint256)', String(requestId), String(newBlock), '-r', rpcUrl, '--private-key', ANVIL_KEY], { encoding: 'utf8' });
}
function buildDeposit(pubkey, vault) {
  return { pubkey, credentials: `0x010000000000000000000000${vault.slice(2).toLowerCase()}`, signature: `0x${'11'.repeat(96)}`, amount: DEPOSIT_AMOUNT_GWEI };
}

async function main() {
  const anvil = await startAnvilFork();
  etchMockWithdrawalVault(anvil.rpcUrl, FIXTURE.withdrawalAddress);
  const cl = await createClDouble({ rpcUrl: anvil.rpcUrl, pubkey: FIXTURE.pubkey, includeValidator: true });
  const clUrl = await cl.listen(13990 + Math.floor(Math.random() * 40));
  const dir = mkdtempSync(join(tmpdir(), 'vc-965-3-'));
  const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
  const installEnv = { CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY };
  const reader = createChainReader(anvil.rpcUrl);

  try {
    const installResult = await runInstall({
      env: installEnv, pubkey: FIXTURE.pubkey, network: 'bepolia',
      deposit: buildDeposit(FIXTURE.pubkey, FIXTURE.withdrawalAddress),
      operator: ANVIL_ADDR, sharesRecipient: ANVIL_ADDR, fundingAddress: ANVIL_ADDR,
      scenarioPath: join(dir, 'staking-pool-scenario.json'), skipConfirmation: true, isTTY: false, receiptsPath,
    });
    log(`install: done=${installResult.done}`);
    const stakingPool = readReceipts(receiptsPath).find((row) => row.action === 'deploy').addresses.pool;
    installBeacondStub(FIXTURE.pubkey);

    log('');
    log('--- Hot-key mode ---');
    const hotEnv = { BEACOND_HOME: '/tmp/beacond-vc965-3-hot', CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl, PRIVATE_KEY: ANVIL_KEY };
    const ready = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env: hotEnv, receiptsPath });
    const notReady = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env: hotEnv, receiptsPath });
    log(`created request ${ready.requestId} (will backdate — ready) and ${notReady.requestId} (left recent — not ready)`);
    const latest = BigInt(await reader.getBlockNumber());
    backdate(anvil.rpcUrl, FIXTURE.withdrawalAddress, ready.requestId, latest - WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY - 10n);
    log('$ node pool-cli.mjs unstake --finalize --from 0xf39F...9226');
    const finalizeAll = await runUnstake({ finalize: '', from: ANVIL_ADDR, stakingPool, env: hotEnv, receiptsPath });
    log(`finalized in one batch tx: hash=${finalizeAll.hash} requestIds=${JSON.stringify(finalizeAll.requestIds)}`);
    log(`not-ready request left untouched, named: ${JSON.stringify(finalizeAll.notReady)}`);

    log('');
    log('--- Cold-signing mode ---');
    const coldEnv = { BEACOND_HOME: '/tmp/beacond-vc965-3-cold', CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl };
    const readyA = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env: hotEnv, receiptsPath });
    const readyB = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env: hotEnv, receiptsPath });
    const latest2 = BigInt(await reader.getBlockNumber());
    backdate(anvil.rpcUrl, FIXTURE.withdrawalAddress, readyA.requestId, latest2 - WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY - 10n);
    backdate(anvil.rpcUrl, FIXTURE.withdrawalAddress, readyB.requestId, latest2 - WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY - 10n);

    const signer = createColdSigningSigner({ rpcUrl: anvil.rpcUrl, signingPreference: 'key' });
    const emitted = [];
    const original = signer.emitCastSend.bind(signer);
    signer.emitCastSend = (ctx) => { emitted.push(ctx); return original(ctx); };

    log('$ node pool-cli.mjs unstake --finalize --from 0xf39F...9226   (cold-signing)');
    const pending = runUnstake({ finalize: '', from: ANVIL_ADDR, stakingPool, env: coldEnv, signer, receiptsPath, pollIntervalMs: 300, pollTimeoutMs: 60000 });
    const start = Date.now();
    while (emitted.length < 1) {
      if (Date.now() - start > 30000) throw new Error('timed out waiting for cold-signing emit');
      await new Promise((r) => setTimeout(r, 100));
    }
    log(`printed cast send count: ${emitted.length} (must be exactly 1)`);
    log(`printed: cast send ${emitted[0].target} '${emitted[0].signature}' [${emitted[0].args[0]}] ...`);
    await sendContractTransaction({ rpcUrl: anvil.rpcUrl, privateKey: ANVIL_KEY, to: emitted[0].target, signature: emitted[0].signature, args: emitted[0].args, value: emitted[0].value ?? 0n });
    const coldResult = await pending;
    log(`landed: hash=${coldResult.hash} requestIds=${JSON.stringify(coldResult.requestIds)}`);

    mkdirSync(dirname(ARTIFACT), { recursive: true });
    writeFileSync(ARTIFACT, OUT.join('\n') + '\n', 'utf8');

    if (finalizeAll.requestIds.length !== 1 || finalizeAll.requestIds[0] !== ready.requestId) throw new Error('VC-3 hot-key failed: wrong requestIds');
    if (emitted.length !== 1) throw new Error('VC-3 cold-signing failed: more than one printed cast send');
    if (emitted[0].signature !== 'finalizeWithdrawalRequests(uint256[])') throw new Error('VC-3 cold-signing failed: wrong signature');
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
