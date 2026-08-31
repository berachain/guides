import { DEPLOY_VALUE } from '../constants.mjs';
import { resolveRpcUrl, getFactoryAddress } from '../config.mjs';
import {
  assertValidatorPreflight,
  createValidatorDeposit,
  detectNetwork,
  getWithdrawalVault,
  predictPoolAddresses,
} from '../beacond.mjs';
import { createChainReader } from '../chain-reader.mjs';
import { createSignerFromEnv } from '../signers.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { decodeDeployRevert } from '../revert-decoder.mjs';
import { runTransaction } from '../tx-pipeline.mjs';
import { normalizeAddress } from '../units.mjs';

export async function runDeploy(options) {
  const operator = normalizeAddress(options.operator);
  const sharesRecipient = normalizeAddress(options.sharesRecipient);
  if (!operator) throw new Error('--op must be a valid EVM address');
  if (!sharesRecipient) throw new Error('--sr must be a valid EVM address');

  const env = options.env ?? process.env;
  const verbose = Boolean(options.verbose);
  if (!options.deposit) {
    assertValidatorPreflight(env);
  }
  const network = options.network ?? detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const chainReader = createChainReader(rpcUrl, options.fetchImpl);
  const withdrawalVault = await getWithdrawalVault(network, env, chainReader);
  const deposit = options.deposit ?? createValidatorDeposit(withdrawalVault, env);
  const signer = createSignerFromEnv({
    env,
    rpcUrl,
    fetchImpl: options.fetchImpl,
    signingPreference: options.signingPreference,
  });

  if (verbose) {
    logSuccess('Deposit validation: OK');
  }

  const predicted = await predictPoolAddresses(factory, rpcUrl, deposit.pubkey, chainReader);
  if (verbose) {
    logInfo('Predicted contract addresses:');
    console.log(`  SmartOperator:          ${predicted.smartOperator}`);
    console.log(`  StakingPool:            ${predicted.stakingPool}`);
    console.log(`  StakingRewardsVault:    ${predicted.stakingRewardsVault}`);
    console.log(`  IncentiveCollector:     ${predicted.incentiveCollector}`);
    console.log('');
  }

  const ctx = {
    execute: signer.mode === 'hot-key',
    env,
    rpcUrl,
    network,
    factory,
    deposit,
    operator,
    sharesRecipient,
    predicted,
    chainReader,
    signer,
    verbose,
  };

  return runTransaction(ctx, {
    label: 'deployStakingPoolContracts',
    target: factory,
    signature:
      'deployStakingPoolContracts(bytes,bytes,bytes,address,address)',
    decodePreflightError: decodeDeployRevert,
    value: DEPLOY_VALUE,
    buildCalldataArgs: () => [
      ctx.deposit.pubkey,
      ctx.deposit.credentials,
      ctx.deposit.signature,
      ctx.operator,
      ctx.sharesRecipient,
    ],
    decodeDryRun: async () => {
      if (verbose) {
        logSuccess('Preflight OK');
        logInfo('Predicted pool contracts (predictStakingPoolContractsAddresses):');
        console.log(`  smartOperator:       ${ctx.predicted.smartOperator}`);
        console.log(`  stakingPool:         ${ctx.predicted.stakingPool}`);
        console.log(
          `  stakingRewardsVault: ${ctx.predicted.stakingRewardsVault}`,
        );
        console.log(`  incentiveCollector:  ${ctx.predicted.incentiveCollector}`);
        logInfo(`Value transfer authorized: ${DEPLOY_VALUE} initial deposit`);
      }
    },
  });
}
