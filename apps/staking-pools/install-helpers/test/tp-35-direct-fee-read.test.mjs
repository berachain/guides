import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveFee } from '../lib/commands/unstake.mjs';

const VAULT = '0x' + '77'.repeat(20);

describe('TP-2 direct EIP-7002 fee read replaces the probe ladder', () => {
  it('calls getWithdrawalRequestFee exactly once and uses its return value', async () => {
    let calls = 0;
    const chainReader = {
      call: async (target, signature) => {
        calls += 1;
        assert.equal(target, VAULT);
        assert.equal(signature, 'getWithdrawalRequestFee()(uint256)');
        return { decoded: [12345n] };
      },
    };
    const fee = await resolveFee({ options: {}, chainReader, vault: VAULT });
    assert.equal(fee, '12345');
    assert.equal(calls, 1);
  });

  it('fails naming the read failure with no fallback probing when the read reverts', async () => {
    const chainReader = {
      call: async () => {
        throw new Error('eth_call reverted: FeeRequestFailed');
      },
    };
    await assert.rejects(
      () => resolveFee({ options: {}, chainReader, vault: VAULT }),
      /FeeRequestFailed/,
    );
  });
});

describe('TP-3 --max-fee still overrides the direct read', () => {
  it('never calls the chain reader when --max-fee is explicitly passed', async () => {
    let calls = 0;
    const chainReader = {
      call: async () => {
        calls += 1;
        return { decoded: [1n] };
      },
    };
    const fee = await resolveFee({ options: { maxFee: '0.001' }, chainReader, vault: VAULT });
    assert.equal(fee, '1000000000000000');
    assert.equal(calls, 0);
  });
});
