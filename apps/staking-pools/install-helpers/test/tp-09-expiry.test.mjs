import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';
import { isProofExpired, proofExpiryTimestamp } from '../lib/proofs.mjs';
import { runTransaction } from '../lib/tx-runner.mjs';

describe('TP-9 activate execute expiry refusal', () => {
  it('refuses execute when now >= proofTimestamp + 600 without cast send', async () => {
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
              execute: true,
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
              beforeExecute: (ctx) => {
                if (isProofExpired(ctx.nowSeconds, ctx.proofTimestamp)) {
                  throw new Error('Proof window expired');
                }
              },
            },
          ),
        /Proof window expired/,
      );
    } finally {
      setCastRunner(null);
    }

    assert.deepEqual(calls, ['call']);
  });
});
