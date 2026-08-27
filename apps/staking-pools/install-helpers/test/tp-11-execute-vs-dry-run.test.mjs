import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCallOnlyArgv, buildSendArgv } from '../lib/tx-runner.mjs';
import { buildWalletArgs } from '../lib/cast.mjs';

describe('TP-11 execute vs dry-run argv', () => {
  const target = '0xfactory';
  const signature = 'deployStakingPoolContracts(bytes,bytes,bytes,address,address)';
  const args = ['0xpk', '0xcred', '0xsig', '0xop', '0xsr'];
  const rpc = 'http://rpc';

  it('dry-run uses cast call without wallet flags', () => {
    const dryRun = buildCallOnlyArgv(target, signature, args, rpc, '10000ether');
    assert.equal(dryRun[0], 'call');
    assert.ok(!dryRun.includes('--ledger'));
    assert.ok(!dryRun.includes('--private-key'));
  });

  it('execute uses cast send with wallet flags', () => {
    const execute = buildSendArgv(target, signature, args, rpc, {}, '10000ether');
    assert.equal(execute[0], 'send');
    assert.deepEqual(buildWalletArgs({}), ['--ledger']);
  });

  it('dry-run and execute argv differ', () => {
    const dryRun = buildCallOnlyArgv(target, signature, args, rpc);
    const execute = buildSendArgv(target, signature, args, rpc, {});
    assert.notDeepEqual(dryRun, execute);
  });
});
