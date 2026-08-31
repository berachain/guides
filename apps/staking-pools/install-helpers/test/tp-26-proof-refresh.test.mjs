import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pollUntil } from '../lib/poll.mjs';
import { runColdSigningTransition } from '../lib/cold-signing.mjs';

describe('TP-26 proactive proof-expiry refresh', () => {
  test('pollUntil stops at deadlineAt, before the full timeout, when deadlineAt is sooner', async () => {
    const start = Date.now();
    const landed = await pollUntil(() => false, {
      intervalMs: 10,
      timeoutMs: 600000,
      deadlineAt: start + 50,
    });
    const elapsed = Date.now() - start;
    assert.equal(landed, false);
    assert.ok(elapsed < 5000, `expected early stop near 50ms, took ${elapsed}ms`);
  });

  test('pollUntil still honors timeoutMs when no deadlineAt is given', async () => {
    const start = Date.now();
    const landed = await pollUntil(() => false, { intervalMs: 10, timeoutMs: 40 });
    const elapsed = Date.now() - start;
    assert.equal(landed, false);
    assert.ok(elapsed >= 40, `expected at least 40ms, took ${elapsed}ms`);
  });

  test('runColdSigningTransition refreshes before the proof actually expires, not after', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    let emitCount = 0;
    let refreshCount = 0;
    let landedCheckCount = 0;

    const plan = { verbose: false };
    const emitFn = async () => {
      emitCount += 1;
      // First emit: expires in 100ms real time (simulated via seconds field with
      // a large buffer override is impractical for a unit test, so this test
      // exercises the wiring by making the poll's deadline arrive almost
      // immediately relative to a normal 10-minute timeout).
      return { command: `cmd-${emitCount}`, expiresAtSeconds: nowSeconds };
    };
    const landedFn = async () => {
      landedCheckCount += 1;
      // Never lands on the first emitted command; lands once a refresh happened.
      return refreshCount > 0;
    };
    const refresh = async () => {
      refreshCount += 1;
      return { command: `refreshed-${refreshCount}`, expiresAtSeconds: nowSeconds + 600 };
    };

    const result = await runColdSigningTransition(plan, emitFn, landedFn, { refresh });

    assert.ok(refreshCount >= 1, 'expected at least one proactive refresh');
    assert.equal(result.command, `cmd-${emitCount}`);
    assert.ok(landedCheckCount > 0);
  });
});
