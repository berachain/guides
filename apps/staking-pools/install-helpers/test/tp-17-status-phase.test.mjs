import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getBeaconValidator, getValidatorIndex } from '../lib/beacond.mjs';
import { classifyPoolPhase } from '../lib/pool-phase.mjs';

describe('TP-17 status activation readiness', () => {
  it('treats CL 404 as awaiting beacon, not ready to activate', () => {
    const phase = classifyPoolPhase({
      fullyExited: false,
      poolActive: false,
      beacon: { found: false },
    });
    assert.equal(phase.phase, 'awaiting_beacon');
    assert.match(phase.next, /Do not run activate yet/);
  });

  it('reports ready_to_activate when beacon has the validator and pool is inactive', () => {
    const phase = classifyPoolPhase({
      fullyExited: false,
      poolActive: false,
      beacon: { found: true, index: '81', status: 'pending_queued' },
    });
    assert.equal(phase.phase, 'ready_to_activate');
    assert.match(phase.headline, /index 81/);
    assert.match(phase.headline, /pending_queued/);
    assert.match(phase.next, /activate/);
  });

  it('does not tell the operator to activate when isActive is already true', () => {
    const phase = classifyPoolPhase({
      fullyExited: false,
      poolActive: true,
      beacon: { found: true, index: '81', status: 'active_ongoing' },
    });
    assert.equal(phase.phase, 'pool_active');
    assert.equal(phase.next, '');
  });

  it('looks up one validator by pubkey instead of listing the set', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return {
        status: 404,
        ok: false,
        async text() {
          return '{"code":404,"message":"not found"}';
        },
      };
    };
    const record = await getBeaconValidator(
      'http://127.0.0.1:40005',
      '0x' + 'aa'.repeat(48),
      fetchImpl,
    );
    assert.equal(record.found, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/validators\/0xaa/);
    assert.ok(!calls[0].endsWith('/validators'));

    const index = await getValidatorIndex(
      'http://127.0.0.1:40005',
      '0x' + 'aa'.repeat(48),
      async (url) => {
        assert.match(url, /\/validators\/0x/);
        return {
          status: 200,
          ok: true,
          async text() {
            return JSON.stringify({
              data: { index: '12', status: 'pending_initialized', balance: '10000000000000' },
            });
          },
        };
      },
    );
    assert.equal(index, '12');
  });
});
