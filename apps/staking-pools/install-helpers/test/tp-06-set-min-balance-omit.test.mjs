import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { main } from '../pool-cli.mjs';

describe('TP-6 set-min-balance omission', () => {
  it('does not error when command is omitted from argv', async () => {
    const code = await main(['status', '--help']);
    assert.equal(code, 0);
  });
});
