import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runActivate } from '../lib/commands/activate.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';
import { runInstall } from '../lib/commands/install.mjs';
import { runSetMinBalance } from '../lib/commands/set-min-balance.mjs';
import { runStake } from '../lib/commands/stake.mjs';
import { runStatus } from '../lib/commands/status.mjs';
import { runUnstake } from '../lib/commands/unstake.mjs';
import { DEPOSIT_AMOUNT_GWEI } from '../lib/constants.mjs';
import { readReceipts } from '../lib/receipts.mjs';
import { createClDouble } from './helpers/cl-double.mjs';
import { startAnvilFork } from './helpers/anvil-harness.mjs';
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
  const code = spawnSync('cast', ['code', deployed, '-r', rpcUrl], { encoding: 'utf8' });
  const etched = spawnSync('cast', ['rpc', 'anvil_setCode', target, code.stdout.trim(), '-r', rpcUrl], { encoding: 'utf8' });
  if (etched.status !== 0) {
    throw new Error(`anvil_setCode ${target} failed: ${etched.stderr || etched.stdout}`);
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

const haveAnvil = commandExists('anvil') && commandExists('forge') && commandExists('cast');

describe('TP-8/TP-8b/TP-10 standalone commands read install\'s scenario file (anvil)', { skip: !haveAnvil }, () => {
  let anvil;
  let cl;
  let clUrl;
  let dir;
  let scenarioPath;
  let receiptsPath;
  let stakingPool;
  let noBeacondEnv;

  before(async () => {
    anvil = await startAnvilFork();
    etchMockWithdrawalVault(anvil.rpcUrl, FIXTURE.withdrawalAddress);
    cl = await createClDouble({ rpcUrl: anvil.rpcUrl, pubkey: FIXTURE.pubkey, includeValidator: true });
    clUrl = await cl.listen(13900 + Math.floor(Math.random() * 80));

    dir = mkdtempSync(join(tmpdir(), 'tp-41-'));
    scenarioPath = join(dir, 'staking-pool-scenario.json');
    receiptsPath = join(dir, 'staking-pool-receipts.jsonl');

    const installEnv = { CLI_CHAIN: 'bepolia', RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY };
    const installResult = await runInstall({
      env: installEnv,
      pubkey: FIXTURE.pubkey,
      network: 'bepolia',
      deposit: buildDeposit(FIXTURE.pubkey, FIXTURE.withdrawalAddress),
      operator: ANVIL_ADDR,
      sharesRecipient: ANVIL_ADDR,
      fundingAddress: ANVIL_ADDR,
      scenarioPath,
      skipConfirmation: true,
      isTTY: false,
      receiptsPath,
    });
    assert.equal(installResult.done, true);
    stakingPool = readReceipts(receiptsPath).find((row) => row.action === 'deploy').addresses.pool;

    // No BEACOND_HOME, no CLI_CHAIN, no --pubkey — the scenario file must be
    // the only identity source these calls can succeed from.
    noBeacondEnv = { RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY };
  });

  after(() => {
    cl?.close();
    anvil?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('TP-8: standalone status resolves from the scenario file, no BEACOND_HOME, no refusal', async () => {
    const result = await runStatus({ scenarioPath, env: noBeacondEnv });
    assert.equal(result.active, true);
  });

  it('TP-8b: standalone activate/set-min-balance/stake/unstake resolve from the scenario file; deploy still fails closed', async () => {
    const activateResult = await runActivate({ scenarioPath, env: noBeacondEnv });
    assert.equal(activateResult.skipped, true, 'already active — reached the pool check, not a refusal');

    const minBalResult = await runSetMinBalance({ scenarioPath, env: noBeacondEnv, receiptsPath });
    assert.equal(minBalResult.mode, 'execute');

    const stakeResult = await runStake({
      scenarioPath,
      env: noBeacondEnv,
      amount: '1',
      receiver: ANVIL_ADDR,
      stakingPool,
      receiptsPath,
    });
    assert.equal(stakeResult.mode, 'execute');

    const unstakeResult = await runUnstake({
      scenarioPath,
      env: noBeacondEnv,
      amount: '1',
      from: ANVIL_ADDR,
      stakingPool,
      receiptsPath,
    });
    assert.equal(unstakeResult.mode, 'execute');

    await assert.rejects(
      () =>
        runDeploy({
          scenarioPath,
          env: noBeacondEnv,
          operator: ANVIL_ADDR,
          sharesRecipient: ANVIL_ADDR,
        }),
      /install/i,
      'deploy is excluded from Phase D and keeps failing closed',
    );
  });

  it('TP-10: a source-less invocation of one of the five still fails closed pointing at install, unchanged', async () => {
    await assert.rejects(
      () =>
        runStatus({
          scenarioPath: join(dir, 'no-such-scenario.json'),
          env: { RPC_URL: anvil.rpcUrl },
        }),
      /install/i,
    );
  });
});
