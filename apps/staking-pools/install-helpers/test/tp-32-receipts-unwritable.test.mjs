import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { appendReceipt } from '../lib/receipts.mjs';

describe('TP-6 unwritable receipts path', () => {
  it('fails clearly naming the write failure instead of skipping', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tp-32-'));
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    const path = join(locked, 'staking-pool-receipts.jsonl');
    try {
      assert.throws(
        () =>
          appendReceipt(path, {
            timestamp: '2026-08-31T12:00:00.000Z',
            action: 'deploy',
            hash: '0xaaa',
            addresses: { pool: '0x1111' },
            amount: '10000',
          }),
        (error) => {
          assert.match(error.message, /^Failed to write receipts file /);
          assert.match(error.message, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
          assert.match(error.message, /EACCES|permission|EROFS|unwritable/i);
          return true;
        },
      );
    } finally {
      chmodSync(locked, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
