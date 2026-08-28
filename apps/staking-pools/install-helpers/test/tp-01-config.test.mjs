import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveClApiUrl, resolveRpcUrl } from '../lib/config.mjs';
import { detectNetwork, setBeacondRunner } from '../lib/beacond.mjs';

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

  it('defaults CL node API to localhost when unset', () => {
    assert.equal(resolveClApiUrl({}), 'http://127.0.0.1:3500');
    assert.equal(resolveClApiUrl({ NODE_API_ADDRESS: '  ' }), 'http://127.0.0.1:3500');
    assert.equal(
      resolveClApiUrl({ CL_NODE_API_URL: '127.0.0.1:3600' }),
      'http://127.0.0.1:3600',
    );
  });

  it('uses CLI_CHAIN or genesis and never CHAIN for network', () => {
    assert.equal(detectNetwork({ CLI_CHAIN: 'bepolia' }), 'bepolia');

    setBeacondRunner((args) => {
      if (args.includes('validator-root')) {
        return {
          status: 0,
          stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    try {
      assert.equal(
        detectNetwork({ BEACOND_HOME: '/tmp', CHAIN: 'mainnet' }),
        'bepolia',
      );
    } finally {
      setBeacondRunner(null);
    }
  });
});
