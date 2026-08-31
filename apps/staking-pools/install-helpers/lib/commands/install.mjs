import { ethers } from '../ethers-bundle.mjs';
import { BEACON_DEPOSIT_CONTRACT } from '../constants.mjs';
import { resolveRpcUrl, resolveClApiUrl, getFactoryAddress, getDelegationHandlerFactory } from '../config.mjs';
import {
  assertValidatorPreflight,
  createValidatorDeposit,
  detectNetwork,
  getBeaconValidator,
  getCoreContracts,
  getValidatorPubkey,
  getWithdrawalVault,
  predictPoolAddresses,
} from '../beacond.mjs';
import { createChainReader } from '../chain-reader.mjs';
import { prepareActivationContext, runActivationTransaction } from '../activation.mjs';
import { formatBeraAmount } from '../format.mjs';
import { logInfo, logMilestone, logWarn } from '../log.mjs';
import { detectInstallPhase } from '../pool-phase.mjs';
import { pollUntil, sleep } from '../poll.mjs';
import { confirmProceed, promptFundingAddress, promptSigningPreference } from '../prompt.mjs';
import { createSignerFromEnv, resolveSignerMode } from '../signers.mjs';
import {
  DEPOSIT_BERA,
  computeAdditionalStakeBera,
  depositWei,
  HOT_KEY_GAS_BUFFER_BERA,
} from '../stake-formula.mjs';
import { runTransaction } from '../tx-pipeline.mjs';
import { normalizeAddress } from '../units.mjs';
import { runDeploy } from './deploy.mjs';

export async function runInstall(options = {}) {
  const env = options.env ?? process.env;
  const verbose = Boolean(options.verbose);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const promptOptions = options.promptOptions ?? {};

  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const pubkey = getValidatorPubkey(env);
  const chainReader = createChainReader(rpcUrl, fetchImpl);
  const clBase = resolveClApiUrl(env);

  const mode = resolveSignerMode(env);
  let signingPreference = options.signingPreference ?? 'ledger';
  let fundingAddress = normalizeAddress(options.fundingAddress);

  if (mode === 'cold-signing') {
    if (!fundingAddress) {
      fundingAddress = await promptFundingAddress(promptOptions);
    }
    if (!options.signingPreference) {
      signingPreference = await promptSigningPreference(promptOptions);
    }
  }

  const signer = createSignerFromEnv({
    env,
    rpcUrl,
    fetchImpl,
    signingPreference,
  });

  if (mode === 'hot-key') {
    fundingAddress = await signer.getFundingAddress();
  }

  const withdrawalVault = await getWithdrawalVault(network, env, chainReader);
  const predicted = await predictPoolAddresses(factory, rpcUrl, pubkey, chainReader);
  const balanceWei = await chainReader.getBalance(fundingAddress);
  const additionalStakeBera = computeAdditionalStakeBera(balanceWei, {
    coldSigning: mode === 'cold-signing',
  });
  const depositAmountWei = depositWei();
  const canCoverDeposit = BigInt(balanceWei) >= depositAmountWei;

  const operator = normalizeAddress(options.operator) || fundingAddress;
  const sharesRecipient = normalizeAddress(options.sharesRecipient) || fundingAddress;

  const confirmation = buildConfirmation({
    network,
    pubkey,
    predicted,
    additionalStakeBera,
    canCoverDeposit,
    operator,
    sharesRecipient,
    balanceWei,
  });

  if (!canCoverDeposit) {
    throw new Error(
      `Funding wallet ${fundingAddress} cannot cover the ${DEPOSIT_BERA.toLocaleString()} BERA deposit. Shortfall before any on-chain write.`,
    );
  }

  if (!options.skipConfirmation) {
    console.log(confirmation.text);
    const confirmed = options.confirmAnswer
      ? /^y(es)?$/i.test(String(options.confirmAnswer).trim())
      : await confirmProceed('Proceed? [y/N] ', promptOptions);
    if (!confirmed) {
      throw new Error('Installation cancelled at confirmation');
    }
  }

  const plan = {
    network,
    rpcUrl,
    factory,
    pubkey,
    chainReader,
    signer,
    env,
    verbose,
    fetchImpl,
    clBase,
    fundingAddress,
    operator,
    sharesRecipient,
    additionalStakeBera,
    stakePlanned: BigInt(additionalStakeBera) > 0n,
    withdrawalVault,
    predicted,
    signingPreference,
  };

  let announcedWaiting = false;
  let announcedRegistered = false;

  while (true) {
    const state = await gatherInstallState(plan);
    const phase = detectInstallPhase({
      deployed: state.deployed,
      fullyExited: state.fullyExited,
      poolActive: state.poolActive,
      beacon: state.beacon,
      stakeTargetBera: plan.stakePlanned ? plan.additionalStakeBera : '0',
      stakeComplete: state.stakeComplete,
    });

    if (phase === 'fully_exited') {
      throw new Error('Staking pool is fully exited. install refuses to re-deploy.');
    }

    if (phase === 'done') {
      logMilestone('Done.');
      return { done: true, phase };
    }

    if (phase === 'cl_unreachable') {
      throw new Error(`Could not read beacon state: ${state.beacon.error}`);
    }

    if (phase === 'not_deployed') {
      await runDeployPhase(plan, state);
      logMilestone(`Deployed. Predicted pool: ${state.predicted.stakingPool}`);
      continue;
    }

    if (phase === 'deposited_awaiting_registration') {
      if (!announcedWaiting) {
        logMilestone('Waiting for validator registration...');
        announcedWaiting = true;
      }
      if (signer.mode === 'cold-signing') {
        await waitForBeaconRegistration(plan, state);
      } else {
        await sleep(2000);
      }
      continue;
    }

    if (phase === 'registered_awaiting_activation') {
      if (!announcedRegistered) {
        logMilestone(`Registered (index ${state.beacon.index}).`);
        announcedRegistered = true;
      }
      await runActivatePhase(plan, state);
      logMilestone('Activated.');
      continue;
    }

    if (phase === 'active_under_stake_target') {
      await runStakePhase(plan, state);
      logMilestone(`Staked ${Number(plan.additionalStakeBera).toLocaleString('en-US')} BERA.`);
      continue;
    }
  }
}

function buildConfirmation({
  network,
  pubkey,
  predicted,
  additionalStakeBera,
  canCoverDeposit,
  operator,
  sharesRecipient,
  balanceWei,
}) {
  const lines = [
    `Network:            ${network}`,
    `Validator pubkey:   ${truncateHex(pubkey)}`,
    `Predicted pool:      ${truncateHex(predicted.stakingPool)}`,
    `Deposit:             ${DEPOSIT_BERA.toLocaleString()} BERA`,
  ];

  if (BigInt(additionalStakeBera) > 0n) {
    lines.push(
      `Additional stake:    ${Number(additionalStakeBera).toLocaleString('en-US')} BERA   (funding wallet holds enough)`,
    );
  } else if (canCoverDeposit) {
    lines.push(
      `Additional stake:    0 BERA   (deposit only — add stake later with node pool-cli.mjs stake)`,
    );
  }

  lines.push(`Operator:            ${truncateHex(operator)} (defaulted to funding wallet)`);
  lines.push(`Shares recipient:    ${truncateHex(sharesRecipient)} (defaulted to funding wallet)`);
  lines.push('');

  return { text: lines.join('\n') };
}

function truncateHex(value) {
  const raw = String(value);
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

export async function gatherInstallState(plan) {
  let deployed = false;
  let predicted = plan.predicted;
  let stakingPool = predicted.stakingPool;

  try {
    const core = await getCoreContracts(plan.factory, plan.rpcUrl, plan.pubkey, plan.chainReader);
    deployed = true;
    predicted = core;
    stakingPool = core.stakingPool;
    plan.predicted = core;
  } catch (error) {
    if (/not been deployed/i.test(error.message)) {
      deployed = false;
    } else {
      throw error;
    }
  }

  let poolActive = false;
  let fullyExited = false;
  let stakeComplete = !plan.stakePlanned;

  if (deployed) {
    const active = await plan.chainReader.call(stakingPool, 'isActive()(bool)');
    poolActive = active.decoded?.[0] === true;
    const exited = await plan.chainReader.call(stakingPool, 'isFullyExited()(bool)');
    fullyExited = exited.decoded?.[0] === true;

    if (plan.stakePlanned && poolActive) {
      const totalAssets = await plan.chainReader.call(stakingPool, 'totalAssets()(uint256)');
      const targetWei = ethers.parseEther(plan.additionalStakeBera);
      const needed = depositWei() + targetWei;
      stakeComplete = BigInt(totalAssets.decoded[0]) >= needed;
    }
  }

  let beacon = { found: false, index: '', status: '', error: '' };
  try {
    beacon = await getBeaconValidator(plan.clBase, plan.pubkey, plan.fetchImpl);
  } catch (error) {
    beacon = { found: false, index: '', status: '', error: error.message };
  }

  return {
    deployed,
    predicted,
    stakingPool,
    poolActive,
    fullyExited,
    beacon,
    stakeComplete,
  };
}

async function runDeployPhase(plan, state) {
  if (plan.signer.mode === 'hot-key') {
    await runDeploy({
      operator: plan.operator,
      sharesRecipient: plan.sharesRecipient,
      env: plan.env,
      verbose: plan.verbose,
      fetchImpl: plan.fetchImpl,
      signingPreference: plan.signingPreference,
    });
    return;
  }

  await runColdSigningTransition(plan, async () => {
    return runDeploy({
      operator: plan.operator,
      sharesRecipient: plan.sharesRecipient,
      env: plan.env,
      verbose: plan.verbose,
      fetchImpl: plan.fetchImpl,
      signingPreference: plan.signingPreference,
    });
  }, async () => {
    const next = await gatherInstallState(plan);
    return next.deployed;
  });
}

async function waitForBeaconRegistration(plan, state) {
  await pollUntil(async () => {
    const beacon = await getBeaconValidator(plan.clBase, plan.pubkey, plan.fetchImpl);
    return beacon.found;
  }, { intervalMs: 1000, timeoutMs: 300000 });
}

async function runActivatePhase(plan, state) {
  const activationPrep = async () => {
    return prepareActivationContext({
      env: plan.env,
      network: plan.network,
      rpcUrl: plan.rpcUrl,
      factory: plan.factory,
      pubkey: plan.pubkey,
      predicted: state.predicted,
      chainReader: plan.chainReader,
      fetchImpl: plan.fetchImpl,
      verbose: plan.verbose,
    });
  };

  if (plan.signer.mode === 'hot-key') {
    const activationCtx = await activationPrep();
    if (activationCtx.skipped) return;
    const ctx = {
      execute: true,
      env: plan.env,
      rpcUrl: plan.rpcUrl,
      factory: plan.factory,
      chainReader: plan.chainReader,
      signer: plan.signer,
      verbose: plan.verbose,
    };
    await runActivationTransaction(ctx, activationCtx);
    return;
  }

  await runColdSigningTransition(plan, async () => {
    const activationCtx = await activationPrep();
    if (activationCtx.skipped) return { skipped: true };
    const ctx = {
      execute: false,
      env: plan.env,
      rpcUrl: plan.rpcUrl,
      factory: plan.factory,
      chainReader: plan.chainReader,
      signer: plan.signer,
      verbose: plan.verbose,
    };
    return runActivationTransaction(ctx, activationCtx);
  }, async () => {
    const active = await plan.chainReader.call(state.stakingPool, 'isActive()(bool)');
    return active.decoded?.[0] === true;
  }, {
    refresh: async () => {
      const activationCtx = await activationPrep();
      if (activationCtx.skipped) return null;
      const ctx = {
        execute: false,
        env: plan.env,
        rpcUrl: plan.rpcUrl,
        factory: plan.factory,
        chainReader: plan.chainReader,
        signer: plan.signer,
        verbose: plan.verbose,
      };
      return runActivationTransaction(ctx, activationCtx);
    },
  });
}

async function runStakePhase(plan, state) {
  const stakeAmount = plan.additionalStakeBera;
  const ctx = {
    execute: plan.signer.mode === 'hot-key',
    env: plan.env,
    rpcUrl: plan.rpcUrl,
    from: plan.fundingAddress,
    stakingPool: state.stakingPool,
    receiver: plan.sharesRecipient,
    chainReader: plan.chainReader,
    signer: plan.signer,
    verbose: plan.verbose,
    value: `${stakeAmount}ether`,
  };

  const runStakeTx = async () =>
    runTransaction(ctx, {
      label: 'submit',
      target: ctx.stakingPool,
      signature: 'submit(address)',
      value: ctx.value,
      buildCalldataArgs: () => [ctx.receiver],
      decodeDryRun: async () => {},
    });

  if (plan.signer.mode === 'hot-key') {
    await runStakeTx();
    return;
  }

  await runColdSigningTransition(plan, runStakeTx, async () => {
    const next = await gatherInstallState(plan);
    return next.stakeComplete;
  });
}

// Leave this much time before a fetched proof's real on-chain expiry: refresh
// and reprint while the operator still has a full window to act, rather than
// waiting for the old proof to actually expire before doing anything.
const PROOF_REFRESH_BUFFER_MS = 60000;

export async function runColdSigningTransition(plan, emitFn, landedFn, { refresh } = {}) {
  let lastCommand = '';
  let expiresAtSeconds;
  while (true) {
    const result = await emitFn();
    if (result?.skipped) {
      return result;
    }
    lastCommand = result?.command ?? result?.sendArgv?.join(' ') ?? lastCommand;
    expiresAtSeconds = result?.expiresAtSeconds ?? expiresAtSeconds;

    const deadlineAt = expiresAtSeconds !== undefined
      ? expiresAtSeconds * 1000 - PROOF_REFRESH_BUFFER_MS
      : undefined;
    const landed = await pollUntil(landedFn, { intervalMs: 1500, timeoutMs: 600000, deadlineAt });
    if (landed) {
      return result;
    }

    if (refresh) {
      const refreshed = await refresh();
      if (refreshed?.command && refreshed.command !== lastCommand) {
        lastCommand = refreshed.command;
      }
      expiresAtSeconds = refreshed?.expiresAtSeconds ?? expiresAtSeconds;
    }

    if (plan.verbose) {
      logWarn(
        expiresAtSeconds !== undefined
          ? 'Proof nearing expiry before it landed. Fetching a fresh proof and reprinting...'
          : 'Printed cast send did not land yet. Reprinting command...',
      );
    }
  }
}
