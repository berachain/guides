import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { resolveValidatorLocality } from '../lib/interview.mjs';

describe('TP-1 locality resolution', () => {
  it('classifies validator-local when BEACOND_HOME is set and beacond reads keys', () => {
    setBeacondRunner((args) => {
      if (args.includes('validator-keys')) {
        return { status: 0, stdout: 'Eth/Beacon Pubkey (Compressed 48-byte Hex):\n0x' + 'ab'.repeat(48), stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    try {
      const resolved = resolveValidatorLocality({ BEACOND_HOME: '/tmp/beacond', BEACOND_BIN: 'beacond' });
      assert.equal(resolved.locality, 'local');
    } finally {
      setBeacondRunner(null);
    }
  });

  it('classifies validator-remote when BEACOND_HOME is unset', () => {
    const resolved = resolveValidatorLocality({ BEACOND_BIN: 'beacond' });
    assert.equal(resolved.locality, 'remote');
  });

  it('classifies validator-remote when BEACOND_HOME is set but beacond cannot read keys', () => {
    setBeacondRunner((args) => {
      if (args.includes('validator-keys')) {
        return { status: 1, stdout: '', stderr: 'no keys in home' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    try {
      const resolved = resolveValidatorLocality({ BEACOND_HOME: '/tmp/beacond', BEACOND_BIN: 'beacond' });
      assert.equal(resolved.locality, 'remote');
    } finally {
      setBeacondRunner(null);
    }
  });
});
