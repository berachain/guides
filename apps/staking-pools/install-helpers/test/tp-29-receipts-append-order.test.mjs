import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { appendReceipt, readReceipts } from '../lib/receipts.mjs';

describe('TP-3 receipts append order', () => {
  it('appending N receipts never rewrites or drops an earlier one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-29-'));
    const path = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const first = {
        timestamp: '2026-08-31T12:00:00.000Z',
        action: 'deploy',
        hash: '0xaaa',
        addresses: { pool: '0x1111' },
        amount: '10000',
      };
      const second = {
        timestamp: '2026-08-31T12:01:00.000Z',
        action: 'activate',
        hash: '0xbbb',
        addresses: { pool: '0x1111' },
        amount: '0',
      };
      const third = {
        timestamp: '2026-08-31T12:02:00.000Z',
        action: 'stake',
        hash: '0xccc',
        addresses: { pool: '0x1111', sharesRecipient: '0x2222' },
        amount: '100',
      };

      appendReceipt(path, first);
      const afterOne = readReceipts(path);
      assert.deepEqual(afterOne, [first]);

      appendReceipt(path, second);
      const afterTwo = readReceipts(path);
      assert.deepEqual(afterTwo, [first, second]);

      appendReceipt(path, third);
      const afterThree = readReceipts(path);
      assert.deepEqual(afterThree, [first, second, third]);
      assert.equal(afterThree[0].hash, '0xaaa');
      assert.equal(afterThree[1].hash, '0xbbb');
      assert.equal(afterThree[2].hash, '0xccc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
