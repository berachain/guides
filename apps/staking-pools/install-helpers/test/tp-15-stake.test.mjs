import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createColdSigningSigner } from '../lib/signers.mjs';
import { beraToGwei, beraToWei } from '../lib/units.mjs';

describe('TP-15 stake submit', () => {
  it('converts BERA to wei without bc', () => {
    assert.equal(beraToWei('100', '--amount').wei, '100000000000000000000');
    assert.equal(beraToGwei('100', '--amount').gwei, '100000000000');
  });

  it('cold-signing prints submit(address) cast send with value and ledger flag', () => {
    const signer = createColdSigningSigner({ rpcUrl: 'http://127.0.0.1:8545' });
    const command = signer.formatCastSend({
      target: '0x' + 'aa'.repeat(20),
      signature: 'submit(address)',
      args: ['0x' + '33'.repeat(20)],
      value: 100n * 10n ** 18n,
    });
    assert.ok(command.startsWith('cast send'));
    assert.ok(command.includes('submit(address)'));
    assert.ok(command.includes('--ledger'));
    assert.ok(command.includes('100.0ether') || command.includes('100ether'));
  });
});
