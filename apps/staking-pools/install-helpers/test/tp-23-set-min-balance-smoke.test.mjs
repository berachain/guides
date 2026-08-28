import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runSetMinBalance } from '../lib/commands/set-min-balance.mjs';

// TP-23 exists for the same reason as TP-18/19/20/21/22: TP-6 and TP-10 test
// resolveMinBalanceAmount and runTransaction directly. Nothing calls
// lib/commands/set-min-balance.mjs itself.

const PUBKEY = `0x${'aa'.repeat(48)}`;
const SMART_OPERATOR = `0x${'22'.repeat(20)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const REWARDS_VAULT = `0x${'44'.repeat(20)}`;
const INCENTIVE_COLLECTOR = `0x${'55'.repeat(20)}`;

function beacondRouter() {
  return {
    status: 0,
    stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}\n`,
    stderr: '',
  };
}

function castRouter(argv) {
  const [cmd, , signature] = argv;
  if (cmd === 'call' && signature === 'predictStakingPoolContractsAddresses(bytes)(address,address,address,address)') {
    return {
      status: 0,
      stdout: `${SMART_OPERATOR}\n${STAKING_POOL}\n${REWARDS_VAULT}\n${INCENTIVE_COLLECTOR}`,
      stderr: '',
    };
  }
  if (cmd === 'call' && signature === 'setMinEffectiveBalance(uint256)') {
    return { status: 0, stdout: '', stderr: '' };
  }
  throw new Error(`TP-23 cast mock has no route for ${JSON.stringify(argv)}`);
}

describe('TP-23 runSetMinBalance smoke test', () => {
  it('uses the 250,000 BERA default when --amount is omitted', async () => {
    setCastRunner(castRouter);
    setBeacondRunner(beacondRouter);
    try {
      const result = await runSetMinBalance({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.includes('250000000000000000000000'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('honors an explicit --amount override', async () => {
    setCastRunner(castRouter);
    setBeacondRunner(beacondRouter);
    try {
      const result = await runSetMinBalance({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        amount: '300000',
      });
      assert.ok(result.sendArgv.includes('300000000000000000000000'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
