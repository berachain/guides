import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseCastTuple } from '../lib/cast.mjs';
import { predictPoolAddresses } from '../lib/beacond.mjs';
import { setCastRunner } from '../lib/cast.mjs';

const liveStdout = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cast-four-addresses.txt'),
  'utf8',
);

const ADDRS = [
  '0x00912663954ab747b126aA7E3C157e98eF12D099',
  '0xFA6c09EdCFECEaA39F7Ab1e3d956712B5B74cA88',
  '0xcEd6eba9CC104A4EeaE1201E695C1012D71737Eb',
  '0x6F251ac8922A970524F6a6E8E4e91c6650b7525a',
];

describe('TP-14 parseCastTuple live Foundry shape', () => {
  it('splits newline-separated addresses with no commas (live cast call)', () => {
    assert.deepEqual(parseCastTuple(liveStdout), ADDRS);
  });

  it('still splits comma tuples with parentheses', () => {
    assert.deepEqual(parseCastTuple('(0x1,0x2,0x3,0x4)'), ['0x1', '0x2', '0x3', '0x4']);
  });

  it('still splits comma-per-line tuples', () => {
    assert.deepEqual(parseCastTuple('(\n0x1,\n0x2,\n0x3,\n0x4\n)'), [
      '0x1',
      '0x2',
      '0x3',
      '0x4',
    ]);
  });

  it('predictPoolAddresses throws when stdout is one concatenated blob', () => {
    setCastRunner(() => ({
      status: 0,
      stdout: ADDRS.join(''),
      stderr: '',
    }));
    try {
      assert.throws(
        () => predictPoolAddresses('0xfactory', 'http://rpc', '0xpk'),
        /expected 4 addresses/,
      );
    } finally {
      setCastRunner(null);
    }
  });

  it('predictPoolAddresses returns four addresses from live stdout', () => {
    setCastRunner(() => ({ status: 0, stdout: liveStdout, stderr: '' }));
    try {
      assert.deepEqual(predictPoolAddresses('0xfactory', 'http://rpc', '0xpk'), {
        smartOperator: ADDRS[0],
        stakingPool: ADDRS[1],
        stakingRewardsVault: ADDRS[2],
        incentiveCollector: ADDRS[3],
      });
    } finally {
      setCastRunner(null);
    }
  });
});
