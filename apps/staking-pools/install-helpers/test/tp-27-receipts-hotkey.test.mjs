import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runActivationTransaction } from '../lib/activation.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';
import { runSetMinBalance } from '../lib/commands/set-min-balance.mjs';
import { runStake } from '../lib/commands/stake.mjs';
import { runStakeSubmit } from '../lib/commands/stake.mjs';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../lib/constants.mjs';
import { readReceipts } from '../lib/receipts.mjs';

const PUBKEY = `0x${'aa'.repeat(48)}`;
const OPERATOR = `0x${'11'.repeat(20)}`;
const SHARES = `0x${'22'.repeat(20)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const SMART_OPERATOR = `0x${'44'.repeat(20)}`;
const DEPLOY_HASH = `0x${'ab'.repeat(32)}`;
const ACTIVATE_HASH = `0x${'cd'.repeat(32)}`;
const STAKE_HASH = `0x${'ef'.repeat(32)}`;
const MIN_BAL_HASH = `0x${'12'.repeat(32)}`;
const INSTALL_STAKE_HASH = `0x${'34'.repeat(32)}`;

function installBeacond() {
  setBeacondRunner((args) => {
    if (args.includes('validator-keys')) {
      return {
        status: 0,
        stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}\n`,
        stderr: '',
      };
    }
    if (args.includes('validator-root')) {
      return {
        status: 0,
        stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e',
        stderr: '',
      };
    }
    if (args.includes('create-validator')) {
      return {
        status: 0,
        stdout: [
          `pubkey: ${PUBKEY}`,
          `credentials: 0x010000000000000000000000${'bb'.repeat(20)}`,
          `signature: 0x${'11'.repeat(96)}`,
          'amount: 10000000000000',
        ].join('\n'),
        stderr: '',
      };
    }
    if (args.includes('validate')) {
      return { status: 0, stdout: 'ok', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
}

function predictedAddressesResult() {
  return (
    '0x' +
    '000000000000000000000000' +
    SMART_OPERATOR.slice(2) +
    '000000000000000000000000' +
    STAKING_POOL.slice(2) +
    '000000000000000000000000' +
    '55'.repeat(20) +
    '000000000000000000000000' +
    '66'.repeat(20)
  );
}

function okResult(result = '0x') {
  return {
    ok: true,
    async text() {
      return JSON.stringify({ jsonrpc: '2.0', id: 1, result });
    },
  };
}

function mockFetch() {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'eth_call') {
      const to = String(body.params?.[0]?.to ?? '').toLowerCase();
      if (to === STAKING_POOL_FACTORY_BEPOLIA.toLowerCase()) {
        return okResult(predictedAddressesResult());
      }
      return okResult('0x' + '00'.repeat(128));
    }
    if (body.method === 'eth_getCode') {
      return okResult('0x6000');
    }
    return okResult('0x1');
  };
}

function mockHotKeySigner(hash) {
  return {
    mode: 'hot-key',
    async getFundingAddress() {
      return OPERATOR;
    },
    async broadcast() {
      return { hash };
    },
  };
}

function baseEnv(receiptsPath) {
  return {
    BEACOND_HOME: '/tmp/beacond',
    CLI_CHAIN: 'bepolia',
    RPC_URL: 'http://mock-rpc',
    PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    RECEIPTS_PATH: receiptsPath,
  };
}

describe('TP-1 hot-key receipts after runTransaction hash', () => {
  afterEach(() => {
    setBeacondRunner(null);
  });

  it('appends a deploy receipt after standalone runDeploy returns its hash', async () => {
    installBeacond();
    const dir = mkdtempSync(join(tmpdir(), 'tp-27-deploy-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runDeploy({
        operator: OPERATOR,
        sharesRecipient: SHARES,
        env: baseEnv(receiptsPath),
        fetchImpl: mockFetch(),
        signer: mockHotKeySigner(DEPLOY_HASH),
        receiptsPath,
      });
      assert.equal(result.mode, 'execute');
      assert.equal(result.hash, DEPLOY_HASH);
      const records = readReceipts(receiptsPath);
      assert.equal(records.length, 1);
      assert.equal(records[0].action, 'deploy');
      assert.equal(records[0].hash, DEPLOY_HASH);
      assert.equal(records[0].addresses.pool.toLowerCase(), STAKING_POOL);
      assert.equal(records[0].addresses.operator.toLowerCase(), OPERATOR);
      assert.equal(records[0].addresses.sharesRecipient.toLowerCase(), SHARES);
      assert.ok(records[0].timestamp);
      assert.ok(records[0].amount);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends an activate receipt after runActivationTransaction returns its hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-27-activate-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runActivationTransaction(
        {
          execute: true,
          env: baseEnv(receiptsPath),
          rpcUrl: 'http://mock-rpc',
          factory: STAKING_POOL_FACTORY_BEPOLIA,
          chainReader: { rpcUrl: 'http://mock-rpc', fetchImpl: mockFetch() },
          signer: mockHotKeySigner(ACTIVATE_HASH),
          verbose: false,
          receiptsPath,
          predicted: { stakingPool: STAKING_POOL },
        },
        {
          skipped: false,
          validatorArgs: [PUBKEY, `0x${'00'.repeat(32)}`, '10000000000000', '1'],
          proofArgs: [
            [`0x${'01'.repeat(32)}`],
            [`0x${'02'.repeat(32)}`],
            [`0x${'03'.repeat(32)}`],
            `0x${'04'.repeat(32)}`,
          ],
          proofTimestamp: 1_700_000_000,
        },
      );
      assert.equal(result.mode, 'execute');
      assert.equal(result.hash, ACTIVATE_HASH);
      const records = readReceipts(receiptsPath);
      assert.equal(records.length, 1);
      assert.equal(records[0].action, 'activate');
      assert.equal(records[0].hash, ACTIVATE_HASH);
      assert.equal(records[0].addresses.pool.toLowerCase(), STAKING_POOL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends a stake receipt after standalone runStake returns its hash', async () => {
    installBeacond();
    const dir = mkdtempSync(join(tmpdir(), 'tp-27-stake-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runStake({
        amount: '100',
        receiver: SHARES,
        env: baseEnv(receiptsPath),
        fetchImpl: mockFetch(),
        signer: mockHotKeySigner(STAKE_HASH),
        receiptsPath,
        stakingPool: STAKING_POOL,
      });
      assert.equal(result.mode, 'execute');
      assert.equal(result.hash, STAKE_HASH);
      const records = readReceipts(receiptsPath);
      assert.equal(records.length, 1);
      assert.equal(records[0].action, 'stake');
      assert.equal(records[0].hash, STAKE_HASH);
      assert.equal(records[0].addresses.pool.toLowerCase(), STAKING_POOL);
      assert.equal(records[0].addresses.sharesRecipient.toLowerCase(), SHARES);
      assert.equal(records[0].amount, '100');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends a set-min-balance receipt after runSetMinBalance returns its hash', async () => {
    installBeacond();
    const dir = mkdtempSync(join(tmpdir(), 'tp-27-minbal-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runSetMinBalance({
        amount: '250000',
        env: baseEnv(receiptsPath),
        fetchImpl: mockFetch(),
        signer: mockHotKeySigner(MIN_BAL_HASH),
        receiptsPath,
      });
      assert.equal(result.mode, 'execute');
      assert.equal(result.hash, MIN_BAL_HASH);
      const records = readReceipts(receiptsPath);
      assert.equal(records.length, 1);
      assert.equal(records[0].action, 'set-min-balance');
      assert.equal(records[0].hash, MIN_BAL_HASH);
      assert.equal(records[0].addresses.pool.toLowerCase(), STAKING_POOL);
      assert.equal(records[0].addresses.operator.toLowerCase(), SMART_OPERATOR);
      assert.equal(records[0].amount, '250000');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends a stake receipt from install's inlined runStakeSubmit site", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-27-install-stake-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runStakeSubmit({
        execute: true,
        env: baseEnv(receiptsPath),
        rpcUrl: 'http://mock-rpc',
        from: OPERATOR,
        stakingPool: STAKING_POOL,
        receiver: SHARES,
        chainReader: { rpcUrl: 'http://mock-rpc', fetchImpl: mockFetch() },
        signer: mockHotKeySigner(INSTALL_STAKE_HASH),
        verbose: false,
        value: '50ether',
        receiptsPath,
        amount: '50',
      });
      assert.equal(result.mode, 'execute');
      assert.equal(result.hash, INSTALL_STAKE_HASH);
      const records = readReceipts(receiptsPath);
      assert.equal(records.length, 1);
      assert.equal(records[0].action, 'stake');
      assert.equal(records[0].hash, INSTALL_STAKE_HASH);
      assert.equal(records[0].addresses.pool.toLowerCase(), STAKING_POOL);
      assert.equal(records[0].addresses.sharesRecipient.toLowerCase(), SHARES);
      assert.equal(records[0].amount, '50');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
