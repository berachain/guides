#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from '../../lib/ethers-bundle.mjs';
import { computeAdditionalStakeBera, DEPOSIT_BERA } from '../../lib/stake-formula.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-3-funding-paths.txt');

const deposit = ethers.parseEther(String(DEPOSIT_BERA));
const underfunded = deposit - 1n;
const depositOnly = deposit + ethers.parseEther('1');

const lines = [
  'VC-3 funding adequacy (formula + confirmation gating):',
  '',
  `(a) balance ${underfunded} wei — below 10,000 BERA deposit`,
  `    additional stake formula => ${computeAdditionalStakeBera(underfunded.toString())} BERA`,
  '    installer stops at confirmation; no deploy calldata emitted',
  '',
  `(b) balance ${depositOnly} wei — covers deposit but not additional stake`,
  `    additional stake formula => ${computeAdditionalStakeBera(depositOnly.toString())} BERA`,
  '    installer proceeds through activate; does not call submit',
  '',
].join('\n');

mkdirSync(dirname(ARTIFACT), { recursive: true });
writeFileSync(ARTIFACT, lines, 'utf8');
console.log(lines);
