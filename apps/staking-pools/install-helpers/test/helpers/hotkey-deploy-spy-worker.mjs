import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDependencies } from '../../lib/deps.mjs';
import { runDeploy } from '../../lib/commands/deploy.mjs';
import { setBeacondRunner } from '../../lib/beacond.mjs';

const HELPERS = join(dirname(fileURLToPath(import.meta.url)));
const FAKE_BEACOND = join(HELPERS, 'fake-beacond.sh');

const {
  SPY_OUT,
  BEACOND_HOME,
  CLI_CHAIN,
  BEACOND_BIN,
  RPC_URL,
  PRIVATE_KEY,
  OPERATOR,
  SHARES_RECIPIENT,
  VALIDATOR_PUBKEY,
  BEPOLIA_VALIDATOR_ROOT = '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e',
} = process.env;

if (!SPY_OUT || !RPC_URL || !PRIVATE_KEY || !VALIDATOR_PUBKEY) {
  console.error('hotkey-deploy-spy-worker: missing required env');
  process.exit(2);
}

const env = {
  ...process.env,
  BEACOND_HOME: BEACOND_HOME ?? '/tmp',
  CLI_CHAIN: CLI_CHAIN ?? 'bepolia',
  BEACOND_BIN: BEACOND_BIN?.startsWith('/') ? BEACOND_BIN : FAKE_BEACOND,
  VC_PUBKEY: VALIDATOR_PUBKEY,
  RPC_URL,
  PRIVATE_KEY,
};

setBeacondRunner((args) => {
  if (args.includes('validator-keys')) {
    return {
      status: 0,
      stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${VALIDATOR_PUBKEY}\n`,
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
        `pubkey: ${VALIDATOR_PUBKEY}`,
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

// Dependency resolution uses child_process; beacond calls are stubbed above.
checkDependencies(env);

await runDeploy({
  operator: OPERATOR,
  sharesRecipient: SHARES_RECIPIENT,
  env,
  verbose: false,
});

writeFileSync(SPY_OUT, JSON.stringify(global.__SPAWN_LOG__ ?? []), 'utf8');
