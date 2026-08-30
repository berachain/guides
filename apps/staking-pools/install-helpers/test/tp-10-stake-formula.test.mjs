import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ethers } from '../lib/ethers-bundle.mjs';
import {
  computeAdditionalStakeBera,
  DEPOSIT_BERA,
  HOT_KEY_GAS_BUFFER_BERA,
} from '../lib/stake-formula.mjs';

describe('TP-10 additional stake formula', () => {
  it('computes max(0, balance - deposit - gas_buffer) floored to whole BERA', () => {
    const deposit = ethers.parseEther(String(DEPOSIT_BERA));
    const buffer = ethers.parseEther(String(HOT_KEY_GAS_BUFFER_BERA));
    const balance = deposit + buffer + ethers.parseEther('240000');
    assert.equal(computeAdditionalStakeBera(balance.toString()), '240000');
  });

  it('returns 0 when balance only covers deposit + buffer', () => {
    const balance = ethers.parseEther(String(DEPOSIT_BERA + HOT_KEY_GAS_BUFFER_BERA));
    assert.equal(computeAdditionalStakeBera(balance.toString()), '0');
  });

  it('uses zero gas buffer in cold-signing mode', () => {
    const balance = ethers.parseEther(String(DEPOSIT_BERA + 5));
    assert.equal(computeAdditionalStakeBera(balance.toString(), { coldSigning: true }), '5');
  });
});
