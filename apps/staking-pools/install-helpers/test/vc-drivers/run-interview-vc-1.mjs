#!/usr/bin/env node
/**
 * VC-1 — validator-remote deploy decision logic (no live TTY).
 * Worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-interview-vc-1.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatCreateValidatorCommand,
  getWithdrawalVault,
  parseDepositOutput,
} from '../../lib/beacond.mjs';
import { BEPOLIA_VALIDATOR_ROOT, DEPOSIT_AMOUNT_GWEI } from '../../lib/constants.mjs';
import { createChainReader } from '../../lib/chain-reader.mjs';
import { resolveValidatorLocality } from '../../lib/interview.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = join(ROOT, 'vc-artifacts');
const OUT = join(ARTIFACT_DIR, 'vc-interview-1-remote-deposit.txt');

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const locality = resolveValidatorLocality({});
  const lines = [];
  const log = (line = '') => {
    lines.push(line);
    console.log(line);
  };

  log('=== VC-1 validator-remote deposit command + paste parse ===');
  log(`locality with no BEACOND_HOME: ${locality.locality}`);

  const reader = createChainReader('https://bepolia.rpc.berachain.com');
  const vault = await getWithdrawalVault('bepolia', {}, reader);
  log(`withdrawal vault (bepolia factory): ${vault}`);

  const command = formatCreateValidatorCommand(vault, 'bepolia');
  log('printed command:');
  log(command);

  const pubkey = `0x${'ab'.repeat(48)}`;
  const credentials = `0x010000000000000000000000${vault.slice(2).toLowerCase()}`;
  const signature = `0x${'11'.repeat(96)}`;
  const pasted = [
    `pubkey: ${pubkey}`,
    `credentials: ${credentials}`,
    `signature: ${signature}`,
    `amount: ${DEPOSIT_AMOUNT_GWEI}`,
  ].join('\n');
  log('');
  log('pasted deposit output:');
  log(pasted);
  const fields = parseDepositOutput(pasted);
  log('');
  log('parsed fields:');
  log(JSON.stringify(fields, null, 2));

  if (locality.locality !== 'remote') {
    throw new Error('expected validator-remote when BEACOND_HOME is unset');
  }
  if (!command.includes(vault)) throw new Error('command missing vault');
  if (!command.includes(BEPOLIA_VALIDATOR_ROOT)) throw new Error('command missing genesis root');
  if (!command.includes(DEPOSIT_AMOUNT_GWEI)) throw new Error('command missing deposit amount');
  if (!command.startsWith('beacond deposit create-validator')) {
    throw new Error('command is not a create-validator invocation');
  }
  if (fields.pubkey !== pubkey || fields.credentials !== credentials || fields.signature !== signature) {
    throw new Error('parsed fields do not match the local-path shape');
  }

  log('');
  log('VC-1 pass: command is complete; paste parses to {pubkey, credentials, signature, amount}.');
  writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
