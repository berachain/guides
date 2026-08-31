#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectInstallPhase } from '../../lib/pool-phase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'vc-artifacts/vc-4-resume.txt');

const lines = [
  'VC-4 resume is phase-detection only (no run file):',
  '',
  'Interruption A: deployed, beacon not included',
  `  phase=${detectInstallPhase({
    deployed: true,
    fullyExited: false,
    poolActive: false,
    beacon: { found: false },
    stakeTargetBera: '100',
    stakeComplete: false,
  })}`,
  '  re-run install => waits for registration, does not re-deploy',
  '',
  'Interruption B: active, stake target pending',
  `  phase=${detectInstallPhase({
    deployed: true,
    fullyExited: false,
    poolActive: true,
    beacon: { found: true, index: '36' },
    stakeTargetBera: '100',
    stakeComplete: false,
  })}`,
  '  re-run install => submits stake only',
  '',
  'Live kill/resume transcript: run node test/vc-drivers/run-vc-1.mjs and interrupt mid-wait.',
].join('\n');

mkdirSync(dirname(ARTIFACT), { recursive: true });
writeFileSync(ARTIFACT, lines, 'utf8');
console.log(lines);
