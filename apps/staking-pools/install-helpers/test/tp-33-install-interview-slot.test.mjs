import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInstall } from '../lib/commands/install.mjs';
import { clearBeacondStub, installBeacondStub } from './helpers/anvil-harness.mjs';

describe('install interview slot', () => {
  it('refuses on non-TTY before confirmation when one fact is missing', async () => {
    installBeacondStub();
    try {
      await assert.rejects(
        () =>
          runInstall({
            env: { BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia' },
            isTTY: false,
            confirmAnswer: 'y',
          }),
        (error) => {
          assert.match(error.message, /Non-interactive stdin cannot prompt/);
          assert.match(error.message, /--funding-address/);
          return true;
        },
      );
    } finally {
      clearBeacondStub();
    }
  });

  it('does not hard-fail on missing BEACOND_HOME when remote facts are complete enough to interview', async () => {
    await assert.rejects(
      () =>
        runInstall({
          env: { CLI_CHAIN: 'bepolia', PRIVATE_KEY: '0xabc' },
          pubkey: `0x${'ab'.repeat(48)}`,
          isTTY: false,
          skipConfirmation: true,
        }),
      (error) => {
        assert.ok(
          !/run `install` instead/i.test(error.message),
          `still fail-closed as a standalone command: ${error.message}`,
        );
        return true;
      },
    );
  });
});
