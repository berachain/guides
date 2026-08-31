import { BEACON_DEPOSIT_CONTRACT } from '../constants.mjs';
import {
  getDelegationHandlerFactory,
  getFactoryAddress,
  resolveClApiUrl,
  resolveRpcUrl,
} from '../config.mjs';
import { getBeaconValidator, getCoreContracts, getWithdrawalVault } from '../beacond.mjs';
import { createChainReader, walletAddressFromPrivateKey } from '../chain-reader.mjs';
import { formatWeiToDecimal, stripScientificNotation } from '../format.mjs';
import { resolveStandaloneIdentity } from '../identity.mjs';
import { logInfo, logSuccess, logWarn, logError } from '../log.mjs';
import { classifyPoolPhase } from '../pool-phase.mjs';

export async function runStatus(options = {}) {
  const env = options.env ?? process.env;
  const verbose = Boolean(options.verbose);
  const { network, pubkey } = resolveStandaloneIdentity(env, options);

  const rpcUrl = resolveRpcUrl(network, env);
  const factory = getFactoryAddress(network);
  const chainReader = createChainReader(rpcUrl, options.fetchImpl);

  if (verbose) {
    logInfo(`Chain: ${network}`);
    logInfo(`Validator pubkey: ${pubkey}`);
  }

  const delegationFactory = getDelegationHandlerFactory(network);
  if (delegationFactory && delegationFactory !== '0x0000000000000000000000000000000000000000') {
    const handler = await chainReader.call(
      delegationFactory,
      'delegationHandlers(bytes)(address)',
      [pubkey],
    );
    const handlerAddr = String(handler.decoded[0]);
    if (handlerAddr && handlerAddr !== '0x0000000000000000000000000000000000000000') {
      logInfo('✓ Delegated pool detected');
      logInfo(`  DelegationHandler: ${handlerAddr}`);
    }
  }
  console.log('');

  let core;
  try {
    core = await getCoreContracts(factory, rpcUrl, pubkey, chainReader);
  } catch (error) {
    if (/not been deployed/i.test(error.message)) {
      throw new Error(
        'Pool contracts are not deployed for this pubkey. Run deploy first. isActive is not available yet.',
      );
    }
    throw error;
  }
  const { smartOperator, stakingPool, stakingRewardsVault, incentiveCollector } = core;

  logInfo('✓ Contract addresses and verification:');
  for (const [name, addr] of [
    ['SmartOperator', smartOperator],
    ['StakingPool', stakingPool],
    ['StakingRewardsVault', stakingRewardsVault],
    ['IncentiveCollector', incentiveCollector],
  ]) {
    const code = await chainReader.getCode(addr);
    if (!code || code === '0x') {
      logError(`  ✗ ${name}: ${addr} (no code deployed)`);
      throw new Error('Some contracts do not have code deployed');
    }
    logInfo(`  ✓ ${name}: ${addr}`);
  }
  console.log('');

  const registered = await chainReader.call(
    BEACON_DEPOSIT_CONTRACT,
    'getOperator(bytes)(address)',
    [pubkey],
  );
  const registeredOp = String(registered.decoded[0]).toLowerCase();
  if (registeredOp !== smartOperator.toLowerCase()) {
    throw new Error(
      `Operator mismatch. Expected ${smartOperator}, registered ${registeredOp}`,
    );
  }

  const isActive = await chainReader.call(stakingPool, 'isActive()(bool)');
  const threshold = await chainReader.call(stakingPool, 'activeThresholdReached()(bool)');
  const fullyExited = await chainReader.call(stakingPool, 'isFullyExited()(bool)');

  const poolActive = isActive.decoded?.[0] === true;
  const poolExited = fullyExited.decoded?.[0] === true;

  const clBase = resolveClApiUrl(env);
  let beacon = { found: false, index: '', status: '', error: '' };
  try {
    beacon = await getBeaconValidator(clBase, pubkey, options.fetchImpl);
  } catch (error) {
    beacon = { found: false, index: '', status: '', error: error.message };
  }

  const phase = classifyPoolPhase({
    fullyExited: poolExited,
    poolActive,
    beacon,
  });

  console.log('');
  logInfo('=== Activation gate ===');
  logInfo(`EL operator:     registered (${registeredOp})`);
  if (beacon.found) {
    logInfo(`Beacon:          index ${beacon.index}, status ${beacon.status}`);
  } else if (beacon.error) {
    logWarn(`Beacon:          lookup failed at ${clBase}`);
    logWarn(`                 ${beacon.error}`);
  } else {
    logInfo(`Beacon:          not in head state (queried ${clBase})`);
  }
  logInfo(
    `Pool isActive:   ${poolActive}  (factory activateStakingPool has ${poolActive ? 'been' : 'not been'} called)`,
  );
  if (phase.phase === 'ready_to_activate' || phase.phase === 'pool_active') {
    logSuccess(phase.headline);
  } else {
    logInfo(phase.headline);
  }
  if (phase.next) {
    logInfo(`Next:            ${phase.next}`);
  }

  if (phase.phase !== 'pool_active' && phase.phase !== 'fully_exited') {
    return { active: false, phase: phase.phase, beacon };
  }

  const totalAssets = await chainReader.call(stakingPool, 'totalAssets()(uint256)');
  const totalSupply = await chainReader.call(stakingPool, 'totalSupply()(uint256)');
  const assetsEth = formatWeiToDecimal(String(totalAssets.decoded[0]));
  const supplyEth = formatWeiToDecimal(String(totalSupply.decoded[0]));
  console.log(`  Total assets (BERA):    ${assetsEth}`);
  console.log(`  Total supply (stBERA):  ${supplyEth}`);
  console.log('');

  logInfo('=== Checking Withdrawal Availability ===');
  logInfo(`Threshold Reached: ${threshold.decoded[0]}`);
  logInfo(`Fully Exited: ${fullyExited.decoded[0]}`);
  console.log('');

  logInfo('=== Pool Telemetry ===');
  await printWeiField(chainReader, 'Buffered Assets', stakingPool, 'bufferedAssets()(uint256)', 'BERA');
  await printWeiField(
    chainReader,
    'Min Effective Balance',
    stakingPool,
    'minEffectiveBalance()(uint256)',
    'BERA',
  );

  logInfo('=== WBERA Disposition ===');
  await printWeiField(
    chainReader,
    'Available WBERA (operator-side liquidity)',
    smartOperator,
    'availableWBERABalance()(uint256)',
    'WBERA',
  );
  await printWeiField(
    chainReader,
    'Rebaseable WBERA (in pool assets)',
    smartOperator,
    'rebaseableWberaAmount()(uint256)',
    'WBERA',
  );
  await printFeeState(chainReader, 'WBERA', smartOperator, 'getEarnedWBERAFeeState()(uint256,uint256,uint256,uint96)');

  await printLegacyBgt(chainReader, smartOperator);

  if (env.PRIVATE_KEY?.trim()) {
    await printWalletHoldings(env, stakingPool, network, rpcUrl, chainReader);
  }

  return { active: true, phase: phase.phase, stakingPool, smartOperator, beacon };
}

async function printWeiField(chainReader, label, target, signature, unit) {
  try {
    const result = await chainReader.call(target, signature);
    const value = formatWeiToDecimal(String(result.decoded[0]));
    logInfo(`${label}: ${value} ${unit}`);
  } catch (error) {
    logWarn(`Could not get ${label}: ${error.message}`);
  }
}

async function printFeeState(chainReader, label, target, signature) {
  try {
    const result = await chainReader.call(target, signature);
    const [current, charged, chargeable, feeBps] = result.decoded;
    logInfo(`Total ${label} Balance: ${formatWeiToDecimal(String(current))} ${label}`);
    logInfo(`${label} Already Charged Fees: ${formatWeiToDecimal(String(charged))} ${label}`);
    logInfo(`${label} Chargeable (new earnings): ${formatWeiToDecimal(String(chargeable))} ${label}`);
    const pct = Number(feeBps) / 100;
    logInfo(`Protocol Fee: ${pct.toFixed(2)}%`);
  } catch (error) {
    logWarn(`Could not get ${label} fee state: ${error.message}`);
  }
}

async function printLegacyBgt(chainReader, smartOperator) {
  const unboosted = await chainReader.call(smartOperator, 'unboostedBalance()(uint256)');
  const feeState = await chainReader.call(
    smartOperator,
    'getEarnedBGTFeeState()(uint256,uint256,uint256,uint96)',
  );
  const unboostedNum = stripScientificNotation(String(unboosted.decoded[0]));
  const current = String(feeState.decoded[0]);
  const chargeable = String(feeState.decoded[2]);
  if (unboostedNum === '0' && current === '0' && chargeable === '0') {
    return;
  }
  logInfo('=== Legacy BGT Disposition ===');
  await printWeiField(chainReader, 'Unboosted BGT', smartOperator, 'unboostedBalance()(uint256)', 'BGT');
  await printFeeState(chainReader, 'BGT', smartOperator, 'getEarnedBGTFeeState()(uint256,uint256,uint256,uint96)');
}

async function printWalletHoldings(env, stakingPool, network, rpcUrl, chainReader) {
  console.log('');
  logInfo('=== Wallet Holdings (PRIVATE_KEY) ===');
  const walletAddr = (await walletAddressFromPrivateKey(env.PRIVATE_KEY.trim())).toLowerCase();
  logInfo(`Address: ${walletAddr}`);

  const shares = await chainReader.call(stakingPool, 'balanceOf(address)(uint256)', [walletAddr]);
  logInfo(`stBERA Shares: ${formatWeiToDecimal(String(shares.decoded[0]))}`);

  const withdrawalVault = await getWithdrawalVault(network, env, chainReader);
  const nftCount = await chainReader.call(withdrawalVault, 'balanceOf(address)(uint256)', [walletAddr]);
  logInfo(`Withdrawal NFTs: ${stripScientificNotation(String(nftCount.decoded[0]))}`);
}
