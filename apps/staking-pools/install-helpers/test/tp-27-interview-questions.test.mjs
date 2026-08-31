import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectMissingFacts, conductInterview } from '../lib/interview.mjs';

const PUBKEY = `0x${'ab'.repeat(48)}`;
const FUNDING = '0x' + '11'.repeat(20);
const DEPOSIT = {
  pubkey: PUBKEY,
  credentials: `0x010000000000000000000000${'22'.repeat(20)}`,
  signature: `0x${'11'.repeat(96)}`,
  amount: '10000000000000',
};

function askedFacts(missing) {
  return missing.map((entry) => entry.fact);
}

describe('TP-2 interview asks only what is missing', () => {
  it('asks nothing when every fact is supplied in validator-local hot-key mode', async () => {
    const missing = collectMissingFacts({
      locality: 'local',
      env: { PRIVATE_KEY: '0xabc', BEACOND_HOME: '/tmp' },
      options: {},
      deploying: true,
    });
    assert.deepEqual(missing, []);

    const prompts = [];
    const result = await conductInterview({
      locality: 'local',
      env: { PRIVATE_KEY: '0xabc', BEACOND_HOME: '/tmp', CLI_CHAIN: 'bepolia' },
      options: { pubkey: PUBKEY },
      deploying: true,
      promptImpl: async (question) => {
        prompts.push(question);
        return '';
      },
    });
    assert.deepEqual(prompts, []);
    assert.equal(result.asked.length, 0);
  });

  it('asks nothing when every fact is supplied in validator-remote cold-signing mode', async () => {
    const missing = collectMissingFacts({
      locality: 'remote',
      env: {},
      options: {
        network: 'bepolia',
        pubkey: PUBKEY,
        deposit: DEPOSIT,
        fundingAddress: FUNDING,
        signingPreference: 'ledger',
      },
      deploying: true,
    });
    assert.deepEqual(missing, []);

    const prompts = [];
    await conductInterview({
      locality: 'remote',
      env: {},
      options: {
        network: 'bepolia',
        pubkey: PUBKEY,
        deposit: DEPOSIT,
        fundingAddress: FUNDING,
        signingPreference: 'ledger',
      },
      deploying: true,
      promptImpl: async (question) => {
        prompts.push(question);
        return '';
      },
    });
    assert.deepEqual(prompts, []);
  });

  it('asks nothing when remote facts arrive via env vars rather than flags', () => {
    const missing = collectMissingFacts({
      locality: 'remote',
      env: { CLI_CHAIN: 'mainnet', VALIDATOR_PUBKEY: PUBKEY, PRIVATE_KEY: '0xabc' },
      options: { deposit: DEPOSIT },
      deploying: true,
    });
    assert.deepEqual(missing, []);
  });
});

describe('TP-10 remote interview question set', () => {
  it('asks exactly chain and pubkey when those are missing and not deploying', () => {
    const missing = collectMissingFacts({
      locality: 'remote',
      env: { PRIVATE_KEY: '0xabc' },
      options: {},
      deploying: false,
    });
    assert.deepEqual(askedFacts(missing), ['chain', 'pubkey']);
    assert.ok(!askedFacts(missing).includes('locality'));
  });

  it('adds the deposit-paste fact when deploying and deposit is not supplied', () => {
    const missing = collectMissingFacts({
      locality: 'remote',
      env: { PRIVATE_KEY: '0xabc' },
      options: {},
      deploying: true,
    });
    assert.deepEqual(askedFacts(missing), ['chain', 'pubkey', 'deposit']);
    assert.ok(!askedFacts(missing).includes('locality'));
  });

  it('never asks the operator to name locality', async () => {
    const prompts = [];
    await conductInterview({
      locality: 'remote',
      env: { PRIVATE_KEY: '0xabc' },
      options: {},
      deploying: false,
      skipTtyCheck: true,
      promptImpl: async (question) => {
        prompts.push(question);
        if (/chain/i.test(question)) return 'bepolia';
        if (/pubkey/i.test(question)) return PUBKEY;
        throw new Error(`unexpected question: ${question}`);
      },
    });
    assert.equal(prompts.length, 2);
    assert.ok(prompts.every((question) => !/locality|local|remote/i.test(question) || /validator pubkey/i.test(question)));
    assert.ok(prompts.some((question) => /chain/i.test(question)));
    assert.ok(prompts.some((question) => /pubkey/i.test(question)));
  });
});
