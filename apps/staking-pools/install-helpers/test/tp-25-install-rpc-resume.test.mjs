import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createChainReader } from '../lib/chain-reader.mjs';
import { gatherInstallState } from '../lib/commands/install.mjs';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../lib/constants.mjs';

const PUBKEY = `0x${'aa'.repeat(48)}`;
const SMART_OPERATOR = `0x${'11'.repeat(20)}`;
const STAKING_POOL = `0x${'22'.repeat(20)}`;

function deployedCoreResult() {
  return (
    '0x000000000000000000000000' +
    SMART_OPERATOR.slice(2) +
    '000000000000000000000000' +
    STAKING_POOL.slice(2) +
    '0000000000000000000000000000000000000000000000000000000000000003' +
    '0000000000000000000000000000000000000000000000000000000000000004'
  );
}

function basePlan(fetchImpl) {
  const rpcUrl = 'http://mock-rpc';
  return {
    factory: STAKING_POOL_FACTORY_BEPOLIA,
    rpcUrl,
    pubkey: PUBKEY,
    chainReader: createChainReader(rpcUrl, fetchImpl),
    predicted: { stakingPool: STAKING_POOL, smartOperator: SMART_OPERATOR },
    stakePlanned: false,
    clBase: 'http://127.0.0.1:3500',
    fetchImpl,
  };
}

describe('TP-25 install gatherInstallState resume safety', () => {
  it('treats explicit not-deployed as deployed=false', async () => {
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === 'eth_call') {
        return {
          ok: true,
          async text() {
            return JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result:
                '0x0000000000000000000000000000000000000000000000000000000000000000' +
                '000000000000000000000000' +
                STAKING_POOL.slice(2) +
                '0000000000000000000000000000000000000000000000000000000000000000' +
                '0000000000000000000000000000000000000000000000000000000000000000',
            });
          },
        };
      }
      return {
        ok: true,
        async text() {
          return JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' });
        },
      };
    };

    const state = await gatherInstallState(basePlan(fetchImpl));
    assert.equal(state.deployed, false);
  });

  it('propagates RPC transport failures instead of assuming not deployed', async () => {
    const fetchImpl = async () => {
      throw new Error('network down');
    };

    await assert.rejects(
      () => gatherInstallState(basePlan(fetchImpl)),
      /RPC .* unreachable|network down/,
    );
  });

  it('propagates RPC failure while reading deployed pool follow-up state', async () => {
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === 'eth_call' && body.params?.[0]?.to?.toLowerCase() === STAKING_POOL_FACTORY_BEPOLIA.toLowerCase()) {
        return {
          ok: true,
          async text() {
            return JSON.stringify({ jsonrpc: '2.0', id: 1, result: deployedCoreResult() });
          },
        };
      }
      if (body.method === 'eth_call') {
        throw new Error('RPC eth_call unreachable at http://mock-rpc: transient outage');
      }
      if (_url.includes('/eth/v1/beacon/states/head/validators/')) {
        return { ok: true, async text() { return JSON.stringify({ data: { index: '1', status: 'active', balance: '1' } }); } };
      }
      return {
        ok: true,
        async text() {
          return JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' });
        },
      };
    };

    await assert.rejects(
      () => gatherInstallState(basePlan(fetchImpl)),
      /transient outage/,
    );
  });
});
