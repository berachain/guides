import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSharedTxRunnerId, runTransaction, SHARED_TX_RUNNER } from '../lib/tx-runner.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';
import { runSetMinBalance } from '../lib/commands/set-min-balance.mjs';
import { runStake } from '../lib/commands/stake.mjs';
import { runUnstake } from '../lib/commands/unstake.mjs';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';

const liveFourAddresses = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cast-four-addresses.txt'),
  'utf8',
);

function installMocks() {
  setCastRunner((argv) => {
    if (argv[2]?.includes('withdrawalVault')) {
      return { status: 0, stdout: '0x4242424242424242424242424242424242424242', stderr: '' };
    }
    if (
      argv[2]?.includes('getCoreContracts') ||
      argv[2]?.includes('predictStakingPoolContractsAddresses')
    ) {
      return { status: 0, stdout: liveFourAddresses, stderr: '' };
    }
    if (argv[2]?.includes('isActive')) {
      return { status: 0, stdout: 'true', stderr: '' };
    }
    return { status: 0, stdout: '0x', stderr: '' };
  });

  setBeacondRunner((args) => {
    if (args.includes('validator-root')) {
      return {
        status: 0,
        stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e',
        stderr: '',
      };
    }
    if (args.includes('validator-keys')) {
      return {
        status: 0,
        stdout: 'Eth/Beacon Pubkey (Compressed 48-byte Hex):\n0x' + 'aa'.repeat(48),
        stderr: '',
      };
    }
    if (args.includes('create-validator')) {
      return {
        status: 0,
        stdout: 'pubkey: 0xabc\ncredentials: 0xdef\nsignature: 0xsig\namount: 1\n',
        stderr: '',
      };
    }
    if (args.includes('validate')) {
      return { status: 0, stdout: 'ok', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
}

describe('TP-12 shared transaction runner', () => {
  it('routes deploy, set-min-balance, stake, and unstake through one runner', async () => {
    installMocks();
    const env = { BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' };

    try {
      const deployResult = await runDeploy({
        operator: '0x' + '11'.repeat(20),
        sharesRecipient: '0x' + '22'.repeat(20),
        execute: false,
        env,
      });
      assert.equal(getSharedTxRunnerId(), SHARED_TX_RUNNER);
      assert.equal(deployResult.mode, 'emit');

      const setMinResult = await runSetMinBalance({ execute: false, env });
      assert.equal(getSharedTxRunnerId(), SHARED_TX_RUNNER);
      assert.equal(setMinResult.mode, 'emit');

      const stakeResult = await runStake({
        amount: '1',
        receiver: '0x' + '33'.repeat(20),
        execute: false,
        env,
      });
      assert.equal(getSharedTxRunnerId(), SHARED_TX_RUNNER);
      assert.equal(stakeResult.mode, 'emit');

      const unstakeResult = await runUnstake({
        amount: '1',
        from: '0x' + '44'.repeat(20),
        maxFee: '0.01',
        execute: false,
        env,
      });
      assert.equal(getSharedTxRunnerId(), SHARED_TX_RUNNER);
      assert.equal(unstakeResult.mode, 'emit');

      const activateResult = await runTransaction(
        { execute: false, rpcUrl: 'http://rpc', env: {} },
        {
          label: 'activateStakingPool',
          target: '0xfactory',
          signature: 'activateStakingPool()',
          buildCalldataArgs: () => [],
        },
      );
      assert.equal(getSharedTxRunnerId(), SHARED_TX_RUNNER);
      assert.equal(activateResult.mode, 'emit');
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
