import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createColdSigningSigner } from '../lib/signers.mjs';
import { resolveMinBalanceAmount } from '../lib/commands/set-min-balance.mjs';
import { DEFAULT_MIN_EFFECTIVE_BALANCE_WEI } from '../lib/constants.mjs';

describe('TP-10 set-min-balance default amount', () => {
  it('uses 250000 BERA when amount omitted and emits setMinEffectiveBalance cast send', () => {
    const resolved = resolveMinBalanceAmount({});
    assert.equal(resolved.bera, '250000');
    assert.equal(resolved.wei, DEFAULT_MIN_EFFECTIVE_BALANCE_WEI);

    const signer = createColdSigningSigner({ rpcUrl: 'http://rpc' });
    const command = signer.formatCastSend({
      target: '0xpool',
      signature: 'setMinEffectiveBalance(uint256)',
      args: [resolved.wei],
      value: 0n,
    });
    assert.ok(command.startsWith('cast send'));
    assert.ok(command.includes('setMinEffectiveBalance(uint256)'));
    assert.ok(command.includes(resolved.wei));
    assert.ok(command.includes('--ledger'));
  });
});
