import { MIN_ACTIVATION_BALANCE_GWEI, PROOF_MAX_AGE_SECONDS } from '../constants.mjs';
import { resolveRpcUrl, resolveClApiUrl, getFactoryAddress } from '../config.mjs';
import { BEACON_DEPOSIT_CONTRACT } from '../constants.mjs';
import {
  assertValidatorPreflight,
  detectNetwork,
  getValidatorPubkey,
  getValidatorIndex,
  predictPoolAddresses,
  getWithdrawalVault,
} from '../beacond.mjs';
import { runCast, parseCastTuple } from '../cast.mjs';
import { decodeActivationRevert } from '../revert-decoder.mjs';
import {
  assertProofSlotMatchesPinned,
  deriveEip4788Timestamp,
  extractProofFields,
  fetchJson,
  formatProofTuple,
  formatValidatorDataTuple,
  isProofExpired,
  proofExpiryTimestamp,
} from '../proofs.mjs';
import { logInfo, logSuccess, logWarn, logError } from '../log.mjs';
import { runTransaction } from '../tx-runner.mjs';

export async function runActivate(options) {
  const env = options.env ?? process.env;
  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const clBase = resolveClApiUrl(env);
  const factory = getFactoryAddress(network);
  const pubkey = getValidatorPubkey(env);
  const withdrawalVault = getWithdrawalVault(network, env);

  logInfo(`Network: ${network}`);
  logInfo(`Validator pubkey: ${pubkey}`);
  logInfo(`CL node API: ${clBase}`);
  console.log('');

  const predicted = predictPoolAddresses(factory, rpcUrl, pubkey);
  logInfo('Predicted contract addresses:');
  console.log(`  StakingPool: ${predicted.stakingPool}`);
  console.log('');

  const code = runCast(['code', predicted.stakingPool, '-r', rpcUrl]);
  if (code.status !== 0 || !code.stdout.trim() || code.stdout.trim() === '0x') {
    throw new Error(
      `Staking pool contract not found at ${predicted.stakingPool}. Deploy first.`,
    );
  }

  const active = runCast([
    'call',
    predicted.stakingPool,
    'isActive()(bool)',
    '-r',
    rpcUrl,
  ]);
  if (active.status === 0 && active.stdout.trim() === 'true') {
    logSuccess('Pool is already activated — no action needed');
    return { skipped: true };
  }

  const validatorIndex = await getValidatorIndex(clBase, pubkey, options.fetchImpl);
  if (!validatorIndex) {
    throw new Error('Validator not yet registered on beacon chain');
  }
  logSuccess(`Validator registered on beacon chain (index: ${validatorIndex})`);

  const head = await fetchJson(
    `${clBase}/eth/v1/beacon/headers/head`,
    'beacon head',
    options.fetchImpl,
  );
  const pinnedSlot = head.data.header.message.slot;
  logInfo(`Pinned CL slot: ${pinnedSlot}`);

  const pubkeyProof = await fetchJson(
    `${clBase}/bkit/v1/proof/validator_pubkey/${pinnedSlot}/${validatorIndex}`,
    'validator_pubkey proof',
    options.fetchImpl,
  );
  const credentialsProof = await fetchJson(
    `${clBase}/bkit/v1/proof/validator_credentials/${pinnedSlot}/${validatorIndex}`,
    'validator_credentials proof',
    options.fetchImpl,
  );
  const balanceProof = await fetchJson(
    `${clBase}/bkit/v1/proof/validator_balance/${pinnedSlot}/${validatorIndex}`,
    'validator_balance proof',
    options.fetchImpl,
  );

  for (const proof of [pubkeyProof, credentialsProof, balanceProof]) {
    assertProofSlotMatchesPinned(proof, pinnedSlot);
  }
  logSuccess(`All proofs pinned to slot ${pinnedSlot}`);

  const elBlockNumber = BigInt(pinnedSlot) + 1n;
  logInfo(`Reading EIP-4788 timestamp from EL block ${elBlockNumber.toString()}...`);
  const blockResult = runCast(['block', elBlockNumber.toString(), '--json', '-r', rpcUrl]);
  if (blockResult.status !== 0) {
    throw new Error(`Failed to read EL block ${elBlockNumber.toString()}`);
  }
  const blockJson = JSON.parse(blockResult.stdout);
  const proofTimestamp = deriveEip4788Timestamp(pinnedSlot, blockJson);
  logSuccess(`EIP-4788 timestamp: ${proofTimestamp}`);

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

  const validatorTuple = formatValidatorDataTuple(fields, validatorIndex);
  const proofTuple = formatProofTuple(fields);

  const ctx = {
    execute: options.execute,
    env,
    rpcUrl,
    factory,
    proofTimestamp,
    nowSeconds: options.now ?? Math.floor(Date.now() / 1000),
    validatorTuple,
    proofTuple,
  };

  const expiry = proofExpiryTimestamp(proofTimestamp);
  logWarn(
    `Proof expiry: unix ${expiry} (${PROOF_MAX_AGE_SECONDS}s after timestamp ${proofTimestamp})`,
  );

  return runTransaction(ctx, {
    label: 'activateStakingPool',
    target: factory,
    signature:
      'activateStakingPool((bytes,bytes,uint64,uint64),(bytes32[],bytes32[],bytes32[],bytes32),uint64)',
    decodePreflightError: decodeActivationRevert,
    buildCalldataArgs: () => [ctx.validatorTuple, ctx.proofTuple, String(ctx.proofTimestamp)],
    decodeDryRun: async () => {
      logSuccess('Preflight OK — activateStakingPool would succeed at current head');
    },
    beforeEmit: () => {
      if (isProofExpired(ctx.nowSeconds, ctx.proofTimestamp)) {
        throw new Error(
          `Proof window expired at unix ${expiry}. Re-run activate to regenerate proofs.`,
        );
      }
    },
    onExecuteSuccess: (_ctx, txHash) => {
      if (txHash) logSuccess(`activateStakingPool broadcast: ${txHash}`);
    },
  });
}

export async function verifyOperatorMatch(factory, rpcUrl, pubkey) {
  const coreRaw = runCast([
    'call',
    factory,
    'getCoreContracts(bytes)((address,address,address,address))',
    pubkey,
    '-r',
    rpcUrl,
  ]);
  if (coreRaw.status !== 0) return null;
  const [smartOperator] = parseCastTuple(coreRaw.stdout.trim());
  const beaconOp = runCast([
    'call',
    BEACON_DEPOSIT_CONTRACT,
    'getOperator(bytes)(address)',
    pubkey,
    '-r',
    rpcUrl,
  ]);
  if (beaconOp.status !== 0) return null;
  return {
    smartOperator: smartOperator.toLowerCase(),
    beaconOperator: beaconOp.stdout.trim().toLowerCase(),
  };
}
