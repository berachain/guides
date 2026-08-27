import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { deriveEip4788Timestamp } from '../lib/proofs.mjs';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('TP-8 EIP-4788 timestamp', () => {
  it('derives timestamp from pinned slot plus one EL block fixture', () => {
    const block = JSON.parse(readFileSync(path.join(fixtureDir, 'el-block.json'), 'utf8'));
    const timestamp = deriveEip4788Timestamp('0x120ba31', block);
    assert.equal(timestamp, Number.parseInt('669f1234', 16));
  });
});
