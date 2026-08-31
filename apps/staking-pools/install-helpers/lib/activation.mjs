import { BEACON_DEPOSIT_CONTRACT, MIN_ACTIVATION_BALANCE_GWEI, PROOF_MAX_AGE_SECONDS, PROOF_SLOT_LAG } from './constants.mjs';
import { resolveClApiUrl, isLoopbackHttp } from './config.mjs';
import {
  getValidatorIndex,
  getWithdrawalVault,
} from './beacond.mjs';
import { createChainReader } from './chain-reader.mjs';
import { decodeActivationRevert } from './revert-decoder.mjs';
import {
  assertProofSlotMatchesPinned,
  buildProofDataArgs,
  buildValidatorDataArgs,
  deriveEip4788Timestamp,
  extractProofFields,
  fetchJson,
  eip4788ElBlockNumber,
  pinActivationSlot,
  proofExpiryTimestamp,
  isProofExpired,
} from './proofs.mjs';
import { logInfo, logSuccess, logWarn } from './log.mjs';
import { awaitConfirmedWrite } from './confirmed-write.mjs';
import { runTransaction } from './tx-pipeline.mjs';

export async function prepareActivationContext({
  env,
  network,
  rpcUrl,
  factory,
  pubkey,
  predicted,
  chainReader,
  fetchImpl = globalThis.fetch,
  now,
  verbose = false,
}) {
  const clBase = resolveClApiUrl(env);
  const withdrawalVault = await getWithdrawalVault(network, env, chainReader);

  if (verbose) {
    logInfo(`Network: ${network}`);
    logInfo(`Validator pubkey: ${pubkey}`);
    logInfo(`CL node API: ${clBase}`);
    logInfo(`EL RPC: ${rpcUrl}`);
    if (isLoopbackHttp(clBase) && !isLoopbackHttp(rpcUrl)) {
      logWarn(
        `CL is local but EL RPC is ${rpcUrl}. EIP-4788 reads the EL. Set EL_RPC_URL to this host's execution RPC.`,
      );
    }
    console.log('');
    logInfo('Predicted contract addresses:');
    console.log(`  StakingPool: ${predicted.stakingPool}`);
    console.log('');
  }

  const code = await chainReader.getCode(predicted.stakingPool);
  if (!code || code === '0x') {
    throw new Error(
      `Staking pool contract not found at ${predicted.stakingPool}. Deploy first.`,
    );
  }

  const activeResult = await chainReader.call(predicted.stakingPool, 'isActive()(bool)');
  if (activeResult.decoded?.[0] === true) {
    return { skipped: true, alreadyActive: true };
  }

  const validatorIndex = await getValidatorIndex(clBase, pubkey, fetchImpl);
  if (!validatorIndex) {
    throw new Error('Validator not yet registered on beacon chain');
  }
  if (verbose) {
    logSuccess(`Validator registered on beacon chain (index: ${validatorIndex})`);
  }

  const head = await fetchJson(
    `${clBase}/eth/v1/beacon/headers/head`,
    'beacon head',
    fetchImpl,
  );
  const clHead = head.data.header.message.slot;
  const elLatestRaw = await chainReader.getBlockNumber();
  const elLatest = BigInt(elLatestRaw);
  const pinnedSlot = pinActivationSlot(clHead, elLatest, PROOF_SLOT_LAG);
  const elBlockNumber = eip4788ElBlockNumber(pinnedSlot);

  if (verbose) {
    logInfo(`CL head: ${clHead}`);
    logInfo(`EL latest: ${elLatest.toString()}`);
    logInfo(
      `Pinned CL slot: ${pinnedSlot.toString()} (head minus lag ${PROOF_SLOT_LAG.toString()}; EIP-4788 uses EL block slot+1 = ${elBlockNumber.toString()})`,
    );
  }

  const pubkeyProof = await fetchJson(
    `${clBase}/bkit/v1/proof/validator_pubkey/${pinnedSlot}/${validatorIndex}`,
    'validator_pubkey proof',
    fetchImpl,
  );
  const credentialsProof = await fetchJson(
    `${clBase}/bkit/v1/proof/validator_credentials/${pinnedSlot}/${validatorIndex}`,
    'validator_credentials proof',
    fetchImpl,
  );
  const balanceProof = await fetchJson(
    `${clBase}/bkit/v1/proof/validator_balance/${pinnedSlot}/${validatorIndex}`,
    'validator_balance proof',
    fetchImpl,
  );

  for (const proof of [pubkeyProof, credentialsProof, balanceProof]) {
    assertProofSlotMatchesPinned(proof, pinnedSlot);
  }
  if (verbose) {
    logSuccess(`All proofs pinned to slot ${pinnedSlot}`);
  }

  if (verbose) {
    logInfo(`Reading EIP-4788 timestamp from EL block ${elBlockNumber.toString()} via ${rpcUrl}...`);
  }
  const blockJson = await chainReader.getBlockByNumber(elBlockNumber, false);
  const proofTimestamp = deriveEip4788Timestamp(pinnedSlot, blockJson);
  if (verbose) {
    logSuccess(`EIP-4788 timestamp: ${proofTimestamp}`);
  }

  const fields = extractProofFields(pubkeyProof, credentialsProof, balanceProof);
  const expectedWc = `0x010000000000000000000000${withdrawalVault.slice(2).toLowerCase()}`;
  if (fields.validatorWithdrawalCredentials.toLowerCase() !== expectedWc) {
    throw new Error(
      `Validator withdrawal credentials mismatch. Expected ${expectedWc}, got ${fields.validatorWithdrawalCredentials}`,
    );
  }

  const balanceDec = BigInt(fields.validatorBalance);
  if (balanceDec < MIN_ACTIVATION_BALANCE_GWEI) {
    throw new Error(
      `Validator balance too low for activation: ${balanceDec.toString()}`,
    );
  }

  const validatorArgs = buildValidatorDataArgs(fields, validatorIndex);
  const proofArgs = buildProofDataArgs(fields);
  const nowSeconds = now ?? Math.floor(Date.now() / 1000);
  const expiry = proofExpiryTimestamp(proofTimestamp);

  if (verbose) {
    logWarn(
      `Proof expiry: unix ${expiry} (${PROOF_MAX_AGE_SECONDS}s after timestamp ${proofTimestamp})`,
    );
  }

  return {
    skipped: false,
    validatorIndex,
    validatorArgs,
    proofArgs,
    proofTimestamp,
    nowSeconds,
    expiry,
    pinnedSlot,
    clBase,
  };
}

export async function runActivationTransaction(ctx, activationCtx) {
  const pool = ctx.predicted?.stakingPool || ctx.stakingPool || '';
  const descriptor = {
    label: 'activateStakingPool',
    target: ctx.factory,
    signature:
      'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)',
    decodePreflightError: decodeActivationRevert,
    buildCalldataArgs: () => [
      activationCtx.validatorArgs,
      activationCtx.proofArgs,
      String(activationCtx.proofTimestamp),
    ],
    decodeDryRun: async () => {
      if (ctx.verbose) {
        logSuccess('Preflight OK — activateStakingPool would succeed at current head');
      }
    },
    beforeEmit: () => {
      if (isProofExpired(activationCtx.nowSeconds, activationCtx.proofTimestamp)) {
        throw new Error(
          `Proof window expired at unix ${activationCtx.expiry}. Re-run activate to regenerate proofs.`,
        );
      }
    },
    onExecuteSuccess: (_ctx, txHash) => {
      if (_ctx.verbose && txHash) {
        logSuccess(`activateStakingPool broadcast: ${txHash}`);
      }
    },
  };

  return awaitConfirmedWrite({
    ctx,
    runTx: () => runTransaction(ctx, descriptor),
    landedFn: async () => {
      const active = await ctx.chainReader.call(pool, 'isActive()(bool)');
      return active.decoded?.[0] === true;
    },
    refresh: ctx.refreshProofs,
    action: 'activate',
    addresses: { pool, factory: ctx.factory },
    amount: '0',
    scanAddress: ctx.factory,
    waitForLanding: ctx.waitForLanding !== false,
  });
}

export async function verifyOperatorMatch(factory, rpcUrl, pubkey, chainReader) {
  const coreResult = await chainReader.call(
    factory,
    'getCoreContracts(bytes)(address,address,address,address)',
    [pubkey],
  );
  const smartOperator = String(coreResult.decoded[0]).toLowerCase();
  const beaconOpResult = await chainReader.call(
    BEACON_DEPOSIT_CONTRACT,
    'getOperator(bytes)(address)',
    [pubkey],
  );
  return {
    smartOperator,
    beaconOperator: String(beaconOpResult.decoded[0]).toLowerCase(),
  };
}
