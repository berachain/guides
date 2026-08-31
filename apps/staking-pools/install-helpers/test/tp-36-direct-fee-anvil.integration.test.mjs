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
import { DEPOSIT_AMOUNT_GWEI } from '../lib/constants.mjs';
import { readReceipts } from '../lib/receipts.mjs';
import { createClDouble } from './helpers/cl-double.mjs';
import { clearBeacondStub, installBeacondStub, startAnvilFork } from './helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from './helpers/validator-proof-fixtures.mjs';

function buildDeposit(pubkey, vault) {
  return {
    pubkey,
    credentials: `0x010000000000000000000000${vault.slice(2).toLowerCase()}`,
    signature: `0x${'11'.repeat(96)}`,
    amount: DEPOSIT_AMOUNT_GWEI,
  };
}

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

const haveAnvil = commandExists('anvil') && commandExists('forge') && commandExists('cast');

describe('TP-2 unstake reads the EIP-7002 fee directly off the vault (anvil)', { skip: !haveAnvil }, () => {
  let anvil;
  let cl;
  let clUrl;

  before(async () => {
    anvil = await startAnvilFork();
    etchMockWithdrawalVault(anvil.rpcUrl, FIXTURE.withdrawalAddress);
    cl = await createClDouble({ rpcUrl: anvil.rpcUrl, pubkey: FIXTURE.pubkey, includeValidator: true });
    clUrl = await cl.listen(13720 + Math.floor(Math.random() * 80));
  });

  after(() => {
    cl?.close();
    anvil?.stop();
    clearBeacondStub();
  });

  it('uses the real predeploy fee with no --max-fee and no candidate probing', async () => {
    const reader = createChainReader(anvil.rpcUrl);
    const feeResult = await reader.call(FIXTURE.withdrawalAddress, 'getWithdrawalRequestFee()(uint256)');
    const realFee = BigInt(feeResult.decoded[0]);
    assert.ok(realFee >= 0n, 'read a real, non-negative fee off the live EIP-7002 predeploy');

    const dir = mkdtempSync(join(tmpdir(), 'tp-36-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    const env = {
      CLI_CHAIN: 'bepolia',
      RPC_URL: anvil.rpcUrl,
      CL_NODE_API_URL: clUrl,
      PRIVATE_KEY: ANVIL_KEY,
    };
    try {
      const installResult = await runInstall({
        env,
        pubkey: FIXTURE.pubkey,
        network: 'bepolia',
        deposit: buildDeposit(FIXTURE.pubkey, FIXTURE.withdrawalAddress),
        operator: ANVIL_ADDR,
        sharesRecipient: ANVIL_ADDR,
        fundingAddress: ANVIL_ADDR,
        scenarioPath: join(dir, 'staking-pool-scenario.json'),
        skipConfirmation: true,
        isTTY: false,
        receiptsPath,
      });
      assert.equal(installResult.done, true);

      const stakeReceipt = readReceipts(receiptsPath).find((row) => row.action === 'stake' || row.action === 'deploy');
      const deployReceipt = readReceipts(receiptsPath).find((row) => row.action === 'deploy');
      const stakingPool = deployReceipt.addresses.pool;

      installBeacondStub(FIXTURE.pubkey);
      const result = await runUnstake({
        amount: '1',
        from: ANVIL_ADDR,
        stakingPool,
        env: { ...env, BEACOND_HOME: '/tmp/beacond-tp36' },
        receiptsPath,
      });
      assert.equal(result.mode, 'execute');

      const [receipt] = readReceipts(receiptsPath).filter((row) => row.action === 'unstake.requestWithdrawal');
      assert.ok(receipt, 'requestWithdrawal receipt recorded at the real predeploy fee, single read');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
