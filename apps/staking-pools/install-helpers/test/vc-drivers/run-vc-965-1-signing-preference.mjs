#!/usr/bin/env node
/**
 * VC-1 (BERA-965) — signing-preference never asked.
 * Cold-signing install with every other fact supplied, no --signing-preference.
 * Worktree root:
 *   node apps/staking-pools/install-helpers/test/vc-drivers/run-vc-965-1-signing-preference.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conductInterview, resolveValidatorLocality } from '../../lib/interview.mjs';
import { createColdSigningSigner } from '../../lib/signers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-965-1-signing-preference.txt');
const FUNDING = `0x${'11'.repeat(20)}`;
const PUBKEY = `0x${'ab'.repeat(48)}`;

async function main() {
  const env = {}; // no PRIVATE_KEY -> cold-signing mode
  const { locality } = resolveValidatorLocality(env); // BEACOND_HOME unset -> remote
  const prompts = [];
  const interview = await conductInterview({
    locality,
    env,
    options: { network: 'bepolia', pubkey: PUBKEY, fundingAddress: FUNDING },
    deploying: false,
    skipTtyCheck: true,
    promptImpl: async (question) => {
      prompts.push(question);
      throw new Error(`unexpected prompt (every fact was supplied): ${question}`);
    },
  });

  const signer = createColdSigningSigner({
    rpcUrl: 'http://127.0.0.1:8545',
    signingPreference: interview.answers.signingPreference || 'ledger',
  });
  const command = signer.formatCastSend({
    target: `0x${'aa'.repeat(20)}`,
    signature: 'setMinEffectiveBalance(uint256)',
    args: ['250000000000000000000000'],
    value: 0n,
  });

  const lines = [
    'VC-1 (BERA-965): signing-preference never asked, cold-signing mode.',
    '',
    `Prompts asked during the interview: ${prompts.length === 0 ? '(none)' : prompts.join(', ')}`,
    `interview.answers.signingPreference (unset by the operator): ${JSON.stringify(interview.answers.signingPreference)}`,
    '',
    'Printed cast send defaults to --ledger without ever asking:',
    command,
    '',
  ].join('\n');

  mkdirSync(dirname(ARTIFACT), { recursive: true });
  writeFileSync(ARTIFACT, lines, 'utf8');
  console.log(lines);

  if (prompts.length !== 0) {
    throw new Error('VC-1 failed: the interview asked a question');
  }
  if (!command.includes('--ledger')) {
    throw new Error('VC-1 failed: printed command did not default to --ledger');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
