import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../lib/constants.mjs';
import { createColdSigningSigner } from '../lib/signers.mjs';
import { shellQuoteArg } from '../lib/cast-format.mjs';

describe('TP-24 cold-signing cast shell quoting', () => {
  it('quotes function signatures containing parentheses and commas', () => {
    const signer = createColdSigningSigner({ rpcUrl: 'http://127.0.0.1:8545' });
    const command = signer.formatCastSend({
      target: '0x' + '24'.repeat(20),
      signature: 'deployStakingPoolContracts(bytes,bytes,bytes,address,address)',
      args: ['0x' + 'aa'.repeat(48), '0x' + 'bb'.repeat(32), '0x' + 'cc'.repeat(96), '0x' + '11'.repeat(20), '0x' + '22'.repeat(20)],
      value: 10_000n * 10n ** 18n,
    });

    assert.ok(command.includes("'deployStakingPoolContracts(bytes,bytes,bytes,address,address)'"));
    assert.ok(!command.includes('deployStakingPoolContracts(bytes,bytes,bytes,address,address) '));
  });

  it('quotes tuple and array calldata arguments for activateStakingPool', () => {
    const signer = createColdSigningSigner({ rpcUrl: 'http://127.0.0.1:8545' });
    const command = signer.formatCastSend({
      target: STAKING_POOL_FACTORY_BEPOLIA,
      signature:
        'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)',
      args: [
        ['0x' + 'aa'.repeat(48), '0x' + 'bb'.repeat(32), '10000000000000', '36'],
        [['0x01'], ['0x02'], ['0x03'], '0x' + '44'.repeat(32)],
        '1700000000',
      ],
      value: 0n,
    });

    assert.ok(command.includes("'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)'"));
    assert.ok(command.includes("'("));
    assert.ok(command.includes('[0x01'));
  });

  it('shellQuoteArg leaves simple addresses unquoted', () => {
    assert.equal(shellQuoteArg('0x' + 'ab'.repeat(20)), '0x' + 'ab'.repeat(20));
  });
});
