import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runStake } from '../lib/commands/stake.mjs';

// TP-21 exists for the same reason as TP-18/19/20: TP-15 unit-tests unit
// conversion and runTransaction wiring directly. Nothing calls
// lib/commands/stake.mjs itself, so pool-target.mjs resolution (beacond +
// getCoreContracts + getWithdrawalVault) is never exercised end to end.

const PUBKEY = `0x${'aa'.repeat(48)}`;
const SMART_OPERATOR = `0x${'22'.repeat(20)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const REWARDS_VAULT = `0x${'44'.repeat(20)}`;
const INCENTIVE_COLLECTOR = `0x${'55'.repeat(20)}`;
const WITHDRAWAL_VAULT = `0x${'11'.repeat(20)}`;
const RECEIVER = `0x${'99'.repeat(20)}`;

function beacondRouter() {
  return {
    status: 0,
    stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}\n`,
    stderr: '',
  };
}

function castRouter(argv) {
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
  if (cmd === 'call' && signature === 'submit(address)') {
    return { status: 0, stdout: '', stderr: '' };
  }
  throw new Error(`TP-21 cast mock has no route for ${JSON.stringify(argv)}`);
}

describe('TP-21 runStake smoke test', () => {
  it('resolves the operator pool through beacond+cast and emits a copy-paste submit', async () => {
    setCastRunner(castRouter);
    setBeacondRunner(beacondRouter);
    try {
      const result = await runStake({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        amount: '5',
        receiver: RECEIVER,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.join(' ').includes(`submit(address) ${RECEIVER}`));
      assert.ok(result.sendArgv.join(' ').includes('--value 5ether'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('honors an explicit --staking-pool without calling getCoreContracts', async () => {
    setCastRunner((argv) => {
      const [cmd, , signature] = argv;
      if (cmd === 'call' && signature === 'withdrawalVault()(address)') {
        return { status: 0, stdout: WITHDRAWAL_VAULT, stderr: '' };
      }
      if (cmd === 'call' && signature === 'submit(address)') {
        return { status: 0, stdout: '', stderr: '' };
      }
      throw new Error(`TP-21 explicit-pool cast mock has no route for ${JSON.stringify(argv)}`);
    });
    setBeacondRunner(beacondRouter);
    try {
      const explicitPool = `0x${'ab'.repeat(20)}`;
      const result = await runStake({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        amount: '1',
        receiver: RECEIVER,
        stakingPool: explicitPool,
      });
      assert.ok(result.sendArgv.includes(explicitPool));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
