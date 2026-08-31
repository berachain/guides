import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { resolveStandaloneIdentity } from '../lib/identity.mjs';
import { writeScenarioFile } from '../lib/scenario.mjs';

const SCEN_PUBKEY = `0x${'ab'.repeat(48)}`;
const EXPLICIT_PUBKEY = `0x${'cd'.repeat(48)}`;
const OPERATOR = '0x' + '11'.repeat(20);
const SHARES = '0x' + '22'.repeat(20);

function scenarioDir() {
  return mkdtempSync(join(tmpdir(), 'tp40-'));
}

describe('TP-9 precedence: explicit > scenario file > local beacond', () => {
  afterEach(() => setBeacondRunner(null));

  it('explicit env wins over a present, matching scenario file', () => {
    const dir = scenarioDir();
    const scenarioPath = join(dir, 'scenario.json');
    try {
      writeScenarioFile(scenarioPath, {
        network: 'bepolia',
        locality: 'remote',
        pubkey: SCEN_PUBKEY,
        operator: OPERATOR,
        sharesRecipient: SHARES,
      });
      const identity = resolveStandaloneIdentity(
        { CLI_CHAIN: 'mainnet', VALIDATOR_PUBKEY: EXPLICIT_PUBKEY },
        { scenarioPath },
      );
      assert.equal(identity.network, 'mainnet');
      assert.equal(identity.pubkey, EXPLICIT_PUBKEY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scenario file wins over local beacond when both could answer', () => {
    const dir = scenarioDir();
    const scenarioPath = join(dir, 'scenario.json');
    setBeacondRunner(() => {
      throw new Error('must not call beacond when the scenario file already answers');
    });
    try {
      writeScenarioFile(scenarioPath, {
        network: 'bepolia',
        locality: 'local',
        pubkey: SCEN_PUBKEY,
        operator: OPERATOR,
        sharesRecipient: SHARES,
      });
      const identity = resolveStandaloneIdentity({ BEACOND_HOME: '/tmp/beacond' }, { scenarioPath });
      assert.equal(identity.network, 'bepolia');
      assert.equal(identity.pubkey, SCEN_PUBKEY);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to local beacond only when validator-local and neither explicit nor scenario answer', () => {
    setBeacondRunner((args) => {
      if (args.includes('validator-keys')) {
        return { status: 0, stdout: `Eth/Beacon Pubkey (Compressed 48-byte Hex):\n${SCEN_PUBKEY}\n`, stderr: '' };
      }
      if (args.includes('validator-root')) {
        return { status: 0, stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    const dir = scenarioDir();
    try {
      const identity = resolveStandaloneIdentity(
        { BEACOND_HOME: '/tmp/beacond' },
        { scenarioPath: join(dir, 'nonexistent-scenario.json') },
      );
      assert.equal(identity.network, 'bepolia');
      assert.equal(identity.pubkey, SCEN_PUBKEY);
      assert.equal(identity.locality, 'local');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TP-10 fails closed pointing at install when nothing answers (validator-remote, no scenario)', () => {
  it('names install as the fix, unchanged from BERA-960', () => {
    const dir = scenarioDir();
    try {
      assert.throws(
        () =>
          resolveStandaloneIdentity(
            { CLI_CHAIN: 'bepolia' },
            { scenarioPath: join(dir, 'nonexistent-scenario.json') },
          ),
        /install/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Error Map: a present but malformed scenario file fails naming the file, not a generic refusal', () => {
  it('surfaces the parse error, not the install-pointer refusal', () => {
    const dir = scenarioDir();
    const scenarioPath = join(dir, 'scenario.json');
    writeFileSync(scenarioPath, '{ not valid json');
    try {
      assert.throws(
        () => resolveStandaloneIdentity({ CLI_CHAIN: 'bepolia' }, { scenarioPath }),
        (error) => {
          assert.match(error.message, new RegExp(scenarioPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
          assert.ok(!/run `install` instead/i.test(error.message));
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
