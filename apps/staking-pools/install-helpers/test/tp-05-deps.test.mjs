import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoForbiddenCommands,
  checkDependencies,
  formatMissingDependency,
} from '../lib/deps.mjs';
import { FORBIDDEN_SHELL_COMMANDS } from '../lib/constants.mjs';

describe('TP-5 dependency preflight', () => {
  it('names missing required tools', () => {
    const missing = checkDependencies({ BEACOND_BIN: '/definitely/missing/beacond' });
    assert.ok(missing.some((entry) => entry.name === 'beacond'));
    assert.match(formatMissingDependency(missing[0]), /required/);
  });

  it('never allows forbidden shell commands as executables', () => {
    for (const forbidden of FORBIDDEN_SHELL_COMMANDS) {
      assert.throws(
        () => assertNoForbiddenCommands([forbidden, 'foo']),
        new RegExp(forbidden),
      );
    }
  });
});
