import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveUnstakeMode } from '../lib/commands/unstake.mjs';
import { createColdSigningSigner } from '../lib/signers.mjs';

describe('TP-16 unstake modes', () => {
  it('requires exactly one of amount, shares, or finalize', () => {
    assert.throws(() => resolveUnstakeMode({}), /exactly one/);
    assert.throws(
      () => resolveUnstakeMode({ amount: '1', shares: '1' }),
      /exactly one/,
    );
    assert.equal(resolveUnstakeMode({ amount: '10' }), 'assets');
    assert.equal(resolveUnstakeMode({ shares: '10' }), 'shares');
    assert.equal(resolveUnstakeMode({ finalize: '42' }), 'finalize');
  });

  it('cold-signing prints requestWithdrawal cast send with fee value', () => {
    const signer = createColdSigningSigner({ rpcUrl: 'http://127.0.0.1:8545' });
    const command = signer.formatCastSend({
      target: '0x' + 'bb'.repeat(20),
      signature: 'requestWithdrawal(bytes,uint64,uint256)(uint256)',
      args: [`0x${'ab'.repeat(48)}`, '100000000000', '1000'],
      value: 1000n,
    });
    assert.ok(command.includes('cast send'));
    assert.ok(command.includes('requestWithdrawal'));
    assert.ok(command.includes('--ledger'));
  });
});
