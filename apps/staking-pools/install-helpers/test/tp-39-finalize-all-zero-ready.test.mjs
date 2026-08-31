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
const LATEST_BLOCK = 200000n;
const DELAY = 129600n;

function installBeacond() {
  setBeacondRunner((args) => {
    if (args.includes('validator-keys')) {
      return { status: 0, stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${PUBKEY}\n`, stderr: '' };
    }
    if (args.includes('validator-root')) {
      return { status: 0, stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
}

function okResult(result) {
  return { ok: true, async text() { return JSON.stringify({ jsonrpc: '2.0', id: 1, result }); } };
}

function boolTrue() {
  return '0x' + '00'.repeat(31) + '01';
}

function addressResult(address) {
  return '0x' + '00'.repeat(12) + address.slice(2);
}

function uint(value) {
  return '0x' + value.toString(16).padStart(64, '0');
}

/** balanceOf => count; getWithdrawalRequest => (bytes,uint256,uint256,address,uint256) tuple. */
function mockFetch({ balance, requestBlocks }) {
  let finalizeCalled = false;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'eth_blockNumber') {
      return okResult(uint(LATEST_BLOCK));
    }
    if (body.method === 'eth_call') {
      const to = String(body.params?.[0]?.to ?? '').toLowerCase();
      const data = String(body.params?.[0]?.data ?? '');
      if (to === STAKING_POOL_FACTORY_BEPOLIA.toLowerCase()) {
        return okResult(addressResult(VAULT));
      }
      if (to === STAKING_POOL) {
        return okResult(boolTrue());
      }
      if (to === VAULT) {
        // balanceOf(address): 0x70a08231
        if (data.startsWith('0x70a08231')) {
          return okResult(uint(BigInt(balance)));
        }
        // tokenOfOwnerByIndex(address,uint256): 0x2f745c59
        if (data.startsWith('0x2f745c59')) {
          const index = Number(BigInt(`0x${data.slice(-64)}`));
          return okResult(uint(BigInt(index + 1)));
        }
        // getWithdrawalRequest(uint256): decode requestId from the tail
        if (data.startsWith('0x') && data.length > 10 && !data.startsWith('0x70a08231') && !data.startsWith('0x2f745c59')) {
          const requestId = Number(BigInt(`0x${data.slice(-64)}`));
          const requestBlock = requestBlocks[requestId - 1];
          // (bytes pubkey="", uint256 assetsRequested=0, uint256 sharesBurnt=0, address user, uint256 requestBlock)
          const encoded =
            uint(0xa0n) + // offset to bytes (5 static words * 32 = 0xa0)
            uint(0n).slice(2) +
            uint(0n).slice(2) +
            addressResult(HOLDER).slice(2).padStart(64, '0') +
            uint(requestBlock).slice(2) +
            uint(0n).slice(2); // bytes length = 0
          return okResult(encoded);
        }
      }
      return okResult('0x');
    }
    if (body.method === 'eth_getLogs') {
      finalizeCalled = true;
      return okResult([]);
    }
    return okResult('0x1');
  };
  fetchImpl.wasFinalizeAttempted = () => finalizeCalled;
  return fetchImpl;
}

function baseEnv() {
  return {
    BEACOND_HOME: '/tmp/beacond',
    CLI_CHAIN: 'bepolia',
    RPC_URL: 'http://mock-rpc',
  };
}

describe('TP-5 --finalize with no value and zero ready requests', () => {
  afterEach(() => {
    setBeacondRunner(null);
  });

  it('reports plainly when the holder has zero withdrawal NFTs, without error, without any finalize call', async () => {
    installBeacond();
    const fetchImpl = mockFetch({ balance: 0, requestBlocks: [] });
    const result = await runUnstake({
      finalize: '',
      from: HOLDER,
      stakingPool: STAKING_POOL,
      env: baseEnv(),
      fetchImpl,
      signer: { mode: 'hot-key', async broadcast() { throw new Error('must not broadcast'); } },
    });
    assert.equal(result.mode, 'none');
    assert.deepEqual(result.ready, []);
  });

  it('reports which requests exist and when each becomes ready when none have passed the delay yet, without calling finalizeWithdrawalRequests', async () => {
    installBeacond();
    const notReadyBlock = LATEST_BLOCK - 100n; // requestBlock + DELAY > LATEST_BLOCK
    const fetchImpl = mockFetch({ balance: 1, requestBlocks: [notReadyBlock] });
    const result = await runUnstake({
      finalize: '',
      from: HOLDER,
      stakingPool: STAKING_POOL,
      env: baseEnv(),
      fetchImpl,
      signer: { mode: 'hot-key', async broadcast() { throw new Error('must not broadcast — nothing ready'); } },
    });
    assert.equal(result.mode, 'none');
    assert.equal(result.notReady.length, 1);
    assert.equal(result.notReady[0].readyAtBlock, (notReadyBlock + DELAY).toString());
    assert.equal(fetchImpl.wasFinalizeAttempted(), false);
  });
});
