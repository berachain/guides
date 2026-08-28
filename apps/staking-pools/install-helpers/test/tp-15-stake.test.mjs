import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runStake } from '../lib/commands/stake.mjs';
import { beraToGwei, beraToWei } from '../lib/units.mjs';

const liveFourAddresses = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cast-four-addresses.txt'),
  'utf8',
);

const RECEIVER = '0x' + '33'.repeat(20);
const POOL_ENV = { BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' };

function installOperatorMocks() {
  setCastRunner((argv) => {
    if (argv[2]?.includes('withdrawalVault')) {
      return { status: 0, stdout: '0x4242424242424242424242424242424242424242', stderr: '' };
    }
    if (argv[2]?.includes('getCoreContracts')) {
      return { status: 0, stdout: liveFourAddresses, stderr: '' };
    }
    return { status: 0, stdout: '1', stderr: '' };
  });

  setBeacondRunner((args) => {
    if (args.includes('validator-keys')) {
      return {
        status: 0,
        stdout: 'Eth/Beacon Pubkey (Compressed 48-byte Hex):\n0x' + 'aa'.repeat(48),
        stderr: '',
      };
    }
    if (args.includes('validator-root')) {
      return {
        status: 0,
        stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e',
        stderr: '',
      };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
}

describe('TP-15 stake submit', () => {
  it('converts BERA to wei without bc', () => {
    assert.equal(beraToWei('100', '--amount').wei, '100000000000000000000');
    assert.equal(beraToGwei('100', '--amount').gwei, '100000000000');
  });

  it('emits submit(address) with value and does not spawn send', async () => {
    const calls = [];
    installOperatorMocks();
    setCastRunner((argv) => {
      calls.push(argv[0]);
      if (argv[2]?.includes('withdrawalVault')) {
        return { status: 0, stdout: '0x4242424242424242424242424242424242424242', stderr: '' };
      }
      if (argv[2]?.includes('getCoreContracts')) {
        return { status: 0, stdout: liveFourAddresses, stderr: '' };
      }
      return { status: 0, stdout: '1', stderr: '' };
    });

    try {
      const result = await runStake({
        amount: '100',
        receiver: RECEIVER,
        execute: false,
        env: POOL_ENV,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.includes('submit(address)'));
      assert.ok(result.sendArgv.includes(RECEIVER));
      assert.ok(result.sendArgv.includes('--value'));
      assert.ok(result.sendArgv.includes('100ether'));
      assert.ok(result.sendArgv.includes('--ledger'));
      assert.ok(result.dryRunArgv.includes('--from'));
      assert.deepEqual(calls.filter((name) => name === 'send'), []);
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('rejects missing receiver and zero amount', async () => {
    installOperatorMocks();
    try {
      await assert.rejects(
        () => runStake({ amount: '100', execute: false, env: POOL_ENV }),
        /receiver/,
      );
      await assert.rejects(
        () => runStake({ amount: '0', receiver: RECEIVER, execute: false, env: POOL_ENV }),
        /greater than 0/,
      );
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
