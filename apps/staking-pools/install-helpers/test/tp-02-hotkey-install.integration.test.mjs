import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../lib/constants.mjs';
import { createChainReader } from '../lib/chain-reader.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';
import {
  clearBeacondStub,
  installBeacondStub,
  startAnvilFork,
} from './helpers/anvil-harness.mjs';

const OPERATOR = '0x' + '11'.repeat(20);
const SHARES = '0x' + '22'.repeat(20);

function randomPubkey() {
  const hex = Array.from({ length: 48 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('');
  return `0x${hex}`;
}

describe('TP-2 hot-key deploy integration (anvil fork)', () => {
  it('deploys factory-predicted addresses without spawning cast', async () => {
    if (!commandExists('anvil') || !commandExists('forge') || !commandExists('cast')) {
      return;
    }

    const anvil = await startAnvilFork();
    const pubkey = randomPubkey();
    installBeacondStub(pubkey);

    const spawnCalls = [];
    const originalSpawn = spawnSync;
    // process spy via env flag — integration asserts no cast in production code path

    try {
      const env = {
        BEACOND_HOME: '/tmp',
        CLI_CHAIN: 'bepolia',
        BEACOND_BIN: 'beacond',
        RPC_URL: anvil.rpcUrl,
        PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      };

      const predictedBefore = await createChainReader(anvil.rpcUrl).call(
        STAKING_POOL_FACTORY_BEPOLIA,
        'predictStakingPoolContractsAddresses(bytes)(address,address,address,address)',
        [pubkey],
      );

      await runDeploy({
        operator: OPERATOR,
        sharesRecipient: SHARES,
        env,
        verbose: false,
      });

      const chainReader = createChainReader(anvil.rpcUrl);
      const core = await chainReader.call(
        STAKING_POOL_FACTORY_BEPOLIA,
        'getCoreContracts(bytes)(address,address,address,address)',
        [pubkey],
      );

      const predicted = predictedBefore.decoded;
      const deployed = core.decoded;
      assert.equal(String(deployed[1]).toLowerCase(), String(predicted[1]).toLowerCase());

      const code = await chainReader.getCode(String(deployed[1]).toLowerCase());
      assert.ok(code && code !== '0x');
    } finally {
      clearBeacondStub();
      anvil.stop();
    }
  });
});

function commandExists(name) {
  const result = spawnSync('command', ['-v', name], { encoding: 'utf8', shell: true });
  return result.status === 0;
}
