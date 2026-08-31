import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectInstallPhase } from '../lib/pool-phase.mjs';

describe('TP-5 install phase detection', () => {
  it('classifies not deployed', () => {
    assert.equal(
      detectInstallPhase({
        deployed: false,
        fullyExited: false,
        poolActive: false,
        beacon: { found: false },
        stakeTargetBera: '0',
        stakeComplete: true,
      }),
      'not_deployed',
    );
  });

  it('classifies deposited awaiting registration', () => {
    assert.equal(
      detectInstallPhase({
        deployed: true,
        fullyExited: false,
        poolActive: false,
        beacon: { found: false },
        stakeTargetBera: '0',
        stakeComplete: true,
      }),
      'deposited_awaiting_registration',
    );
  });

  it('classifies registered awaiting activation', () => {
    assert.equal(
      detectInstallPhase({
        deployed: true,
        fullyExited: false,
        poolActive: false,
        beacon: { found: true, index: '12' },
        stakeTargetBera: '100',
        stakeComplete: false,
      }),
      'registered_awaiting_activation',
    );
  });

  it('classifies active under stake target', () => {
    assert.equal(
      detectInstallPhase({
        deployed: true,
        fullyExited: false,
        poolActive: true,
        beacon: { found: true, index: '12' },
        stakeTargetBera: '100',
        stakeComplete: false,
      }),
      'active_under_stake_target',
    );
  });

  it('classifies done when active and stake complete or not planned', () => {
    assert.equal(
      detectInstallPhase({
        deployed: true,
        fullyExited: false,
        poolActive: true,
        beacon: { found: true },
        stakeTargetBera: '0',
        stakeComplete: true,
      }),
      'done',
    );
  });

  it('refuses fully exited', () => {
    assert.equal(
      detectInstallPhase({
        deployed: true,
        fullyExited: true,
        poolActive: false,
        beacon: { found: false },
        stakeTargetBera: '0',
        stakeComplete: true,
      }),
      'fully_exited',
    );
  });
});
