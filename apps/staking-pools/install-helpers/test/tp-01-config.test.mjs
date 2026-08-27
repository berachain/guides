import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveClApiUrl, resolveRpcUrl } from '../lib/config.mjs';

describe('TP-1 RPC and CL resolvers', () => {
  it('maps mainnet and bepolia defaults', () => {
    assert.equal(resolveRpcUrl('mainnet', {}), 'https://rpc.berachain.com');
    assert.equal(resolveRpcUrl('bepolia', {}), 'https://bepolia.rpc.berachain.com');
  });

  it('prefers explicit EL RPC override', () => {
    assert.equal(
      resolveRpcUrl('bepolia', { RPC_URL: 'https://custom.example' }),
      'https://custom.example',
    );
    assert.equal(
      resolveRpcUrl('mainnet', { EL_RPC_URL: 'https://el.example' }),
      'https://el.example',
    );
  });

  it('requires CL URL from env with no baked host', () => {
    assert.throws(() => resolveClApiUrl({}), /CL node API URL is required/);
    assert.throws(() => resolveClApiUrl({ NODE_API_ADDRESS: '  ' }), /required/);
    assert.equal(
      resolveClApiUrl({ CL_NODE_API_URL: '127.0.0.1:3600' }),
      'http://127.0.0.1:3600',
    );
  });
});
