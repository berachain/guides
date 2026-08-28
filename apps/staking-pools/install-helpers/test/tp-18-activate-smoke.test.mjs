import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runActivate } from '../lib/commands/activate.mjs';

// TP-18 exists because every other activate test drives runTransaction or
// proofs.mjs helpers directly, importing activate.mjs never happens. A bad
// import (isProofExpired, eip4788ElBlockNumber, ...) in that module is
// invisible to the suite unless something actually calls runActivate.

const PUBKEY = `0x${'aa'.repeat(48)}`;
const WITHDRAWAL_VAULT = `0x${'11'.repeat(20)}`;
const SMART_OPERATOR = `0x${'22'.repeat(20)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const REWARDS_VAULT = `0x${'44'.repeat(20)}`;
const INCENTIVE_COLLECTOR = `0x${'55'.repeat(20)}`;
const PINNED_SLOT = '97';
const EL_BLOCK_TIMESTAMP_HEX = '0x669f1234';
const PROOF_TIMESTAMP = Number.parseInt('669f1234', 16);

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function fetchRouter(url) {
  if (url.includes('/eth/v1/beacon/states/head/validators/')) {
    return jsonResponse(200, {
      data: { index: '36', status: 'pending_initialized', balance: '32000000000' },
    });
  }
  if (url.endsWith('/eth/v1/beacon/headers/head')) {
    return jsonResponse(200, { data: { header: { message: { slot: '100' } } } });
  }
  if (url.includes('/bkit/v1/proof/validator_pubkey/')) {
    return jsonResponse(200, {
      beacon_block_header: { slot: PINNED_SLOT },
      validator_pubkey: PUBKEY,
      validator_pubkey_proof: ['0xa', '0xb'],
    });
  }
  if (url.includes('/bkit/v1/proof/validator_credentials/')) {
    return jsonResponse(200, {
      beacon_block_header: { slot: PINNED_SLOT },
      validator_withdrawal_credentials: `0x010000000000000000000000${WITHDRAWAL_VAULT.slice(2)}`,
      withdrawal_credentials_proof: ['0xc', '0xd'],
    });
  }
  if (url.includes('/bkit/v1/proof/validator_balance/')) {
    return jsonResponse(200, {
      beacon_block_header: { slot: PINNED_SLOT },
      validator_balance: '10000000000000',
      balance_proof: ['0xe', '0xf'],
      balance_leaf: '0x00',
    });
  }
  throw new Error(`TP-18 fetch mock has no route for ${url}`);
}

function castRouter(argv) {
  const [cmd, , signature] = argv;
  if (cmd === 'call' && signature === 'predictStakingPoolContractsAddresses(bytes)(address,address,address,address)') {
    return {
      status: 0,
      stdout: `${SMART_OPERATOR}\n${STAKING_POOL}\n${REWARDS_VAULT}\n${INCENTIVE_COLLECTOR}`,
      stderr: '',
    };
  }
  if (cmd === 'code') {
    return { status: 0, stdout: '0x6080', stderr: '' };
  }
  if (cmd === 'call' && signature === 'isActive()(bool)') {
    return { status: 0, stdout: 'false', stderr: '' };
  }
  if (cmd === 'call' && signature === 'withdrawalVault()(address)') {
    return { status: 0, stdout: WITHDRAWAL_VAULT, stderr: '' };
  }
  if (cmd === 'block-number') {
    return { status: 0, stdout: '105', stderr: '' };
  }
  if (cmd === 'block') {
    return { status: 0, stdout: JSON.stringify({ timestamp: EL_BLOCK_TIMESTAMP_HEX }), stderr: '' };
  }
  if (cmd === 'call' && String(signature).startsWith('activateStakingPool')) {
    return { status: 0, stdout: '', stderr: '' };
  }
  throw new Error(`TP-18 cast mock has no route for ${JSON.stringify(argv)}`);
}

function beacondRouter() {
  return {
    status: 0,
    stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}\n`,
    stderr: '',
  };
}

describe('TP-18 runActivate smoke test', () => {
  it('runs the full activate flow through real imports without throwing', async () => {
    setCastRunner(castRouter);
    setBeacondRunner(beacondRouter);
    try {
      const result = await runActivate({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        fetchImpl: fetchRouter,
        now: PROOF_TIMESTAMP + 10,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.join(' ').includes('activateStakingPool'));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('refuses to emit once the pinned proof window has expired', async () => {
    setCastRunner(castRouter);
    setBeacondRunner(beacondRouter);
    try {
      await assert.rejects(
        () =>
          runActivate({
            execute: false,
            env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
            fetchImpl: fetchRouter,
            now: PROOF_TIMESTAMP + 601,
          }),
        /Proof window expired/,
      );
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
