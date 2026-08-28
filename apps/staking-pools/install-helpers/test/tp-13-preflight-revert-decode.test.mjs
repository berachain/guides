import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setCastRunner } from '../lib/cast.mjs';
import { runTransaction } from '../lib/tx-runner.mjs';
import {
  decodeActivationRevert,
  decodeDeployRevert,
} from '../lib/revert-decoder.mjs';

describe('Preflight revert decode at runtime', () => {
  it('tx-runner surfaces named activation error on cast call revert', async () => {
    setCastRunner(() => ({
      status: 1,
      stdout: '',
      stderr: 'Error: execution reverted: custom error 0x09bde339',
    }));

    try {
      await assert.rejects(
        () =>
          runTransaction(
            { execute: false, rpcUrl: 'http://rpc', env: {} },
            {
              label: 'activateStakingPool',
              target: '0xfactory',
              signature: 'activateStakingPool()',
              buildCalldataArgs: () => [],
              decodePreflightError: decodeActivationRevert,
            },
          ),
        (error) => {
          assert.match(error.message, /InvalidProof\(\)/);
          assert.doesNotMatch(error.message, /0x09bde339/);
          return true;
        },
      );
    } finally {
      setCastRunner(null);
    }
  });

  it('tx-runner surfaces named deploy error on cast call revert', async () => {
    setCastRunner(() => ({
      status: 1,
      stdout: '',
      stderr: 'Error: execution reverted: custom error 0xc4142b41',
    }));

    try {
      await assert.rejects(
        () =>
          runTransaction(
            { execute: false, rpcUrl: 'http://rpc', env: {} },
            {
              label: 'deployStakingPoolContracts',
              target: '0xfactory',
              signature: 'deployStakingPoolContracts()',
              buildCalldataArgs: () => [],
              decodePreflightError: decodeDeployRevert,
            },
          ),
        (error) => {
          assert.match(error.message, /OperatorAlreadySet\(\)/);
          return true;
        },
      );
    } finally {
      setCastRunner(null);
    }
  });
});
