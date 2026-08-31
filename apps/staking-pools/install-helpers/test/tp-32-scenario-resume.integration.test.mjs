import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { getWithdrawalVault } from '../lib/beacond.mjs';
import { createChainReader } from '../lib/chain-reader.mjs';
import { runInstall } from '../lib/commands/install.mjs';
import { DEPOSIT_AMOUNT_GWEI } from '../lib/constants.mjs';
import { createClDouble } from './helpers/cl-double.mjs';
import { startAnvilFork } from './helpers/anvil-harness.mjs';
import { loadValidatorProofFixtures } from './helpers/validator-proof-fixtures.mjs';

const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OPERATOR = '0x' + '11'.repeat(20);
const SHARES = '0x' + '22'.repeat(20);

function commandExists(name) {
  const result = spawnSync('command', ['-v', name], { encoding: 'utf8', shell: true });
  return result.status === 0;
}

function buildDeposit(pubkey, vault) {
  return {
    pubkey,
    credentials: `0x010000000000000000000000${vault.slice(2).toLowerCase()}`,
    signature: `0x${'11'.repeat(96)}`,
    amount: DEPOSIT_AMOUNT_GWEI,
  };
}

describe('TP-6 scenario-file resume', () => {
  it('second install with a matching scenario file asks nothing and proceeds', async () => {
    if (!commandExists('anvil') || !commandExists('forge') || !commandExists('cast')) {
      return;
    }

    const fixtures = loadValidatorProofFixtures();
    const pubkey = fixtures.pubkey;
    const dir = mkdtempSync(join(tmpdir(), 'tp32-'));
    const scenarioPath = join(dir, 'staking-pool-scenario.json');
    const anvil = await startAnvilFork();
    const cl = await createClDouble({
      rpcUrl: anvil.rpcUrl,
      pubkey,
      includeValidator: false,
    });
    const clUrl = await cl.listen(13510 + Math.floor(Math.random() * 400));
    setTimeout(() => cl.setValidatorIncluded(true), 3000);

    try {
      const vault = await getWithdrawalVault('bepolia', { RPC_URL: anvil.rpcUrl }, createChainReader(anvil.rpcUrl));
      const deposit = buildDeposit(pubkey, vault);
      const env = {
        CLI_CHAIN: 'bepolia',
        RPC_URL: anvil.rpcUrl,
        CL_NODE_API_URL: clUrl,
        PRIVATE_KEY: ANVIL_KEY,
      };

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
      assert.equal(first.done, true);

      const recorded = JSON.parse(readFileSync(scenarioPath, 'utf8'));
      assert.equal(recorded.network, 'bepolia');
      assert.equal(recorded.pubkey, pubkey);
      assert.equal(recorded.locality, 'remote');

      const second = await runInstall({
        env: { RPC_URL: anvil.rpcUrl, CL_NODE_API_URL: clUrl, PRIVATE_KEY: ANVIL_KEY },
        deposit,
        scenarioPath,
        skipConfirmation: true,
        isTTY: false,
      });
      assert.equal(second.done, true);
    } finally {
      cl.close();
      anvil.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a scenario file whose pubkey disagrees with supplied flags (anvil-backed identity)', async () => {
    if (!commandExists('anvil')) {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'tp32-mismatch-'));
    const scenarioPath = join(dir, 'staking-pool-scenario.json');
    writeFileSync(
      scenarioPath,
      JSON.stringify({
        network: 'bepolia',
        locality: 'remote',
        pubkey: `0x${'ab'.repeat(48)}`,
        operator: OPERATOR,
        sharesRecipient: SHARES,
      }),
    );
    try {
      await assert.rejects(
        () =>
          runInstall({
            env: { CLI_CHAIN: 'bepolia', PRIVATE_KEY: ANVIL_KEY },
            pubkey: `0x${'cd'.repeat(48)}`,
            scenarioPath,
            skipConfirmation: true,
            isTTY: false,
          }),
        /pubkey.*conflict|conflict.*pubkey/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
