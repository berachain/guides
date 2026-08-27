import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSendArgv, buildCallOnlyArgv } from '../lib/tx-runner.mjs';
import { resolveMinBalanceAmount } from '../lib/commands/set-min-balance.mjs';
import { DEFAULT_MIN_EFFECTIVE_BALANCE_WEI } from '../lib/constants.mjs';

describe('TP-10 set-min-balance default amount', () => {
  it('uses 250000 BERA when amount omitted', () => {
    const resolved = resolveMinBalanceAmount({});
    assert.equal(resolved.bera, '250000');
    assert.equal(resolved.wei, DEFAULT_MIN_EFFECTIVE_BALANCE_WEI);

    const dryRun = buildCallOnlyArgv(
      '0xpool',
      'setMinEffectiveBalance(uint256)',
      [resolved.wei],
      'http://rpc',
    );
    const execute = buildSendArgv(
      '0xpool',
      'setMinEffectiveBalance(uint256)',
      [resolved.wei],
      'http://rpc',
      {},
    );
    assert.equal(dryRun[0], 'call');
    assert.equal(execute[0], 'send');
    assert.ok(execute.includes(resolved.wei));
  });
});
