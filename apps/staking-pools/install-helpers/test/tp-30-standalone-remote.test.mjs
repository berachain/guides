import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runActivate } from '../lib/commands/activate.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';
import { runSetMinBalance } from '../lib/commands/set-min-balance.mjs';
import { runStake } from '../lib/commands/stake.mjs';
import { runUnstake } from '../lib/commands/unstake.mjs';

const ADDRESS = '0x' + '11'.repeat(20);
const INSTALL_POINTER = /install/i;

async function assertFailsClosed(fn) {
  await assert.rejects(fn, (error) => {
    assert.match(error.message, INSTALL_POINTER);
    assert.ok(!/interview|paste|pubkey/i.test(error.message) || /install/i.test(error.message));
    return true;
  });
}

describe('TP-11 standalone commands fail closed on validator-remote', () => {
  it('deploy/activate/set-min-balance/stake/unstake point at install when BEACOND_HOME is unset', async () => {
    const env = { CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' };
    await assertFailsClosed(() =>
      runDeploy({ operator: ADDRESS, sharesRecipient: ADDRESS, env }),
    );
    await assertFailsClosed(() => runActivate({ env }));
    await assertFailsClosed(() => runSetMinBalance({ env }));
    await assertFailsClosed(() =>
      runStake({ amount: '1', receiver: ADDRESS, env }),
    );
    await assertFailsClosed(() =>
      runUnstake({ amount: '1', from: ADDRESS, env }),
    );
  });

  it('deploy points at install when BEACOND_HOME is set but keys are unreadable', async () => {
    setBeacondRunner((args) => {
      if (args.includes('validator-keys')) {
        return { status: 1, stdout: '', stderr: 'no keys in home' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    try {
      await assertFailsClosed(() =>
        runDeploy({
          operator: ADDRESS,
          sharesRecipient: ADDRESS,
          env: { BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia', BEACOND_BIN: 'beacond' },
        }),
      );
    } finally {
      setBeacondRunner(null);
    }
  });
});
