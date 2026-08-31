import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertTtyAllowsPrompts,
  collectMissingFacts,
  conductInterview,
  formatMissingFactsError,
} from '../lib/interview.mjs';

const PUBKEY = `0x${'ab'.repeat(48)}`;
const FUNDING = '0x' + '11'.repeat(20);

describe('TP-8 non-TTY with zero missing facts', () => {
  it('does not refuse when every fact is supplied and stdin is not a TTY', async () => {
    const missing = collectMissingFacts({
      locality: 'local',
      env: { PRIVATE_KEY: '0xabc', BEACOND_HOME: '/tmp' },
      options: {},
    });
    assert.equal(missing.length, 0);
    assert.doesNotThrow(() => assertTtyAllowsPrompts(missing, false));

    await conductInterview({
      locality: 'local',
      env: { PRIVATE_KEY: '0xabc', BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia' },
      options: { pubkey: PUBKEY },
      isTTY: false,
      promptImpl: async () => {
        throw new Error('must not prompt');
      },
    });
  });
});

describe('TP-9 non-TTY with any missing fact refuses before prompts', () => {
  it('refuses the one remaining missing fact (local cold-signing, funding-address omitted)', async () => {
    const missing = collectMissingFacts({
      locality: 'local',
      env: { BEACOND_HOME: '/tmp' },
      options: {},
    });
    assert.deepEqual(missing.map((entry) => entry.fact), ['funding-address']);

    let prompted = false;
    await assert.rejects(
      () =>
        conductInterview({
          locality: 'local',
          env: { BEACOND_HOME: '/tmp' },
          options: {},
          isTTY: false,
          promptImpl: async () => {
            prompted = true;
            return '';
          },
        }),
      (error) => {
        assert.match(error.message, /Non-interactive stdin cannot prompt/);
        assert.match(error.message, /--funding-address/);
        assert.ok(!/--signing-preference/.test(error.message));
        return true;
      },
    );
    assert.equal(prompted, false);
  });

  it('never refuses on signing-preference in validator-local cold-signing, even with every other fact supplied', async () => {
    await conductInterview({
      locality: 'local',
      env: { BEACOND_HOME: '/tmp' },
      options: { fundingAddress: FUNDING },
      isTTY: false,
      promptImpl: async () => {
        throw new Error('must not prompt');
      },
    });
  });

  it('refuses two-plus missing facts in validator-remote', async () => {
    const missing = collectMissingFacts({
      locality: 'remote',
      env: { PRIVATE_KEY: '0xabc' },
      options: {},
      deploying: false,
    });
    assert.ok(missing.length >= 2);
    await assert.rejects(
      () =>
        conductInterview({
          locality: 'remote',
          env: { PRIVATE_KEY: '0xabc' },
          options: {},
          deploying: false,
          isTTY: false,
          promptImpl: async () => {
            throw new Error('must not prompt');
          },
        }),
      (error) => {
        assert.match(error.message, /--chain|CLI_CHAIN/);
        assert.match(error.message, /--pubkey|VALIDATOR_PUBKEY/);
        return true;
      },
    );
  });

  it('names every missing flag in one error', () => {
    const missing = collectMissingFacts({
      locality: 'remote',
      env: {},
      options: {},
      deploying: true,
    });
    const message = formatMissingFactsError(missing);
    assert.match(message, /--chain/);
    assert.match(message, /--pubkey/);
    assert.match(message, /--deposit-output/);
    assert.match(message, /--funding-address/);
    assert.ok(!/--signing-preference/.test(message));
  });
});
