import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoForbiddenCommands,
  checkDependencies,
  formatMissingDependency,
} from '../lib/deps.mjs';
import { FORBIDDEN_SHELL_COMMANDS } from '../lib/constants.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';

describe('TP-5 dependency preflight', () => {
  it('requires beacond only for validator-local locality', () => {
    const localMissing = checkDependencies(
      { BEACOND_BIN: '/definitely/missing/beacond' },
      { locality: 'local' },
    );
    assert.ok(localMissing.some((entry) => entry.name === 'beacond'));
    assert.ok(!localMissing.some((entry) => entry.name === 'cast'));
    assert.match(formatMissingDependency(localMissing[0]), /required/);

    const remoteMissing = checkDependencies(
      { BEACOND_BIN: '/definitely/missing/beacond' },
      { locality: 'remote' },
    );
    assert.ok(!remoteMissing.some((entry) => entry.name === 'beacond'));
  });

  it('treats unset BEACOND_HOME as remote and does not require beacond', () => {
    const missing = checkDependencies({ BEACOND_BIN: '/definitely/missing/beacond' });
    assert.ok(!missing.some((entry) => entry.name === 'beacond'));
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

  it('fails closed naming install when BEACOND_HOME is unset', async () => {
    await assert.rejects(
      () =>
        runDeploy({
          operator: '0x' + '11'.repeat(20),
          sharesRecipient: '0x' + '22'.repeat(20),
          env: { CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' },
        }),
      /install/,
    );
  });

  it('fails closed naming install when beacond cannot read validator keys', async () => {
    setBeacondRunner((args) => {
      if (args.includes('validator-keys')) {
        return { status: 1, stdout: '', stderr: 'no keys in home' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    try {
      await assert.rejects(
        () =>
          runDeploy({
            operator: '0x' + '11'.repeat(20),
            sharesRecipient: '0x' + '22'.repeat(20),
            env: { BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' },
          }),
        /install/,
      );
    } finally {
      setBeacondRunner(null);
    }
  });
});
