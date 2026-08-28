import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  deriveEip4788Timestamp,
  eip4788ElBlockNumber,
  pinActivationSlot,
} from '../lib/proofs.mjs';
import { parseCastBlockNumber, unwrapCastJson } from '../lib/cast.mjs';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('TP-8 EIP-4788 timestamp', () => {
  it('derives timestamp from pinned slot plus one EL block fixture', () => {
    const block = JSON.parse(readFileSync(path.join(fixtureDir, 'el-block.json'), 'utf8'));
    const timestamp = deriveEip4788Timestamp('0x120ba31', block);
    assert.equal(timestamp, Number.parseInt('669f1234', 16));
  });

  it('unwraps Foundry 1.8 cast --json envelope before reading timestamp', () => {
    const envelope = {
      schema_version: 1,
      success: true,
      data: { number: '0x176430a', timestamp: '0x669f1234' },
      errors: [],
      warnings: [],
    };
    const block = unwrapCastJson(JSON.stringify(envelope));
    const timestamp = deriveEip4788Timestamp('0x1764309', block);
    assert.equal(timestamp, Number.parseInt('669f1234', 16));
  });

  it('pins min(CL head, EL latest - 1) minus 3 so slot+1 is already on EL', () => {
    assert.equal(pinActivationSlot(24527778, 24527778), 24527774n);
    assert.equal(eip4788ElBlockNumber(24527774n), 24527775n);
    assert.equal(pinActivationSlot(24527778, 24527780), 24527775n);
    assert.equal(pinActivationSlot(100, 200), 97n);
  });

  it('parses plain and Foundry-envelope block-number output', () => {
    assert.equal(parseCastBlockNumber('24527778\n'), 24527778n);
    assert.equal(
      parseCastBlockNumber(
        JSON.stringify({
          schema_version: 1,
          success: true,
          data: 24527778,
          errors: [],
          warnings: [],
        }),
      ),
      24527778n,
    );
  });
});
