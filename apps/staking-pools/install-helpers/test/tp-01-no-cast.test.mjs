import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_DIRS = ['lib', 'pool-cli.mjs'];

function listProductionFiles() {
  const files = [];
  for (const entry of PRODUCTION_DIRS) {
    const path = join(ROOT, entry);
    if (path.endsWith('.mjs')) {
      files.push(path);
      continue;
    }
    for (const name of readdirSync(path)) {
      if (name.endsWith('.mjs')) {
        files.push(join(path, name));
      }
    }
  }
  return files;
}

const FORBIDDEN_SPAWN = /child_process\.(spawn|spawnSync|exec|execSync|execFile)\s*\(\s*['"`](cast|foundry)/;

describe('TP-1 no cast subprocess in CLI-owned production files', () => {
  it('does not spawn cast or foundry binaries', () => {
    const hits = [];
    for (const file of listProductionFiles()) {
      const source = readFileSync(file, 'utf8');
      if (FORBIDDEN_SPAWN.test(source) || /spawnSync\(\s*['"`]cast['"`]/.test(source)) {
        hits.push(file);
      }
    }
    assert.deepEqual(hits, []);
  });

  it('does not install cast-runner test doubles in VC integration tests', () => {
    const integration = join(ROOT, 'test/tp-02-hotkey-install.integration.test.mjs');
    const source = readFileSync(integration, 'utf8');
    assert.ok(!source.includes('setCastRunner'));
  });
});
