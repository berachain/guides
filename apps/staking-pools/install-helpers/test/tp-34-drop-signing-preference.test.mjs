import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectMissingFacts, conductInterview, formatMissingFactsError } from '../lib/interview.mjs';

const PUBKEY = `0x${'ab'.repeat(48)}`;
const FUNDING = '0x' + '11'.repeat(20);

function facts(missing) {
  return missing.map((entry) => entry.fact);
}

describe('TP-1 signing-preference is never a missing fact', () => {
  it('never includes signing-preference for validator-local cold-signing, with or without the option set', () => {
    assert.ok(!facts(collectMissingFacts({
      locality: 'local',
      env: { BEACOND_HOME: '/tmp' },
      options: { fundingAddress: FUNDING },
    })).includes('signing-preference'));

    assert.ok(!facts(collectMissingFacts({
      locality: 'local',
      env: { BEACOND_HOME: '/tmp' },
      options: { fundingAddress: FUNDING, signingPreference: 'key' },
    })).includes('signing-preference'));

    assert.ok(!facts(collectMissingFacts({
      locality: 'local',
      env: { BEACOND_HOME: '/tmp' },
      options: {},
    })).includes('signing-preference'));
  });

  it('never includes signing-preference for validator-remote cold-signing, with or without the option set', () => {
    assert.ok(!facts(collectMissingFacts({
      locality: 'remote',
      env: {},
      options: { network: 'bepolia', pubkey: PUBKEY, fundingAddress: FUNDING },
      deploying: false,
    })).includes('signing-preference'));

    assert.ok(!facts(collectMissingFacts({
      locality: 'remote',
      env: {},
      options: { network: 'bepolia', pubkey: PUBKEY, fundingAddress: FUNDING, signingPreference: 'ledger' },
      deploying: false,
    })).includes('signing-preference'));
  });

  it('never includes signing-preference for hot-key mode (locality-independent)', () => {
    assert.ok(!facts(collectMissingFacts({
      locality: 'local',
      env: { PRIVATE_KEY: '0xabc', BEACOND_HOME: '/tmp' },
      options: {},
    })).includes('signing-preference'));
  });

  it('formatMissingFactsError never names --signing-preference', () => {
    const missing = collectMissingFacts({
      locality: 'remote',
      env: {},
      options: {},
      deploying: true,
    });
    const message = formatMissingFactsError(missing);
    assert.ok(!/--signing-preference/.test(message));
  });

  it('conductInterview never prompts for signing preference, defaulting to ledger when omitted', async () => {
    const prompts = [];
    const result = await conductInterview({
      locality: 'local',
      env: { BEACOND_HOME: '/tmp' },
      options: { fundingAddress: FUNDING },
      skipTtyCheck: true,
      promptImpl: async (question) => {
        prompts.push(question);
        return '';
      },
    });
    assert.ok(!prompts.some((question) => /ledger|signing machine|private key/i.test(question)));
    assert.equal(result.answers.signingPreference, '');
  });

  it('--signing-preference remains a working explicit override, never asked for', () => {
    const missing = collectMissingFacts({
      locality: 'local',
      env: { BEACOND_HOME: '/tmp' },
      options: { fundingAddress: FUNDING, signingPreference: 'key' },
    });
    assert.deepEqual(missing, []);
  });
});
