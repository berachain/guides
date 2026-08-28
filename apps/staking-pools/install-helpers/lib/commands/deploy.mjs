import { DEPLOY_VALUE } from '../constants.mjs';
import { resolveRpcUrl, getFactoryAddress } from '../config.mjs';
import {
  assertValidatorPreflight,
  createValidatorDeposit,
  detectNetwork,
  getWithdrawalVault,
  predictPoolAddresses,
} from '../beacond.mjs';
import { logInfo, logSuccess } from '../log.mjs';
import { decodeDeployRevert } from '../revert-decoder.mjs';
import { runTransaction } from '../tx-runner.mjs';

function normalizeAddress(address) {
  const lower = address.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(lower) ? lower : '';
}

export async function runDeploy(options) {
  const operator = normalizeAddress(options.operator);
  const sharesRecipient = normalizeAddress(options.sharesRecipient);
  if (!operator) throw new Error('--op must be a valid EVM address');
  if (!sharesRecipient) throw new Error('--sr must be a valid EVM address');

  const env = options.env ?? process.env;
  assertValidatorPreflight(env);
  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const withdrawalVault = getWithdrawalVault(network, env);
  const deposit = createValidatorDeposit(withdrawalVault, env);

  logSuccess('Deposit validation: OK');

  const predicted = predictPoolAddresses(factory, rpcUrl, deposit.pubkey);
  logInfo('Predicted contract addresses:');
  console.log(`  SmartOperator:          ${predicted.smartOperator}`);
  console.log(`  StakingPool:            ${predicted.stakingPool}`);
  console.log(`  StakingRewardsVault:    ${predicted.stakingRewardsVault}`);
  console.log(`  IncentiveCollector:     ${predicted.incentiveCollector}`);
  console.log('');

  const ctx = {
    execute: options.execute,
    env,
    rpcUrl,
    network,
    factory,
    deposit,
    operator,
    sharesRecipient,
    predicted,
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
      logSuccess('Preflight OK');
      logInfo('Predicted pool contracts (predictStakingPoolContractsAddresses):');
      console.log(`  smartOperator:       ${ctx.predicted.smartOperator}`);
      console.log(`  stakingPool:         ${ctx.predicted.stakingPool}`);
      console.log(
        `  stakingRewardsVault: ${ctx.predicted.stakingRewardsVault}`,
      );
      console.log(`  incentiveCollector:  ${ctx.predicted.incentiveCollector}`);
      logInfo(`Value transfer authorized: ${DEPLOY_VALUE} initial deposit`);
    },
  });
}
