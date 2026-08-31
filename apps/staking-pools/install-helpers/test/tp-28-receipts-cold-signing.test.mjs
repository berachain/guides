import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createChainReader, sendContractTransaction } from '../lib/chain-reader.mjs';
import { ethers } from '../lib/ethers-bundle.mjs';
import { RECEIPT_EVENT_ABIS } from '../lib/receipt-events.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';
import { runInstall } from '../lib/commands/install.mjs';
import { runSetMinBalance } from '../lib/commands/set-min-balance.mjs';
import { runStake } from '../lib/commands/stake.mjs';
import { runUnstake } from '../lib/commands/unstake.mjs';
import { readReceipts } from '../lib/receipts.mjs';
import { createColdSigningSigner } from '../lib/signers.mjs';
import { createClDouble } from './helpers/cl-double.mjs';
import {
  clearBeacondStub,
  installBeacondStub,
  startAnvilFork,
} from './helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from './helpers/validator-proof-fixtures.mjs';

const MOCK_VAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'helpers/mock-vault');

const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const FIXTURE = loadValidatorProofFixtures();

function commandExists(name) {
  return spawnSync('command', ['-v', name], { encoding: 'utf8', shell: true }).status === 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function landPrinted(rpcUrl, emitted) {
  return sendContractTransaction({
    rpcUrl,
    privateKey: ANVIL_KEY,
    to: emitted.target,
    signature: emitted.signature,
    args: emitted.args,
    value: emitted.value ?? 0n,
  });
}

async function waitForEmit(emitted, count, timeoutMs = 60000) {
  const start = Date.now();
  while (emitted.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for cold-signing emit #${count}`);
    }
    await sleep(50);
  }
  return emitted[count - 1];
}

async function waitForReceipt(path, action, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = readReceipts(path).find((row) => row.action === action);
    if (match) return match;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${action} receipt`);
}

function requestIdFromLanded(receipt) {
  const iface = new ethers.Interface([RECEIPT_EVENT_ABIS['unstake.requestWithdrawal']]);
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = iface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === 'WithdrawalRequested') {
        return parsed.args.requestId.toString();
      }
    } catch {
      // different event
    }
  }
  return null;
}

function etchMockWithdrawalVault(rpcUrl, target) {
  const createOut = spawnSync(
    'forge',
    [
      'create',
      'MockWithdrawalVault.sol:MockWithdrawalVault',
      '--rpc-url',
      rpcUrl,
      '--private-key',
      ANVIL_KEY,
      '--broadcast',
    ],
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
  if (code.status !== 0 || !code.stdout.trim() || code.stdout.trim() === '0x') {
    throw new Error(`cast code ${deployed} failed: ${code.stderr || code.stdout}`);
  }
  const etched = spawnSync(
    'cast',
    ['rpc', 'anvil_setCode', target, code.stdout.trim(), '-r', rpcUrl],
    { encoding: 'utf8' },
  );
  if (etched.status !== 0) {
    throw new Error(`anvil_setCode ${target} failed: ${etched.stderr || etched.stdout}`);
  }
}

const haveAnvil = commandExists('anvil') && commandExists('forge') && commandExists('cast');

describe('TP-2 cold-signing receipts after landing-wait', { skip: !haveAnvil }, () => {
  let anvil;
  let cl;
  let clUrl;

  before(async () => {
    anvil = await startAnvilFork();
    etchMockWithdrawalVault(anvil.rpcUrl, FIXTURE.withdrawalAddress);
    cl = await createClDouble({
      rpcUrl: anvil.rpcUrl,
      pubkey: FIXTURE.pubkey,
      includeValidator: false,
    });
    clUrl = await cl.listen(13610 + Math.floor(Math.random() * 80));
  });

  after(() => {
    cl?.close();
    anvil?.stop();
    clearBeacondStub();
  });

  it('writes a deploy receipt only after the printed command lands, with a matching recovered hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-28-deploy-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    const pubkey = `0x${'cd'.repeat(48)}`;
    installBeacondStub(pubkey);
    const { signer, emitted } = interceptColdSigner(anvil.rpcUrl);
    const env = {
      BEACOND_HOME: '/tmp/beacond-tp28',
      CLI_CHAIN: 'bepolia',
      RPC_URL: anvil.rpcUrl,
    };

    const pending = runDeploy({
      operator: ANVIL_ADDR,
      sharesRecipient: ANVIL_ADDR,
      env,
      signer,
      receiptsPath,
      pollIntervalMs: 400,
      pollTimeoutMs: 120000,
    });

    await waitForEmit(emitted, 1);
    await sleep(500);
    assert.equal(readReceipts(receiptsPath).length, 0, 'no receipt at print-time');

    const landed = await landPrinted(anvil.rpcUrl, emitted[0]);
    const result = await pending;
    const [record] = readReceipts(receiptsPath);
    assert.equal(record.action, 'deploy');
    assert.equal(record.hash.toLowerCase(), landed.hash.toLowerCase());
    assert.equal(result.hash.toLowerCase(), landed.hash.toLowerCase());
    rmSync(dir, { recursive: true, force: true });
  });

  it('covers install plus standalone activate/stake/unstake/set-min-balance hash recovery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-28-install-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    installBeacondStub(FIXTURE.pubkey);
    const { signer, emitted } = interceptColdSigner(anvil.rpcUrl);
    const env = {
      BEACOND_HOME: '/tmp/beacond-tp28-install',
      CLI_CHAIN: 'bepolia',
      RPC_URL: anvil.rpcUrl,
      CL_NODE_API_URL: clUrl,
    };

    const pendingInstall = runInstall({
      env,
      signer,
      receiptsPath,
      skipConfirmation: true,
      fundingAddress: ANVIL_ADDR,
      operator: ANVIL_ADDR,
      sharesRecipient: ANVIL_ADDR,
      signingPreference: 'key',
      pollIntervalMs: 400,
      pollTimeoutMs: 180000,
    });

    await waitForEmit(emitted, 1);
    await sleep(500);
    assert.ok(
      !readReceipts(receiptsPath).some((row) => row.action === 'deploy'),
      'install deploy receipt is absent until landing',
    );
    const deployLanded = await landPrinted(anvil.rpcUrl, emitted[0]);
    const deployReceipt = await waitForReceipt(receiptsPath, 'deploy');
    assert.equal(deployReceipt.hash.toLowerCase(), deployLanded.hash.toLowerCase());

    cl.setValidatorIncluded(true);
    await waitForEmit(emitted, 2);
    const activateLanded = await landPrinted(anvil.rpcUrl, emitted[1]);
    const activateReceipt = await waitForReceipt(receiptsPath, 'activate');
    assert.equal(activateReceipt.hash.toLowerCase(), activateLanded.hash.toLowerCase());

    await waitForEmit(emitted, 3);
    const stakeLanded = await landPrinted(anvil.rpcUrl, emitted[2]);
    const stakeReceipt = await waitForReceipt(receiptsPath, 'stake');
    assert.equal(stakeReceipt.hash.toLowerCase(), stakeLanded.hash.toLowerCase());

    const installResult = await pendingInstall;
    assert.equal(installResult.done, true);

    const reader = createChainReader(anvil.rpcUrl);
    const minResult = await reader.call(
      stakeReceipt.addresses.pool,
      'MIN_EFFECTIVE_BALANCE()(uint256)',
    );
    const minWei = BigInt(minResult.decoded[0]);
    const nextBera = ethers.formatEther(minWei + 10n ** 18n);

    const standaloneSigner = interceptColdSigner(anvil.rpcUrl);
    const minBalPending = runSetMinBalance({
      amount: nextBera,
      from: ANVIL_ADDR,
      env,
      signer: standaloneSigner.signer,
      receiptsPath,
      pollIntervalMs: 400,
      pollTimeoutMs: 120000,
    });
    await waitForEmit(standaloneSigner.emitted, 1);
    const minBalLanded = await landPrinted(anvil.rpcUrl, standaloneSigner.emitted[0]);
    await minBalPending;
    const minBalReceipt = readReceipts(receiptsPath).filter((row) => row.action === 'set-min-balance').at(-1);
    assert.equal(minBalReceipt.hash.toLowerCase(), minBalLanded.hash.toLowerCase());

    spawnSync(
      'cast',
      ['rpc', 'anvil_setBalance', ANVIL_ADDR, '0x21E19E0C9BAB2400000', '-r', anvil.rpcUrl],
      { encoding: 'utf8' },
    );

    const extraStake = interceptColdSigner(anvil.rpcUrl);
    const extraPending = runStake({
      amount: '1',
      receiver: ANVIL_ADDR,
      stakingPool: stakeReceipt.addresses.pool,
      env,
      signer: extraStake.signer,
      receiptsPath,
      pollIntervalMs: 400,
      pollTimeoutMs: 120000,
    });
    await waitForEmit(extraStake.emitted, 1);
    const extraLanded = await landPrinted(anvil.rpcUrl, extraStake.emitted[0]);
    await extraPending;
    const extraReceipt = readReceipts(receiptsPath).filter((row) => row.action === 'stake').at(-1);
    assert.equal(extraReceipt.hash.toLowerCase(), extraLanded.hash.toLowerCase());

    // Stay under minEffectiveBalance so requestWithdrawal services from the
    // buffer and skips ENABLE_WITHDRAWAL_COOLDOWN_BLOCKS (129_600).
    const unstakeAssets = interceptColdSigner(anvil.rpcUrl);
    const assetsPending = runUnstake({
      amount: '1',
      from: ANVIL_ADDR,
      stakingPool: stakeReceipt.addresses.pool,
      env,
      signer: unstakeAssets.signer,
      receiptsPath,
      maxFee: '0.01',
      pollIntervalMs: 400,
      pollTimeoutMs: 120000,
    });
    await waitForEmit(unstakeAssets.emitted, 1);
    const assetsLanded = await landPrinted(anvil.rpcUrl, unstakeAssets.emitted[0]);
    await assetsPending;
    const assetsReceipt = readReceipts(receiptsPath).find(
      (row) => row.action === 'unstake.requestWithdrawal',
    );
    assert.equal(assetsReceipt.hash.toLowerCase(), assetsLanded.hash.toLowerCase());

    const unstakeShares = interceptColdSigner(anvil.rpcUrl);
    const sharesPending = runUnstake({
      shares: '1',
      from: ANVIL_ADDR,
      stakingPool: stakeReceipt.addresses.pool,
      env,
      signer: unstakeShares.signer,
      receiptsPath,
      maxFee: '0.001',
      pollIntervalMs: 400,
      pollTimeoutMs: 120000,
    });
    await waitForEmit(unstakeShares.emitted, 1);
    const sharesLanded = await landPrinted(anvil.rpcUrl, unstakeShares.emitted[0]);
    await sharesPending;
    const sharesReceipt = readReceipts(receiptsPath).find(
      (row) => row.action === 'unstake.requestRedeem',
    );
    assert.equal(sharesReceipt.hash.toLowerCase(), sharesLanded.hash.toLowerCase());

    const requestId = requestIdFromLanded(assetsLanded.receipt) ?? '0';
    const unstakeFin = interceptColdSigner(anvil.rpcUrl);
    const finPending = runUnstake({
      finalize: requestId,
      from: ANVIL_ADDR,
      stakingPool: stakeReceipt.addresses.pool,
      env,
      signer: unstakeFin.signer,
      receiptsPath,
      pollIntervalMs: 400,
      pollTimeoutMs: 120000,
    });
    await waitForEmit(unstakeFin.emitted, 1);
    const finLanded = await landPrinted(anvil.rpcUrl, unstakeFin.emitted[0]);
    await finPending;
    const finReceipt = readReceipts(receiptsPath).find(
      (row) => row.action === 'unstake.finalizeWithdrawalRequest',
    );
    assert.equal(finReceipt.hash.toLowerCase(), finLanded.hash.toLowerCase());

    rmSync(dir, { recursive: true, force: true });
  });
});
