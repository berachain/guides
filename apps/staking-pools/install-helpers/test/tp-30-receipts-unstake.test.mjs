import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runUnstake } from '../lib/commands/unstake.mjs';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../lib/constants.mjs';
import { readReceipts } from '../lib/receipts.mjs';

const PUBKEY = `0x${'aa'.repeat(48)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;
const VAULT = `0x${'77'.repeat(20)}`;
const HOLDER = `0x${'88'.repeat(20)}`;
const ASSETS_HASH = `0x${'a1'.repeat(32)}`;
const SHARES_HASH = `0x${'a2'.repeat(32)}`;
const FINALIZE_HASH = `0x${'a3'.repeat(32)}`;

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
    return { status: 0, stdout: '', stderr: '' };
  });
}

function okResult(result) {
  return {
    ok: true,
    async text() {
      return JSON.stringify({ jsonrpc: '2.0', id: 1, result });
    },
  };
}

function boolTrue() {
  return '0x' + '00'.repeat(31) + '01';
}

function addressResult(address) {
  return '0x' + '00'.repeat(12) + address.slice(2);
}

function mockFetch() {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'eth_call') {
      const to = String(body.params?.[0]?.to ?? '').toLowerCase();
      if (to === STAKING_POOL_FACTORY_BEPOLIA.toLowerCase()) {
        return okResult(addressResult(VAULT));
      }
      if (to === STAKING_POOL) {
        return okResult(boolTrue());
      }
      if (to === VAULT) {
        return okResult('0x' + '00'.repeat(31) + '07');
      }
      return okResult('0x');
    }
    return okResult('0x1');
  };
}

function mockHotKeySigner(hash) {
  return {
    mode: 'hot-key',
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

describe('TP-4 unstake and stake receipt fields', () => {
  afterEach(() => {
    setBeacondRunner(null);
  });

  it('writes a requestWithdrawal receipt with amount and request id', async () => {
    installBeacond();
    const dir = mkdtempSync(join(tmpdir(), 'tp-30-assets-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runUnstake({
        amount: '10',
        from: HOLDER,
        stakingPool: STAKING_POOL,
        env: baseEnv(receiptsPath),
        fetchImpl: mockFetch(),
        signer: mockHotKeySigner(ASSETS_HASH),
        receiptsPath,
        maxFee: '0.001',
      });
      assert.equal(result.mode, 'execute');
      assert.equal(result.hash, ASSETS_HASH);
      const [record] = readReceipts(receiptsPath);
      assert.equal(record.action, 'unstake.requestWithdrawal');
      assert.equal(record.hash, ASSETS_HASH);
      assert.equal(record.addresses.pool.toLowerCase(), STAKING_POOL);
      assert.equal(record.addresses.withdrawalVault.toLowerCase(), VAULT);
      assert.equal(record.amount, '10');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a requestRedeem receipt with shares amount', async () => {
    installBeacond();
    const dir = mkdtempSync(join(tmpdir(), 'tp-30-shares-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runUnstake({
        shares: '5',
        from: HOLDER,
        stakingPool: STAKING_POOL,
        env: baseEnv(receiptsPath),
        fetchImpl: mockFetch(),
        signer: mockHotKeySigner(SHARES_HASH),
        receiptsPath,
        maxFee: '0.001',
      });
      assert.equal(result.hash, SHARES_HASH);
      const [record] = readReceipts(receiptsPath);
      assert.equal(record.action, 'unstake.requestRedeem');
      assert.equal(record.hash, SHARES_HASH);
      assert.equal(record.addresses.pool.toLowerCase(), STAKING_POOL);
      assert.equal(record.amount, '5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a finalizeWithdrawalRequest receipt with request id', async () => {
    installBeacond();
    const dir = mkdtempSync(join(tmpdir(), 'tp-30-finalize-'));
    const receiptsPath = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const result = await runUnstake({
        finalize: '42',
        from: HOLDER,
        stakingPool: STAKING_POOL,
        env: baseEnv(receiptsPath),
        fetchImpl: mockFetch(),
        signer: mockHotKeySigner(FINALIZE_HASH),
        receiptsPath,
      });
      assert.equal(result.hash, FINALIZE_HASH);
      const [record] = readReceipts(receiptsPath);
      assert.equal(record.action, 'unstake.finalizeWithdrawalRequest');
      assert.equal(record.hash, FINALIZE_HASH);
      assert.equal(record.addresses.pool.toLowerCase(), STAKING_POOL);
      assert.equal(record.amount, '42');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
