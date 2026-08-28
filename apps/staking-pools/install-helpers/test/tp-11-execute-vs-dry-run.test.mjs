import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCallOnlyArgv, buildEmitSendArgv, runTransaction } from '../lib/tx-runner.mjs';
import { buildWalletArgs, buildEmitWalletArgs } from '../lib/cast.mjs';
import { setCastRunner } from '../lib/cast.mjs';

describe('TP-11 emit vs dry-run vs execute', () => {
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

  it('emit argv uses cast send with --ledger for laptop signing', () => {
    const emit = buildEmitSendArgv(target, signature, args, rpc, {}, '10000ether');
    assert.equal(emit[0], 'send');
    assert.deepEqual(buildEmitWalletArgs({}), ['--ledger']);
    assert.ok(emit.includes('--ledger'));
  });

  it('emit and execute argv send --legacy so eth_feeHistory nulls do not break broadcast', () => {
    const emit = buildEmitSendArgv(target, signature, args, rpc, {}, '10000ether');
    assert.ok(
      emit.includes('--legacy'),
      'beacon-kit EL can return a null eth_feeHistory response; --legacy skips EIP-1559 fee estimation',
    );
  });

  it('dry-run, emit, and execute argv differ appropriately', () => {
    const dryRun = buildCallOnlyArgv(target, signature, args, rpc);
    const emit = buildEmitSendArgv(target, signature, args, rpc, {});
    assert.notDeepEqual(dryRun, emit);
    assert.deepEqual(buildWalletArgs({ PRIVATE_KEY: '0x' + 'aa'.repeat(32) }), [
      '--private-key',
      '0x' + 'aa'.repeat(32),
    ]);
  });

  it('default path emits cast send without spawning send', async () => {
    const calls = [];
    setCastRunner((argv) => {
      calls.push(argv[0]);
      return { status: 0, stdout: '0x', stderr: '' };
    });

    try {
      const result = await runTransaction(
        { execute: false, rpcUrl: rpc, env: {} },
        {
          label: 'deployStakingPoolContracts',
          target,
          signature,
          buildCalldataArgs: () => args,
          value: '10000ether',
        },
      );
      assert.equal(result.mode, 'emit');
      assert.ok(result.sendArgv.includes('send'));
      assert.ok(result.sendArgv.includes('--ledger'));
      assert.deepEqual(calls, ['call']);
    } finally {
      setCastRunner(null);
    }
  });

  it('refuses --execute without PRIVATE_KEY but still emits', async () => {
    const calls = [];
    setCastRunner((argv) => {
      calls.push(argv[0]);
      return { status: 0, stdout: '0x', stderr: '' };
    });

    try {
      const result = await runTransaction(
        { execute: true, rpcUrl: rpc, env: {} },
        {
          label: 'deployStakingPoolContracts',
          target,
          signature,
          buildCalldataArgs: () => args,
        },
      );
      assert.equal(result.mode, 'emit');
      assert.equal(result.executeRefused, true);
      assert.deepEqual(calls, ['call']);
    } finally {
      setCastRunner(null);
    }
  });

  it('--execute with PRIVATE_KEY spawns cast send using same calldata', async () => {
    const calls = [];
    setCastRunner((argv) => {
      calls.push(argv[0]);
      return {
        status: 0,
        stdout: 'transactionHash: 0x' + 'ab'.repeat(32),
        stderr: '',
      };
    });

    try {
      const pk = '0x' + 'cc'.repeat(32);
      const result = await runTransaction(
        { execute: true, rpcUrl: rpc, env: { PRIVATE_KEY: pk } },
        {
          label: 'deployStakingPoolContracts',
          target,
          signature,
          buildCalldataArgs: () => args,
        },
      );
      assert.equal(result.mode, 'execute');
      assert.deepEqual(calls, ['call', 'send']);
      assert.ok(result.executeArgv.includes('--private-key'));
      assert.ok(result.executeArgv.includes('--legacy'));
      assert.equal(
        result.txHash,
        '0x' + 'ab'.repeat(32),
      );
    } finally {
      setCastRunner(null);
    }
  });

  it('prints transactionHash not the preceding blockHash', async () => {
    setCastRunner((argv) => {
      if (argv[0] === 'send') {
        return {
          status: 0,
          stdout: [
            'blockHash            0x99b803f6e2f4f0f1f610c823fc6877d0cf39ba0bfbca33913ae584da242eeaf8',
            'transactionHash      0x5c3e773c0a1b5a1b8a237004e4ad432f2bf020ff4bff6ddc3173be06d9a81768',
          ].join('\n'),
          stderr: '',
        };
      }
      return { status: 0, stdout: '0x', stderr: '' };
    });
    try {
      const result = await runTransaction(
        { execute: true, rpcUrl: rpc, env: { PRIVATE_KEY: '0x' + 'cc'.repeat(32) } },
        {
          label: 'deployStakingPoolContracts',
          target,
          signature,
          buildCalldataArgs: () => args,
        },
      );
      assert.equal(
        result.txHash,
        '0x5c3e773c0a1b5a1b8a237004e4ad432f2bf020ff4bff6ddc3173be06d9a81768',
      );
    } finally {
      setCastRunner(null);
    }
  });
});
