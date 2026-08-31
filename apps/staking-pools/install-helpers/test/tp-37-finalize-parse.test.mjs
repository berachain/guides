import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveFinalizeTarget, resolveUnstakeMode } from '../lib/commands/unstake.mjs';
import { parseUnstakeArgs } from '../pool-cli.mjs';

const FROM = '0x' + '11'.repeat(20);

describe('TP-4c argv parsing for --finalize', () => {
  it('--finalize with no following token means finalize-all', () => {
    const parsed = parseUnstakeArgs(['--finalize']);
    assert.equal(parsed.finalize, '');
  });

  it('--finalize followed immediately by another recognized flag (--from) means finalize-all, and --from is still parsed correctly', () => {
    const parsed = parseUnstakeArgs(['--finalize', '--from', FROM]);
    assert.equal(parsed.finalize, '');
    assert.equal(parsed.from, FROM);
  });

  it('--finalize <numeric-id> means single-ID', () => {
    const parsed = parseUnstakeArgs(['--finalize', '42', '--from', FROM]);
    assert.equal(parsed.finalize, '42');
    assert.equal(parsed.from, FROM);
  });

  it('--finalize absent entirely leaves finalize undefined', () => {
    const parsed = parseUnstakeArgs(['--amount', '10']);
    assert.equal(parsed.finalize, undefined);
  });
});

describe('TP-4c resolveUnstakeMode treats a present --finalize (any value) as finalize mode', () => {
  it('an empty-string finalize (present, no id) still resolves to finalize mode', () => {
    assert.equal(resolveUnstakeMode({ finalize: '' }), 'finalize');
  });

  it('a numeric finalize resolves to finalize mode', () => {
    assert.equal(resolveUnstakeMode({ finalize: '42' }), 'finalize');
  });

  it('finalize present alongside amount/shares is still an exclusivity error', () => {
    assert.throws(() => resolveUnstakeMode({ finalize: '', amount: '1' }), /exactly one/);
  });

  it('rejects when nothing is passed at all', () => {
    assert.throws(() => resolveUnstakeMode({}), /exactly one/);
  });
});

describe('TP-4c resolveFinalizeTarget: exact finalize-all vs single-ID rule', () => {
  it('empty string means finalize-all', () => {
    assert.deepEqual(resolveFinalizeTarget(''), { mode: 'all' });
  });

  it('undefined means finalize-all', () => {
    assert.deepEqual(resolveFinalizeTarget(undefined), { mode: 'all' });
  });

  it('a valid non-negative integer string means single-ID', () => {
    assert.deepEqual(resolveFinalizeTarget('42'), { mode: 'single', requestId: '42' });
    assert.deepEqual(resolveFinalizeTarget('0'), { mode: 'single', requestId: '0' });
  });

  it('non-numeric garbage is a clear error, not a silent finalize-all', () => {
    assert.throws(() => resolveFinalizeTarget('abc'), /request id/i);
  });
});
