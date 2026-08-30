import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoForbiddenCommands,
  checkDependencies,
  formatMissingDependency,
} from '../lib/deps.mjs';
import { FORBIDDEN_SHELL_COMMANDS } from '../lib/constants.mjs';
import { setBeacondRunner, assertValidatorPreflight } from '../lib/beacond.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';

describe('TP-5 dependency preflight', () => {
  it('names missing required tools (node + beacond only)', () => {
    const missing = checkDependencies({ BEACOND_BIN: '/definitely/missing/beacond' });
    assert.ok(missing.some((entry) => entry.name === 'beacond'));
    assert.ok(!missing.some((entry) => entry.name === 'cast'));
    assert.match(formatMissingDependency(missing[0]), /required/);
  });

  it('never allows forbidden shell commands as executables', () => {
    for (const forbidden of FORBIDDEN_SHELL_COMMANDS) {
      assert.throws(
        () => assertNoForbiddenCommands([forbidden, 'foo']),
        new RegExp(forbidden),
      );
    }
    assert.ok(FORBIDDEN_SHELL_COMMANDS.includes('cast'));
    assert.ok(!FORBIDDEN_SHELL_COMMANDS.includes('ethers'));
  });

  it('fails on missing BEACOND_HOME before chain access', async () => {
    await assert.rejects(
      () =>
        runDeploy({
          operator: '0x' + '11'.repeat(20),
          sharesRecipient: '0x' + '22'.repeat(20),
          env: { CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' },
        }),
      /BEACOND_HOME/,
    );
  });

  it('fails when beacond cannot read validator keys', async () => {
    setBeacondRunner((args) => {
      if (args.includes('validator-keys')) {
        return { status: 1, stdout: '', stderr: 'no keys in home' };
      }
      if (args.includes('validator-root')) {
        return {
          status: 0,
          stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    try {
      assert.throws(
        () => assertValidatorPreflight({ BEACOND_HOME: '/tmp', BEACOND_BIN: 'beacond' }),
        /no keys in home/,
      );

      await assert.rejects(
        () =>
          runDeploy({
            operator: '0x' + '11'.repeat(20),
            sharesRecipient: '0x' + '22'.repeat(20),
            env: { BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' },
          }),
        /no keys in home/,
      );
    } finally {
      setBeacondRunner(null);
    }
  });
});
