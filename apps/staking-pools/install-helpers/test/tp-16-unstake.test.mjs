import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { resolveUnstakeMode, runUnstake } from '../lib/commands/unstake.mjs';

const liveFourAddresses = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cast-four-addresses.txt'),
  'utf8',
);

const HOLDER = '0x' + '44'.repeat(20);
const PUBKEY = '0x' + 'aa'.repeat(48);
const POOL_ENV = { BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' };
const FEE_WEI = '10000000000000000';

function installOperatorMocks(extra = () => ({ status: 0, stdout: '7', stderr: '' })) {
  setCastRunner((argv) => {
    if (argv[2]?.includes('withdrawalVault')) {
      return { status: 0, stdout: '0x4242424242424242424242424242424242424242', stderr: '' };
    }
    if (argv[2]?.includes('getCoreContracts')) {
      return { status: 0, stdout: liveFourAddresses, stderr: '' };
    }
    if (argv[2]?.includes('isActive')) {
      return { status: 0, stdout: 'true', stderr: '' };
    }
    return extra(argv);
  });

  setBeacondRunner((args) => {
    if (args.includes('validator-keys')) {
      return {
        status: 0,
        stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}`,
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

describe('TP-16 unstake request and finalize', () => {
  it('requires exactly one of --amount, --shares, or --finalize', () => {
    assert.equal(resolveUnstakeMode({ amount: '1' }), 'assets');
    assert.equal(resolveUnstakeMode({ shares: '1' }), 'shares');
    assert.equal(resolveUnstakeMode({ finalize: '9' }), 'finalize');
    assert.throws(() => resolveUnstakeMode({}), /exactly one/);
    assert.throws(() => resolveUnstakeMode({ amount: '1', shares: '1' }), /exactly one/);
  });

  it('emits requestWithdrawal with gwei amount, pubkey, and fee value', async () => {
    installOperatorMocks();
    try {
      const result = await runUnstake({
        amount: '100',
        from: HOLDER,
        maxFee: '0.01',
        execute: false,
        env: POOL_ENV,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.includes('requestWithdrawal(bytes,uint64,uint256)(uint256)'));
      assert.ok(result.sendArgv.includes(PUBKEY));
      assert.ok(result.sendArgv.includes('100000000000'));
      assert.ok(result.sendArgv.includes(FEE_WEI));
      assert.ok(result.sendArgv.includes('--value'));
      assert.ok(result.dryRunArgv.includes('--from'));
      assert.ok(result.dryRunArgv.includes(HOLDER));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('emits requestRedeem for --shares', async () => {
    installOperatorMocks();
    try {
      const result = await runUnstake({
        shares: '50',
        from: HOLDER,
        maxFee: '0.01',
        execute: false,
        env: POOL_ENV,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.includes('requestRedeem(bytes,uint256,uint256)(uint256)'));
      assert.ok(result.sendArgv.includes('50000000000000000000'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('emits finalizeWithdrawalRequest for --finalize', async () => {
    installOperatorMocks();
    try {
      const result = await runUnstake({
        finalize: '42',
        from: HOLDER,
        execute: false,
        env: POOL_ENV,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.includes('finalizeWithdrawalRequest(uint256)'));
      assert.ok(result.sendArgv.includes('42'));
      assert.ok(!result.sendArgv.includes('--value'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('refuses unstake when the pool is not active', async () => {
    installOperatorMocks();
    setCastRunner((argv) => {
      if (argv[2]?.includes('withdrawalVault')) {
        return { status: 0, stdout: '0x4242424242424242424242424242424242424242', stderr: '' };
      }
      if (argv[2]?.includes('getCoreContracts')) {
        return { status: 0, stdout: liveFourAddresses, stderr: '' };
      }
      if (argv[2]?.includes('isActive')) {
        return { status: 0, stdout: 'false', stderr: '' };
      }
      return { status: 0, stdout: '7', stderr: '' };
    });
    try {
      await assert.rejects(
        () =>
          runUnstake({
            amount: '1',
            from: HOLDER,
            maxFee: '0.01',
            execute: false,
            env: POOL_ENV,
          }),
        /not active/,
      );
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
