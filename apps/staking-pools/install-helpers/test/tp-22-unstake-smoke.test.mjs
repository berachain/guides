import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runUnstake } from '../lib/commands/unstake.mjs';

// TP-22 exists for the same reason as TP-18/19/20/21: TP-16 exercises
// resolveUnstakeMode and runTransaction directly, never lib/commands/unstake.mjs.
// That module's own wiring (assertPoolActive, pool-target resolution, and the
// EIP-7002 fee probe loop) is untested end to end without this file.

const PUBKEY = `0x${'aa'.repeat(48)}`;
const SMART_OPERATOR = `0x${'22'.repeat(20)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const REWARDS_VAULT = `0x${'44'.repeat(20)}`;
const INCENTIVE_COLLECTOR = `0x${'55'.repeat(20)}`;
const WITHDRAWAL_VAULT = `0x${'11'.repeat(20)}`;
const FROM = `0x${'99'.repeat(20)}`;

function beacondRouter() {
  return {
    status: 0,
    stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}\n`,
    stderr: '',
  };
}

function poolTargetRoutes(argv) {
  const [cmd, , signature] = argv;
  if (cmd === 'call' && signature === 'withdrawalVault()(address)') {
    return { status: 0, stdout: WITHDRAWAL_VAULT, stderr: '' };
  }
  if (cmd === 'call' && signature === 'getCoreContracts(bytes)(address,address,address,address)') {
    return {
      status: 0,
      stdout: `${SMART_OPERATOR}\n${STAKING_POOL}\n${REWARDS_VAULT}\n${INCENTIVE_COLLECTOR}`,
      stderr: '',
    };
  }
  return undefined;
}

describe('TP-22 runUnstake smoke test', () => {
  it('refuses to request a withdrawal when the pool is not active', async () => {
    setCastRunner((argv) => {
      const routed = poolTargetRoutes(argv);
      if (routed) return routed;
      const [cmd, , signature] = argv;
      if (cmd === 'call' && signature === 'isActive()(bool)') {
        return { status: 0, stdout: 'false', stderr: '' };
      }
      throw new Error(`TP-22 cast mock has no route for ${JSON.stringify(argv)}`);
    });
    setBeacondRunner(beacondRouter);
    try {
      await assert.rejects(
        () =>
          runUnstake({
            execute: false,
            env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
            amount: '1',
            from: FROM,
          }),
        /Pool is not active/,
      );
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('probes EIP-7002 fee candidates and emits requestWithdrawal for --amount', async () => {
    setCastRunner((argv) => {
      const routed = poolTargetRoutes(argv);
      if (routed) return routed;
      const [cmd, , signature] = argv;
      if (cmd === 'call' && signature === 'isActive()(bool)') {
        return { status: 0, stdout: 'true', stderr: '' };
      }
      if (cmd === 'call' && signature === 'requestWithdrawal(bytes,uint64,uint256)(uint256)') {
        const fee = argv.at(-1);
        if (fee === '0' || fee === '100000000000000') {
          return { status: 1, stdout: '', stderr: 'execution reverted' };
        }
        return { status: 0, stdout: '7', stderr: '' };
      }
      throw new Error(`TP-22 cast mock has no route for ${JSON.stringify(argv)}`);
    });
    setBeacondRunner(beacondRouter);
    try {
      const result = await runUnstake({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        amount: '1',
        from: FROM,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.join(' ').includes('requestWithdrawal'));
      assert.ok(result.sendArgv.join(' ').includes('--value 300000000000000'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('honors --max-fee instead of probing candidates', async () => {
    let requestArgv;
    setCastRunner((argv) => {
      const routed = poolTargetRoutes(argv);
      if (routed) return routed;
      const [cmd, , signature] = argv;
      if (cmd === 'call' && signature === 'isActive()(bool)') {
        return { status: 0, stdout: 'true', stderr: '' };
      }
      if (cmd === 'call' && signature === 'requestRedeem(bytes,uint256,uint256)(uint256)') {
        requestArgv = argv;
        return { status: 0, stdout: '9', stderr: '' };
      }
      throw new Error(`TP-22 max-fee cast mock has no route for ${JSON.stringify(argv)}`);
    });
    setBeacondRunner(beacondRouter);
    try {
      const result = await runUnstake({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        shares: '2',
        from: FROM,
        maxFee: '0.001',
      });
      assert.equal(result.mode, 'emit');
      assert.ok(requestArgv.includes('1000000000000000'));
      assert.ok(result.sendArgv.join(' ').includes('requestRedeem'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('finalizes a withdrawal request by id', async () => {
    setCastRunner((argv) => {
      const routed = poolTargetRoutes(argv);
      if (routed) return routed;
      const [cmd, , signature] = argv;
      if (cmd === 'call' && signature === 'isActive()(bool)') {
        return { status: 0, stdout: 'true', stderr: '' };
      }
      if (cmd === 'call' && signature === 'finalizeWithdrawalRequest(uint256)') {
        return { status: 0, stdout: '', stderr: '' };
      }
      throw new Error(`TP-22 finalize cast mock has no route for ${JSON.stringify(argv)}`);
    });
    setBeacondRunner(beacondRouter);
    try {
      const result = await runUnstake({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        finalize: '42',
        from: FROM,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.join(' ').includes('finalizeWithdrawalRequest(uint256) 42'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
