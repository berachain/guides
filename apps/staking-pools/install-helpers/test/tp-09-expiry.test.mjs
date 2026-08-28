import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { runTransaction } from '../lib/tx-runner.mjs';
import { isProofExpired, proofExpiryTimestamp } from '../lib/proofs.mjs';

describe('TP-9 activate expiry refusal', () => {
  it('refuses emit and execute when now >= proofTimestamp + 600 without cast send', async () => {
    const proofTimestamp = 1_700_000_000;
    const now = proofExpiryTimestamp(proofTimestamp);
    assert.ok(isProofExpired(now, proofTimestamp));

    const calls = [];
    setCastRunner((argv) => {
      calls.push(argv[0]);
      return { status: 0, stdout: '0x', stderr: '' };
    });

    try {
      await assert.rejects(
        () =>
          runTransaction(
            {
              execute: false,
              rpcUrl: 'http://example',
              env: {},
              proofTimestamp,
              nowSeconds: now,
            },
            {
              label: 'activateStakingPool',
              target: '0xfactory',
              signature: 'activateStakingPool()',
              buildCalldataArgs: () => [],
              beforeEmit: (ctx) => {
                if (isProofExpired(ctx.nowSeconds, ctx.proofTimestamp)) {
                  throw new Error('Proof window expired');
                }
              },
            },
          ),
        /Proof window expired/,
      );
      assert.deepEqual(calls, ['call']);

      const executeCalls = [];
      setCastRunner((argv) => {
        executeCalls.push(argv[0]);
        return { status: 0, stdout: '0x', stderr: '' };
      });

      await assert.rejects(
        () =>
          runTransaction(
            {
              execute: true,
              rpcUrl: 'http://example',
              env: { PRIVATE_KEY: '0x' + '11'.repeat(32) },
              proofTimestamp,
              nowSeconds: now,
            },
            {
              label: 'activateStakingPool',
              target: '0xfactory',
              signature: 'activateStakingPool()',
              buildCalldataArgs: () => [],
              beforeEmit: (ctx) => {
                if (isProofExpired(ctx.nowSeconds, ctx.proofTimestamp)) {
                  throw new Error('Proof window expired');
                }
              },
            },
          ),
        /Proof window expired/,
      );
      assert.deepEqual(executeCalls, ['call']);
    } finally {
      setCastRunner(null);
    }
  });
});
