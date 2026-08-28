import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runStatus } from '../lib/commands/status.mjs';

// TP-20 exists for the same reason as TP-18/TP-19: TP-17 only unit-tests
// classifyPoolPhase and getBeaconValidator in isolation. Nothing calls
// lib/commands/status.mjs itself, so a broken import there is invisible.

const PUBKEY = `0x${'aa'.repeat(48)}`;
const SMART_OPERATOR = `0x${'22'.repeat(20)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const REWARDS_VAULT = `0x${'44'.repeat(20)}`;
const INCENTIVE_COLLECTOR = `0x${'55'.repeat(20)}`;
const WITHDRAWAL_VAULT = `0x${'11'.repeat(20)}`;
const NULL_ADDRESS = `0x${'0'.repeat(40)}`;

function beacondRouter() {
  return {
    status: 0,
    stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}\n`,
    stderr: '',
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function fetchNotFound() {
  return jsonResponse(404, {});
}

function fetchFoundPending() {
  return jsonResponse(200, { data: { index: '36', status: 'pending_initialized', balance: '32000000000' } });
}

function baseCastRoutes(argv, { isActive, fullyExited, withdrawalVault }) {
  const [cmd, target, signature] = argv;
  if (cmd === 'call' && target === withdrawalVault) return null;
  if (cmd === 'call' && signature === 'delegationHandlers(bytes)(address)') {
    return { status: 0, stdout: NULL_ADDRESS, stderr: '' };
  }
  if (cmd === 'call' && signature === 'getCoreContracts(bytes)(address,address,address,address)') {
    return {
      status: 0,
      stdout: `${SMART_OPERATOR}\n${STAKING_POOL}\n${REWARDS_VAULT}\n${INCENTIVE_COLLECTOR}`,
      stderr: '',
    };
  }
  if (cmd === 'code') {
    return { status: 0, stdout: '0x6080', stderr: '' };
  }
  if (cmd === 'call' && signature === 'getOperator(bytes)(address)') {
    return { status: 0, stdout: SMART_OPERATOR, stderr: '' };
  }
  if (cmd === 'call' && signature === 'isActive()(bool)') {
    return { status: 0, stdout: isActive ? 'true' : 'false', stderr: '' };
  }
  if (cmd === 'call' && signature === 'activeThresholdReached()(bool)') {
    return { status: 0, stdout: 'true', stderr: '' };
  }
  if (cmd === 'call' && signature === 'isFullyExited()(bool)') {
    return { status: 0, stdout: fullyExited ? 'true' : 'false', stderr: '' };
  }
  return undefined;
}

describe('TP-20 runStatus smoke test', () => {
  it('reports awaiting_beacon before the validator is included (pre-activate)', async () => {
    setCastRunner((argv) => {
      const routed = baseCastRoutes(argv, { isActive: false, fullyExited: false, withdrawalVault: WITHDRAWAL_VAULT });
      if (routed) return routed;
      throw new Error(`TP-20 cast mock has no route for ${JSON.stringify(argv)}`);
    });
    setBeacondRunner(beacondRouter);
    try {
      const result = await runStatus({
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        fetchImpl: fetchNotFound,
      });
      assert.equal(result.active, false);
      assert.equal(result.phase, 'awaiting_beacon');
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('reports full telemetry once the pool is active (post-activate)', async () => {
    setCastRunner((argv) => {
      const [cmd, , signature] = argv;
      if (cmd === 'call' && signature === 'totalAssets()(uint256)') {
        return { status: 0, stdout: '10000000000000000000000', stderr: '' };
      }
      if (cmd === 'call' && signature === 'totalSupply()(uint256)') {
        return { status: 0, stdout: '10000000000000000000000', stderr: '' };
      }
      if (cmd === 'call' && signature === 'bufferedAssets()(uint256)') {
        return { status: 0, stdout: '0', stderr: '' };
      }
      if (cmd === 'call' && signature === 'minEffectiveBalance()(uint256)') {
        return { status: 0, stdout: '250000000000000000000000', stderr: '' };
      }
      if (cmd === 'call' && signature === 'availableWBERABalance()(uint256)') {
        return { status: 0, stdout: '0', stderr: '' };
      }
      if (cmd === 'call' && signature === 'rebaseableWberaAmount()(uint256)') {
        return { status: 0, stdout: '0', stderr: '' };
      }
      if (cmd === 'call' && signature === 'getEarnedWBERAFeeState()(uint256,uint256,uint256,uint96)') {
        return { status: 0, stdout: '0,0,0,1000', stderr: '' };
      }
      if (cmd === 'call' && signature === 'unboostedBalance()(uint256)') {
        return { status: 0, stdout: '0', stderr: '' };
      }
      if (cmd === 'call' && signature === 'getEarnedBGTFeeState()(uint256,uint256,uint256,uint96)') {
        return { status: 0, stdout: '0,0,0,1000', stderr: '' };
      }
      if (cmd === 'from-wei') {
        return { status: 0, stdout: '0', stderr: '' };
      }
      const routed = baseCastRoutes(argv, { isActive: true, fullyExited: false, withdrawalVault: WITHDRAWAL_VAULT });
      if (routed) return routed;
      throw new Error(`TP-20 cast mock has no route for ${JSON.stringify(argv)}`);
    });
    setBeacondRunner(beacondRouter);
    try {
      const result = await runStatus({
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        fetchImpl: fetchFoundPending,
      });
      assert.equal(result.active, true);
      assert.equal(result.phase, 'pool_active');
      assert.equal(result.stakingPool, STAKING_POOL);
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
