import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { STAKING_POOL_FACTORY_BEPOLIA } from '../lib/constants.mjs';
import { createChainReader } from '../lib/chain-reader.mjs';
import { startAnvilFork } from './helpers/anvil-harness.mjs';

const HELPERS = dirname(fileURLToPath(import.meta.url)) + '/helpers';
const WORKER = join(HELPERS, 'hotkey-deploy-spy-worker.mjs');
const PRELOAD = join(HELPERS, 'process-spy-preload.cjs');

const OPERATOR = '0x' + '11'.repeat(20);
const SHARES = '0x' + '22'.repeat(20);
const FOUNDRY_BINARIES = new Set(['cast', 'foundry', 'forge', 'anvil', 'chisel']);

function randomPubkey() {
  const hex = Array.from({ length: 48 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
  ).join('');
  return `0x${hex}`;
}

function assertNoCastOrFoundry(spawnCalls) {
  const forbidden = spawnCalls.filter((call) => FOUNDRY_BINARIES.has(call.executable));
  assert.deepEqual(
    forbidden,
    [],
    `Forbidden Foundry subprocess invoked: ${JSON.stringify(forbidden)}`,
  );
}

describe('TP-2 hot-key deploy integration (anvil fork)', () => {
  it('deploys factory-predicted addresses without spawning cast', async () => {
    if (!commandExists('anvil') || !commandExists('forge') || !commandExists('cast')) {
      return;
    }

    const anvil = await startAnvilFork();
    const pubkey = randomPubkey();
    const tmpDir = mkdtempSync(join(tmpdir(), 'tp02-spy-'));
    const spyOut = join(tmpDir, 'spawn-log.json');

    try {
      const predictedBefore = await createChainReader(anvil.rpcUrl).call(
        STAKING_POOL_FACTORY_BEPOLIA,
        'predictStakingPoolContractsAddresses(bytes)(address,address,address,address)',
        [pubkey],
      );

      const worker = spawnSync(
        process.execPath,
        ['--require', PRELOAD, WORKER],
        {
          env: {
            ...process.env,
            SPY_OUT: spyOut,
            BEACOND_HOME: '/tmp',
            CLI_CHAIN: 'bepolia',
            BEACOND_BIN: join(HELPERS, 'fake-beacond.sh'),
            RPC_URL: anvil.rpcUrl,
            PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            OPERATOR,
            SHARES_RECIPIENT: SHARES,
            VALIDATOR_PUBKEY: pubkey,
          },
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      if (worker.status !== 0) {
        const detail = worker.stderr?.trim() || worker.stdout?.trim() || 'spy worker failed';
        const short = detail.length > 800 ? `${detail.slice(0, 800)}…` : detail;
        throw new Error(short);
      }

      const spawnCalls = JSON.parse(readFileSync(spyOut, 'utf8'));
      assert.ok(Array.isArray(spawnCalls) && spawnCalls.length > 0, 'process spy recorded calls');
      assertNoCastOrFoundry(spawnCalls);

      const chainReader = createChainReader(anvil.rpcUrl);
      const core = await chainReader.call(
        STAKING_POOL_FACTORY_BEPOLIA,
        'getCoreContracts(bytes)(address,address,address,address)',
        [pubkey],
      );

      assert.equal(
        String(core.decoded[1]).toLowerCase(),
        String(predictedBefore.decoded[1]).toLowerCase(),
      );

      const code = await chainReader.getCode(String(core.decoded[1]).toLowerCase());
      assert.ok(code && code !== '0x');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
      anvil.stop();
    }
  });
});

function commandExists(name) {
  const result = spawnSync('command', ['-v', name], { encoding: 'utf8', shell: true });
  return result.status === 0;
}
