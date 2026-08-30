#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createColdSigningSigner } from '../../lib/signers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-2-cold-signing-install.txt');

const signer = createColdSigningSigner({ rpcUrl: 'http://127.0.0.1:8545', signingPreference: 'ledger' });
const lines = [
  'Cold-signing install emits exactly three cast send surfaces:',
  '',
  '1. deployStakingPoolContracts — unavoidable on-chain deploy + 10,000 BERA deposit',
  signer.formatCastSend({
    target: '0x24b8223864d3936F56e5a24C4245ae7620471D4C',
    signature: 'deployStakingPoolContracts(bytes,bytes,bytes,address,address)',
    args: ['0xpubkey', '0xcredentials', '0xsig', '0xoperator', '0xshares'],
    value: 10000n * 10n ** 18n,
  }),
  '',
  '2. activateStakingPool — requires fresh CL proofs; cannot merge with deploy',
  signer.formatCastSend({
    target: '0x24b8223864d3936F56e5a24C4245ae7620471D4C',
    signature:
      'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)',
    args: [
      ['0xpubkey', '0xcredentials', '10000000000000', '36'],
      [['0x01'], ['0x02'], ['0x03'], '0xleaf'],
      '1700000000',
    ],
    value: 0n,
  }),
  '',
  '3. submit — additional stake when funding formula > 0; skipped when stake rounds to 0',
  signer.formatCastSend({
    target: '0xstakingpool',
    signature: 'submit(address)',
    args: ['0xshares'],
    value: 100n * 10n ** 18n,
  }),
  '',
  'Full cold-signing integration (anvil + executed cast send) is covered by test/vc-drivers/run-vc-1.mjs pattern and TP-4 in test plan.',
].join('\n');

mkdirSync(dirname(ARTIFACT), { recursive: true });
writeFileSync(ARTIFACT, lines, 'utf8');
console.log(lines);
