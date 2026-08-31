import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { appendReceipt, readReceipts } from '../lib/receipts.mjs';

describe('TP-5 receipts torn-write safety', () => {
  it('read-back after a mid-record truncate returns exactly the first N records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-31-'));
    const path = join(dir, 'staking-pool-receipts.jsonl');
    try {
      const records = [
        {
          timestamp: '2026-08-31T12:00:00.000Z',
          action: 'deploy',
          hash: '0xaaa',
          addresses: { pool: '0x1111' },
          amount: '10000',
        },
        {
          timestamp: '2026-08-31T12:01:00.000Z',
          action: 'activate',
          hash: '0xbbb',
          addresses: { pool: '0x1111' },
          amount: '0',
        },
      ];
      for (const record of records) {
        appendReceipt(path, record);
      }

      const next = {
        timestamp: '2026-08-31T12:02:00.000Z',
        action: 'stake',
        hash: '0xccc',
        addresses: { pool: '0x1111', sharesRecipient: '0x2222' },
        amount: '100',
      };
      const nextLine = `${JSON.stringify(next)}\n`;
      const cut = Math.floor(nextLine.length / 2);
      assert.ok(cut > 0, 'torn fragment must be non-empty');
      appendFileSync(path, nextLine.slice(0, cut), 'utf8');
      assert.ok(statSync(path).size > 0);

      const parsed = readReceipts(path);
      assert.deepEqual(parsed, records);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
