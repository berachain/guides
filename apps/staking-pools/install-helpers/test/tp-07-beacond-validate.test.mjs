import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { setBeacondRunner } from '../lib/beacond.mjs';
import { runDeploy } from '../lib/commands/deploy.mjs';

describe('TP-7 deploy deposit validation', () => {
  it('shells to beacond deposit validate and fails on non-zero exit', async () => {
    setCastRunner((argv) => {
      if (argv[2]?.includes('withdrawalVault')) {
        return { status: 0, stdout: '0x4242424242424242424242424242424242424242', stderr: '' };
      }
      if (argv[2]?.includes('predictStakingPoolContractsAddresses')) {
        return { status: 0, stdout: '(0x1,0x2,0x3,0x4)', stderr: '' };
      }
      return { status: 0, stdout: '0x', stderr: '' };
    });

    setBeacondRunner((args) => {
      if (args.includes('create-validator')) {
        return {
          status: 0,
          stdout: 'pubkey: 0xabc\ncredentials: 0xdef\nsignature: 0xsig\namount: 1\n',
          stderr: '',
        };
      }
      if (args.includes('validate')) {
        return { status: 1, stdout: '', stderr: 'invalid deposit' };
      }
      if (args.includes('validator-root')) {
        return {
          status: 0,
          stdout: '0x3cbcf75b02fe4750c592f1c1ff8b5500a74406f80f038e9ff250e2e294c5615e',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    try {
      await assert.rejects(
        () =>
          runDeploy({
            operator: '0x' + '11'.repeat(20),
            sharesRecipient: '0x' + '22'.repeat(20),
            execute: false,
            env: {
              BEACOND_HOME: '/tmp/beacond',
              CHAIN: 'bepolia',
              BEACOND_BIN: 'beacond',
            },
          }),
        /invalid deposit/,
      );
    } finally {
      setCastRunner(null);
      setBeacondRunner(null);
    }
  });
});
