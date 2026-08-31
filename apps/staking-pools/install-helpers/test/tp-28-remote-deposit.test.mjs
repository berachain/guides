import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BEPOLIA_VALIDATOR_ROOT,
  DEPOSIT_AMOUNT_GWEI,
  MAINNET_VALIDATOR_ROOT,
} from '../lib/constants.mjs';
import {
  formatCreateValidatorCommand,
  parseDepositOutput,
  setBeacondRunner,
} from '../lib/beacond.mjs';

const VAULT = '0x' + 'ab'.repeat(20);

describe('TP-3 remote create-validator command', () => {
  it('prints a complete command for bepolia without calling beacond', () => {
    setBeacondRunner(() => {
      throw new Error('beacond must not be invoked');
    });
    try {
      const command = formatCreateValidatorCommand(VAULT, 'bepolia');
      assert.match(command, /beacond deposit create-validator/);
      assert.match(command, new RegExp(VAULT, 'i'));
      assert.match(command, new RegExp(DEPOSIT_AMOUNT_GWEI));
      assert.match(command, new RegExp(BEPOLIA_VALIDATOR_ROOT));
      assert.ok(!command.includes(MAINNET_VALIDATOR_ROOT));
    } finally {
      setBeacondRunner(null);
    }
  });

  it('prints a complete command for mainnet without calling beacond', () => {
    const command = formatCreateValidatorCommand(VAULT, 'mainnet');
    assert.match(command, new RegExp(MAINNET_VALIDATOR_ROOT));
    assert.match(command, new RegExp(DEPOSIT_AMOUNT_GWEI));
    assert.ok(!command.includes(BEPOLIA_VALIDATOR_ROOT));
  });
});

describe('TP-4 pasted deposit output parsing', () => {
  it('parses beacond create-validator text into the local-path field shape', () => {
    const pubkey = `0x${'ab'.repeat(48)}`;
    const credentials = `0x010000000000000000000000${VAULT.slice(2)}`;
    const signature = `0x${'11'.repeat(96)}`;
    const pasted = [
      `pubkey: ${pubkey}`,
      `credentials: ${credentials}`,
      `signature: ${signature}`,
      `amount: ${DEPOSIT_AMOUNT_GWEI}`,
    ].join('\n');

    const fields = parseDepositOutput(pasted);
    assert.deepEqual(fields, {
      pubkey,
      credentials,
      signature,
      amount: DEPOSIT_AMOUNT_GWEI,
    });
  });

  it('refuses malformed paste naming the missing fields', () => {
    assert.throws(
      () => parseDepositOutput('pubkey: 0xab\nnot-a-deposit'),
      /Could not parse deposit parameters/,
    );
  });
});
