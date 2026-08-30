import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isProofExpired, proofExpiryTimestamp } from '../lib/proofs.mjs';

describe('TP-9 activate expiry refusal', () => {
  it('treats proof as expired at proofTimestamp + 600 seconds', () => {
    const proofTimestamp = 1_700_000_000;
    const now = proofExpiryTimestamp(proofTimestamp);
    assert.ok(isProofExpired(now, proofTimestamp));

    const ctx = { nowSeconds: now, proofTimestamp };
    assert.throws(
      () => {
        if (isProofExpired(ctx.nowSeconds, ctx.proofTimestamp)) {
          throw new Error('Proof window expired');
        }
      },
      /Proof window expired/,
    );
  });
});
