import { spawn, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setBeacondRunner } from '../../lib/beacond.mjs';

const CONTRACTS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../contracts-staking-pools',
);
const ANVIL_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const BEACON_DEPOSIT = '0x4242424242424242424242424242424242424242';
const BEACON_ROOTS = '0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02';
const BEPOLIA_VALIDATOR_ROOT =
  '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e';

export async function startAnvilFork({ port } = {}) {
  const chosenPort = port ?? 18540 + Math.floor(Math.random() * 500);
  const rpcUrl = `http://127.0.0.1:${chosenPort}`;
  const proc = spawn(
    'anvil',
    ['--fork-url', 'https://bepolia.rpc.berachain.com', '--port', String(chosenPort)],
    { stdio: 'ignore' },
  );

  await waitForRpc(rpcUrl);
  etchMockContract('test/mock/MockBeaconDeposit.sol:MockBeaconDeposit', BEACON_DEPOSIT, rpcUrl);
  etchMockContract('test/mock/MockEIP4788.sol:MockEIP4788', BEACON_ROOTS, rpcUrl);
  fundAccount('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', rpcUrl);

  return {
    proc,
    rpcUrl,
    stop: () => {
      proc.kill('SIGTERM');
    },
  };
}

export function installBeacondStub(pubkey = `0x${'ab'.repeat(48)}`) {
  setBeacondRunner((args) => {
    if (args.includes('validator-keys')) {
      return {
        status: 0,
        stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${pubkey}\n`,
        stderr: '',
      };
    }
    if (args.includes('validator-root')) {
      return { status: 0, stdout: BEPOLIA_VALIDATOR_ROOT, stderr: '' };
    }
    if (args.includes('create-validator')) {
      const vault = args[2]?.toLowerCase() ?? '0xbbed2d94338cde2926a8c0576432de32c05c66e9';
      const wc = `0x010000000000000000000000${vault.slice(2)}`;
      return {
        status: 0,
        stdout: [
          `pubkey: ${pubkey}`,
          `credentials: ${wc}`,
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

export function clearBeacondStub() {
  setBeacondRunner(null);
}

async function waitForRpc(rpcUrl, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error(`anvil did not become ready at ${rpcUrl}`);
}

function fundAccount(address, rpcUrl) {
  execSync(
    `cast rpc anvil_setBalance ${address} 0x3635c9adc5dea0000000 -r ${rpcUrl}`,
    { encoding: 'utf8' },
  );
}

function etchMockContract(contract, target, rpcUrl) {
  const createOut = execSync(
    `forge create ${contract} --rpc-url ${rpcUrl} --private-key ${ANVIL_PRIVATE_KEY} --broadcast`,
    { cwd: CONTRACTS_ROOT, encoding: 'utf8' },
  );
  const deployed = createOut.match(/Deployed to:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  if (!deployed) {
    throw new Error(`forge create failed for ${contract}: ${createOut}`);
  }
  const code = execSync(`cast code ${deployed} -r ${rpcUrl}`, { encoding: 'utf8' }).trim();
  execSync(`cast rpc anvil_setCode ${target} ${code} -r ${rpcUrl}`, { encoding: 'utf8' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
