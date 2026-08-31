import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createChainReader } from '../lib/chain-reader.mjs';
import { runInstall } from '../lib/commands/install.mjs';
import { runUnstake } from '../lib/commands/unstake.mjs';
import { DEPOSIT_AMOUNT_GWEI, WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY } from '../lib/constants.mjs';
import { readReceipts } from '../lib/receipts.mjs';
import { createColdSigningSigner } from '../lib/signers.mjs';
import { createClDouble } from './helpers/cl-double.mjs';
import { clearBeacondStub, installBeacondStub, startAnvilFork } from './helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from './helpers/validator-proof-fixtures.mjs';

const MOCK_VAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'helpers/mock-vault');
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const FIXTURE = loadValidatorProofFixtures();

function commandExists(name) {
  return spawnSync('command', ['-v', name], { encoding: 'utf8', shell: true }).status === 0;
}

function etchMockWithdrawalVault(rpcUrl, target) {
  const createOut = spawnSync(
    'forge',
    ['create', 'MockWithdrawalVault.sol:MockWithdrawalVault', '--rpc-url', rpcUrl, '--private-key', ANVIL_KEY, '--broadcast'],
    { cwd: MOCK_VAULT_ROOT, encoding: 'utf8' },
  );
  if (createOut.status !== 0) {
    throw new Error(`forge create MockWithdrawalVault failed: ${createOut.stderr || createOut.stdout}`);
  }
  const deployed = createOut.stdout.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  if (!deployed) {
    throw new Error(`forge create MockWithdrawalVault produced no address: ${createOut.stdout}`);
  }
  const code = spawnSync('cast', ['code', deployed, '-r', rpcUrl], { encoding: 'utf8' });
  const etched = spawnSync('cast', ['rpc', 'anvil_setCode', target, code.stdout.trim(), '-r', rpcUrl], { encoding: 'utf8' });
  if (etched.status !== 0) {
    throw new Error(`anvil_setCode ${target} failed: ${etched.stderr || etched.stdout}`);
  }
}

function backdateRequest(rpcUrl, vault, requestId, newBlock) {
  const result = spawnSync(
    'cast',
    ['send', vault, 'setRequestBlockForTesting(uint256,uint256)', String(requestId), String(newBlock), '-r', rpcUrl, '--private-key', ANVIL_KEY],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`setRequestBlockForTesting failed: ${result.stderr || result.stdout}`);
  }
}

function buildDeposit(pubkey, vault) {
  return {
    pubkey,
    credentials: `0x010000000000000000000000${vault.slice(2).toLowerCase()}`,
    signature: `0x${'11'.repeat(96)}`,
    amount: DEPOSIT_AMOUNT_GWEI,
  };
}

function interceptColdSigner(rpcUrl) {
  const signer = createColdSigningSigner({ rpcUrl, signingPreference: 'key' });
  const emitted = [];
  const original = signer.emitCastSend.bind(signer);
  signer.emitCastSend = (ctx) => {
    emitted.push(ctx);
    return original(ctx);
  };
  return { signer, emitted };
}

const haveAnvil = commandExists('anvil') && commandExists('forge') && commandExists('cast');

describe('TP-4/TP-4b unstake --finalize with no value (anvil)', { skip: !haveAnvil }, () => {
  let anvil;
  let cl;
  let clUrl;
  let stakingPool;
  let reader;

  before(async () => {
    anvil = await startAnvilFork();
    etchMockWithdrawalVault(anvil.rpcUrl, FIXTURE.withdrawalAddress);
    cl = await createClDouble({ rpcUrl: anvil.rpcUrl, pubkey: FIXTURE.pubkey, includeValidator: true });
    clUrl = await cl.listen(13800 + Math.floor(Math.random() * 80));
    reader = createChainReader(anvil.rpcUrl);

    const dir = mkdtempSync(join(tmpdir(), 'tp-38-install-'));
    const installEnv = { CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY };
    const installResult = await runInstall({
      env: installEnv,
      pubkey: FIXTURE.pubkey,
      network: 'bepolia',
      deposit: buildDeposit(FIXTURE.pubkey, FIXTURE.withdrawalAddress),
      operator: ANVIL_ADDR,
      sharesRecipient: ANVIL_ADDR,
      fundingAddress: ANVIL_ADDR,
      scenarioPath: join(dir, 'staking-pool-scenario.json'),
      skipConfirmation: true,
      isTTY: false,
      receiptsPath: join(dir, 'staking-pool-receipts.jsonl'),
    });
    assert.equal(installResult.done, true);
    const deployReceipt = readReceipts(join(dir, 'staking-pool-receipts.jsonl')).find((row) => row.action === 'deploy');
    stakingPool = deployReceipt.addresses.pool;
    rmSync(dir, { recursive: true, force: true });
  });

  after(() => {
    cl?.close();
    anvil?.stop();
    clearBeacondStub();
  });

  it('TP-4 hot-key: finalizes only the ready request, in one batch transaction, leaving the not-ready one named', async () => {
    installBeacondStub(FIXTURE.pubkey);
    const dir = mkdtempSync(join(tmpdir(), 'tp-38-hotkey-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    const env = { BEACOND_HOME: '/tmp/beacond-tp38-hotkey', CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl, PRIVATE_KEY: ANVIL_KEY };
    try {
      const readyReq = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env, receiptsPath });
      const notReadyReq = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env, receiptsPath });
      assert.ok(readyReq.requestId, 'confirmed request id surfaced in default output (TP-6)');
      assert.ok(notReadyReq.requestId);

      const latest = BigInt(await reader.getBlockNumber());
      backdateRequest(anvil.rpcUrl, FIXTURE.withdrawalAddress, readyReq.requestId, latest - WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY - 10n);

      const result = await runUnstake({ finalize: '', from: ANVIL_ADDR, stakingPool, env, receiptsPath });
      assert.equal(result.mode, 'execute');
      assert.deepEqual(result.ready ?? [readyReq.requestId], [readyReq.requestId]);
      assert.equal(result.notReady.length, 1);
      assert.equal(result.notReady[0].requestId, notReadyReq.requestId);

      const [batchReceipt] = readReceipts(receiptsPath).filter((row) => row.action === 'unstake.finalizeWithdrawalRequests');
      assert.ok(batchReceipt, 'exactly one batch receipt entry recorded');
      assert.deepEqual(batchReceipt.requestIds, [readyReq.requestId]);
      assert.equal(batchReceipt.hash.toLowerCase(), result.hash.toLowerCase());
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearBeacondStub();
    }
  });

  it('TP-4b cold-signing: emits exactly one cast send with signature finalizeWithdrawalRequests(uint256[]) for both ready ids, never N single-ID commands', async () => {
    installBeacondStub(FIXTURE.pubkey);
    const dir = mkdtempSync(join(tmpdir(), 'tp-38-cold-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    const env = { BEACOND_HOME: '/tmp/beacond-tp38-cold', CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl };
    try {
      const requestA = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env: { ...env, PRIVATE_KEY: ANVIL_KEY }, receiptsPath });
      const requestB = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env: { ...env, PRIVATE_KEY: ANVIL_KEY }, receiptsPath });
      const requestC = await runUnstake({ amount: '1', from: ANVIL_ADDR, stakingPool, env: { ...env, PRIVATE_KEY: ANVIL_KEY }, receiptsPath });

      const latest = BigInt(await reader.getBlockNumber());
      const backdated = latest - WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY - 10n;
      backdateRequest(anvil.rpcUrl, FIXTURE.withdrawalAddress, requestA.requestId, backdated);
      backdateRequest(anvil.rpcUrl, FIXTURE.withdrawalAddress, requestB.requestId, backdated);
      // requestC left at its natural (recent) requestBlock: not ready.

      const { signer, emitted } = interceptColdSigner(anvil.rpcUrl);
      const pending = runUnstake({ finalize: '', from: ANVIL_ADDR, stakingPool, env, signer, receiptsPath, pollIntervalMs: 400, pollTimeoutMs: 120000 });

      const start = Date.now();
      while (emitted.length < 1) {
        if (Date.now() - start > 30000) throw new Error('timed out waiting for cold-signing emit');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(emitted.length, 1, 'exactly one printed cast send, never N single-ID commands');
      const command = emitted[0];
      assert.equal(command.signature, 'finalizeWithdrawalRequests(uint256[])');
      assert.deepEqual(command.args, [[requestA.requestId, requestB.requestId]]);

      const { sendContractTransaction } = await import('../lib/chain-reader.mjs');
      await sendContractTransaction({
        rpcUrl: anvil.rpcUrl,
        privateKey: ANVIL_KEY,
        to: command.target,
        signature: command.signature,
        args: command.args,
        value: command.value ?? 0n,
      });

      const result = await pending;
      assert.deepEqual([...result.requestIds].sort(), [requestA.requestId, requestB.requestId].sort());

      const [batchReceipt] = readReceipts(receiptsPath).filter((row) => row.action === 'unstake.finalizeWithdrawalRequests');
      assert.ok(batchReceipt);
      assert.deepEqual([...batchReceipt.requestIds].sort(), [requestA.requestId, requestB.requestId].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearBeacondStub();
    }
  });
});
