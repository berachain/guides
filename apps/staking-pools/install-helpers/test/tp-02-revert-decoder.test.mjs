import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeActivationRevert,
  decodeWithdrawalRevert,
  extractRevertSelector,
} from '../lib/revert-decoder.mjs';

describe('TP-2 activation revert decoder', () => {
  const cases = [
    ['0x7b5d09a5', 'InvalidInitialDepositAmount'],
    ['0xccea9e6f', 'InvalidOperator'],
    ['0x9be73159', 'InvalidWithdrawalCredentials'],
    ['0xb7d09497', 'InvalidTimestamp'],
    ['0xa7baf889', 'InvalidBeaconBlockRoot'],
    ['0x09bde339', 'InvalidProof'],
    ['0xc52e3eff', 'InvalidBalance'],
    ['0x1390f2a1', 'IndexOutOfRange'],
    ['0x6cbf06ef', 'StakingPoolAlreadyActivated'],
  ];

  for (const [selector, label] of cases) {
    it(`maps ${selector} to ${label}`, () => {
      const decoded = decodeActivationRevert(`execution reverted: custom error ${selector}`);
      assert.match(decoded, new RegExp(label));
    });
  }

  it('maps withdrawal vault selectors', () => {
    assert.match(
      decodeWithdrawalRevert('execution reverted: custom error 0x025dbdd4'),
      /InsufficientFee/,
    );
    assert.match(
      decodeWithdrawalRevert('execution reverted: custom error 0xecc7a37c'),
      /RequestNotReady/,
    );
  });

  it('passes unknown selectors through unchanged', () => {
    const raw = 'execution reverted: 0xdeadbeef';
    assert.equal(decodeActivationRevert(raw), raw);
    assert.equal(extractRevertSelector(raw), '0xdeadbeef');
  });
});
