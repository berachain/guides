import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProofSlotMatchesPinned,
  extractProofFields,
} from '../lib/proofs.mjs';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('TP-3 slot consistency', () => {
  it('rejects proof slot mismatch against decimal pinned slot', () => {
    const pubkeyProof = JSON.parse(
      readFileSync(path.join(fixtureDir, 'cl-proof-pubkey.json'), 'utf8'),
    );
    assert.throws(
      () => assertProofSlotMatchesPinned(pubkeyProof, '18922032'),
      /differs from pinned slot/,
    );
    assert.doesNotThrow(() => assertProofSlotMatchesPinned(pubkeyProof, '18922033'));
    assert.doesNotThrow(() => assertProofSlotMatchesPinned(pubkeyProof, '0x120ba31'));
  });
});

describe('TP-4 proof parser', () => {
  it('extracts validator fields and cast tuple parts', () => {
    const pubkeyProof = JSON.parse(
      readFileSync(path.join(fixtureDir, 'cl-proof-pubkey.json'), 'utf8'),
    );
    const credentialsProof = JSON.parse(
      readFileSync(path.join(fixtureDir, 'cl-proof-credentials.json'), 'utf8'),
    );
    const balanceProof = JSON.parse(
      readFileSync(path.join(fixtureDir, 'cl-proof-balance.json'), 'utf8'),
    );

    const fields = extractProofFields(pubkeyProof, credentialsProof, balanceProof);
    assert.equal(fields.validatorPubkey, '0xabc123');
    assert.equal(fields.validatorBalance, '10000000000000');
    assert.match(fields.pubkeyProofCast, /0x1111/);
    assert.equal(fields.balanceLeaf, '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
  });
});
