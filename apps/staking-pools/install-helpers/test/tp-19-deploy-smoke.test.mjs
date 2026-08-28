import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';

// TP-19 exists for the same reason as TP-18: every existing deploy-adjacent
// test drives beacond.mjs, cast.mjs, or tx-runner.mjs directly. None of them
// import lib/commands/deploy.mjs, so a broken import or wiring mistake in
// that module is invisible until a real operator runs `pool-cli.mjs deploy`.

const GENESIS_ROOT = `0x${'77'.repeat(32)}`;
const WITHDRAWAL_VAULT = `0x${'11'.repeat(20)}`;
const DEPOSIT_PUBKEY = `0x${'bb'.repeat(48)}`;
const DEPOSIT_CREDENTIALS = `0x${'cc'.repeat(32)}`;
const DEPOSIT_SIGNATURE = `0x${'dd'.repeat(96)}`;
const SMART_OPERATOR = `0x${'22'.repeat(20)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const REWARDS_VAULT = `0x${'44'.repeat(20)}`;
const INCENTIVE_COLLECTOR = `0x${'55'.repeat(20)}`;
const OPERATOR = `0x${'66'.repeat(20)}`;
const SHARES_RECIPIENT = `0x${'88'.repeat(20)}`;

function beacondRouter(argv) {
  const [group, action] = argv;
  if (group === 'deposit' && action === 'validator-keys') {
    return { status: 0, stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${DEPOSIT_PUBKEY}\n`, stderr: '' };
  }
  if (group === 'genesis' && action === 'validator-root') {
    return { status: 0, stdout: `${GENESIS_ROOT}\n`, stderr: '' };
  }
  if (group === 'deposit' && action === 'create-validator') {
    return {
      status: 0,
      stdout: [
        `pubkey:      ${DEPOSIT_PUBKEY}`,
        `credentials: ${DEPOSIT_CREDENTIALS}`,
        'amount:      10000000000000',
        `signature:   ${DEPOSIT_SIGNATURE}`,
      ].join('\n'),
      stderr: '',
    };
  }
  if (group === 'deposit' && action === 'validate') {
    return { status: 0, stdout: 'valid\n', stderr: '' };
  }
  throw new Error(`TP-19 beacond mock has no route for ${JSON.stringify(argv)}`);
}

function castRouter(argv) {
  const [cmd, , signature] = argv;
  if (cmd === 'call' && signature === 'withdrawalVault()(address)') {
    return { status: 0, stdout: WITHDRAWAL_VAULT, stderr: '' };
  }
  if (cmd === 'call' && signature === 'predictStakingPoolContractsAddresses(bytes)(address,address,address,address)') {
    return {
      status: 0,
      stdout: `${SMART_OPERATOR}\n${STAKING_POOL}\n${REWARDS_VAULT}\n${INCENTIVE_COLLECTOR}`,
      stderr: '',
    };
  }
  if (cmd === 'call' && String(signature).startsWith('deployStakingPoolContracts')) {
    return { status: 0, stdout: '', stderr: '' };
  }
  throw new Error(`TP-19 cast mock has no route for ${JSON.stringify(argv)}`);
}

describe('TP-19 runDeploy smoke test', () => {
  it('runs the full deploy flow through real imports and emits a copy-paste cast send', async () => {
    setCastRunner(castRouter);
    setBeacondRunner(beacondRouter);
    try {
      const result = await runDeploy({
        execute: false,
        env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
        operator: OPERATOR,
        sharesRecipient: SHARES_RECIPIENT,
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.join(' ').includes('deployStakingPoolContracts'));
      assert.ok(result.sendArgv.join(' ').includes(DEPOSIT_PUBKEY));
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });

  it('rejects an invalid --sr before touching beacond or cast', async () => {
    await assert.rejects(
      () =>
        runDeploy({
          execute: false,
          env: { BEACOND_HOME: '/tmp/beacond', CLI_CHAIN: 'bepolia' },
          operator: OPERATOR,
          sharesRecipient: 'not-an-address',
        }),
      /--sr must be a valid EVM address/,
    );
  });
});
