import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runSetMinBalance } from '../lib/commands/set-min-balance.mjs';

const PUBKEY = `0x${'aa'.repeat(48)}`;
const STAKING_POOL = `0x${'33'.repeat(20)}`;

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

function mockFetch() {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'eth_call') {
      return {
        ok: true,
        async text() {
          if (body.params?.[0]?.data?.startsWith('0x')) {
            return JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '00'.repeat(128) });
          }
          return JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' });
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
}

describe('TP-23 runSetMinBalance smoke test', () => {
  it('uses the 250,000 BERA default when --amount is omitted', async () => {
    installBeacond();
    try {
      const result = await runSetMinBalance({
        env: {
          BEACOND_HOME: '/tmp/beacond',
          CLI_CHAIN: 'bepolia',
          RPC_URL: 'http://mock-rpc',
        },
        fetchImpl: async (url, options) => {
          const body = JSON.parse(options.body);
          if (body.method === 'eth_call' && body.params?.[0]?.to === undefined) {
            return { ok: true, async text() { return JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }); } };
          }
          if (body.method === 'eth_call') {
            const to = body.params[0].to?.toLowerCase();
            if (to === '0x24b8223864d3936f56e5a24c4245ae7620471d4c') {
              return {
                ok: true,
                async text() {
                  return JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    result:
                      '0x0000000000000000000000000000000000000000000000000000000000000000' +
                      '000000000000000000000000' + STAKING_POOL.slice(2) +
                      '0000000000000000000000000000000000000000000000000000000000000000' +
                      '0000000000000000000000000000000000000000000000000000000000000000',
                  });
                },
              };
            }
            if (to === STAKING_POOL) {
              return { ok: true, async text() { return JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }); } };
            }
          }
          return mockFetch()(url, options);
        },
      });
      assert.equal(result.mode, 'emit');
      assert.ok(result.command.includes('250000000000000000000000'));
    } finally {
      setBeacondRunner(null);
    }
  });
});
