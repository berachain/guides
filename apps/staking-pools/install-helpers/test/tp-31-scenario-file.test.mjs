import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  assertScenarioMatchesIdentity,
  readScenarioFile,
  SCENARIO_FIELDS,
  writeScenarioFile,
} from '../lib/scenario.mjs';

const PUBKEY = `0x${'ab'.repeat(48)}`;
const OTHER_PUBKEY = `0x${'cd'.repeat(48)}`;
const OPERATOR = '0x' + '11'.repeat(20);
const SHARES = '0x' + '22'.repeat(20);
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SIGNATURE = `0x${'11'.repeat(96)}`;

describe('TP-5 scenario file write field set', () => {
  it('writes exactly the locked field set even when secrets are present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp31-'));
    const path = join(dir, 'scenario.json');
    try {
      const recorded = writeScenarioFile(path, {
        network: 'bepolia',
        locality: 'remote',
        pubkey: PUBKEY,
        operator: OPERATOR,
        sharesRecipient: SHARES,
        privateKey: PRIVATE_KEY,
        PRIVATE_KEY,
        signature: SIGNATURE,
        deposit: { pubkey: PUBKEY, signature: SIGNATURE },
      });
      assert.deepEqual(Object.keys(recorded).sort(), [...SCENARIO_FIELDS].sort());
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      assert.deepEqual(Object.keys(raw).sort(), [...SCENARIO_FIELDS].sort());
      assert.equal(raw.network, 'bepolia');
      assert.equal(raw.locality, 'remote');
      assert.equal(raw.pubkey, PUBKEY);
      assert.equal(raw.operator, OPERATOR);
      assert.equal(raw.sharesRecipient, SHARES);
      const text = readFileSync(path, 'utf8');
      assert.ok(!text.includes(PRIVATE_KEY));
      assert.ok(!text.includes(SIGNATURE));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TP-7 scenario file identity verification', () => {
  it('rejects a recorded pubkey that does not match current identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp31-'));
    const path = join(dir, 'scenario.json');
    try {
      writeFileSync(
        path,
        JSON.stringify({
          network: 'bepolia',
          locality: 'local',
          pubkey: PUBKEY,
          operator: OPERATOR,
          sharesRecipient: SHARES,
        }),
      );
      const scenario = readScenarioFile(path);
      assert.throws(
        () =>
          assertScenarioMatchesIdentity(scenario, {
            network: 'bepolia',
            pubkey: OTHER_PUBKEY,
          }),
        /pubkey.*conflict|conflict.*pubkey/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a recorded network that does not match current identity', () => {
    const scenario = {
      network: 'bepolia',
      locality: 'remote',
      pubkey: PUBKEY,
      operator: OPERATOR,
      sharesRecipient: SHARES,
    };
    assert.throws(
      () =>
        assertScenarioMatchesIdentity(scenario, {
          network: 'mainnet',
          pubkey: PUBKEY,
        }),
      /network.*conflict|conflict.*network/i,
    );
  });

  it('accepts a matching network and pubkey', () => {
    assert.doesNotThrow(() =>
      assertScenarioMatchesIdentity(
        {
          network: 'bepolia',
          locality: 'remote',
          pubkey: PUBKEY,
          operator: OPERATOR,
          sharesRecipient: SHARES,
        },
        { network: 'bepolia', pubkey: PUBKEY },
      ),
    );
  });
});
