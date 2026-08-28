import { BEACON_DEPOSIT_CONTRACT } from '../constants.mjs';
import {
  getDelegationHandlerFactory,
  getFactoryAddress,
  resolveClApiUrl,
  resolveRpcUrl,
} from '../config.mjs';
import {
  detectNetwork,
  getBeaconValidator,
  getCoreContracts,
  getValidatorPubkey,
  getWithdrawalVault,
} from '../beacond.mjs';
import { runCast, parseCastTuple, castFromWei, stripScientificNotation } from '../cast.mjs';
import { logInfo, logSuccess, logWarn, logError } from '../log.mjs';
import { classifyPoolPhase } from '../pool-phase.mjs';

export async function runStatus(options = {}) {
  const env = options.env ?? process.env;
  if (!env.BEACOND_HOME?.trim()) {
    throw new Error('BEACOND_HOME is required');
  }

  const network = detectNetwork(env);
  const rpcUrl = resolveRpcUrl(network, env);
  const pubkey = getValidatorPubkey(env);
  const factory = getFactoryAddress(network);

  logInfo(`Chain: ${network}`);
  logInfo(`Validator pubkey: ${pubkey}`);

  const delegationFactory = getDelegationHandlerFactory(network);
  if (delegationFactory && delegationFactory !== '0x0000000000000000000000000000000000000000') {
    const handler = runCast([
      'call',
      delegationFactory,
      'delegationHandlers(bytes)(address)',
      pubkey,
      '-r',
      rpcUrl,
    ]);
    const handlerAddr = handler.stdout?.trim();
    if (
      handler.status === 0 &&
      handlerAddr &&
      handlerAddr !== '0x0000000000000000000000000000000000000000'
    ) {
      logInfo('✓ Delegated pool detected');
      logInfo(`  DelegationHandler: ${handlerAddr}`);
    }
  }
  console.log('');

  let core;
  try {
    core = getCoreContracts(factory, rpcUrl, pubkey);
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
    const code = runCast(['code', addr, '-r', rpcUrl]);
    if (code.status !== 0 || !code.stdout.trim() || code.stdout.trim() === '0x') {
      logError(`  ✗ ${name}: ${addr} (no code deployed)`);
      throw new Error('Some contracts do not have code deployed');
    }
    logInfo(`  ✓ ${name}: ${addr}`);
  }
  console.log('');

  const registered = runCast([
    'call',
    BEACON_DEPOSIT_CONTRACT,
    'getOperator(bytes)(address)',
    pubkey,
    '-r',
    rpcUrl,
  ]);
  if (registered.status !== 0) {
    throw new Error('Failed to get operator from beacon deposit contract');
  }
  const registeredOp = registered.stdout.trim().toLowerCase();
  if (registeredOp !== smartOperator.toLowerCase()) {
    throw new Error(
      `Operator mismatch. Expected ${smartOperator}, registered ${registeredOp}`,
    );
  }

  const isActive = runCast(['call', stakingPool, 'isActive()(bool)', '-r', rpcUrl]);
  const threshold = runCast([
    'call',
    stakingPool,
    'activeThresholdReached()(bool)',
    '-r',
    rpcUrl,
  ]);
  const fullyExited = runCast([
    'call',
    stakingPool,
    'isFullyExited()(bool)',
    '-r',
    rpcUrl,
  ]);

  const poolActive = isActive.status === 0 && isActive.stdout.trim() === 'true';
  const poolExited = fullyExited.status === 0 && fullyExited.stdout.trim() === 'true';

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
  logInfo(`Pool isActive:   ${poolActive}  (factory activateStakingPool has ${poolActive ? 'been' : 'not been'} called)`);
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

  const totalAssets = runCast(['call', stakingPool, 'totalAssets()(uint256)', '-r', rpcUrl]);
  const totalSupply = runCast(['call', stakingPool, 'totalSupply()(uint256)', '-r', rpcUrl]);
  if (totalAssets.status === 0 && totalSupply.status === 0) {
    const assetsEth = await castFromWei(stripScientificNotation(totalAssets.stdout));
    const supplyEth = await castFromWei(stripScientificNotation(totalSupply.stdout));
    console.log(`  Total assets (BERA):    ${assetsEth}`);
    console.log(`  Total supply (stBERA):  ${supplyEth}`);
  }
  console.log('');

  logInfo('=== Checking Withdrawal Availability ===');
  if (threshold.status === 0) logInfo(`Threshold Reached: ${threshold.stdout.trim()}`);
  if (fullyExited.status === 0) logInfo(`Fully Exited: ${fullyExited.stdout.trim()}`);
  console.log('');

  logInfo('=== Pool Telemetry ===');
  await printWeiField('Buffered Assets', stakingPool, 'bufferedAssets()(uint256)', rpcUrl, 'BERA');
  await printWeiField(
    'Min Effective Balance',
    stakingPool,
    'minEffectiveBalance()(uint256)',
    rpcUrl,
    'BERA',
  );

  logInfo('=== WBERA Disposition ===');
  await printWeiField(
    'Available WBERA (operator-side liquidity)',
    smartOperator,
    'availableWBERABalance()(uint256)',
    rpcUrl,
    'WBERA',
  );
  await printWeiField(
    'Rebaseable WBERA (in pool assets)',
    smartOperator,
    'rebaseableWberaAmount()(uint256)',
    rpcUrl,
    'WBERA',
  );
  await printFeeState(
    'WBERA',
    smartOperator,
    'getEarnedWBERAFeeState()(uint256,uint256,uint256,uint96)',
    rpcUrl,
  );

  await printLegacyBgt(smartOperator, rpcUrl);

  if (env.PRIVATE_KEY?.trim()) {
    await printWalletHoldings(env, stakingPool, network, rpcUrl);
  }

  return { active: true, phase: phase.phase, stakingPool, smartOperator, beacon };
}

async function printWeiField(label, target, signature, rpcUrl, unit) {
  const result = runCast(['call', target, signature, '-r', rpcUrl]);
  if (result.status !== 0) {
    logWarn(`Could not get ${label}: ${result.stderr || result.stdout}`);
    return;
  }
  const value = await castFromWei(stripScientificNotation(result.stdout));
  logInfo(`${label}: ${value} ${unit}`);
}

async function printFeeState(label, target, signature, rpcUrl) {
  const result = runCast(['call', target, signature, '-r', rpcUrl]);
  if (result.status !== 0) {
    logWarn(`Could not get ${label} fee state: ${result.stderr || result.stdout}`);
    return;
  }
  const [current, charged, chargeable, feeBps] = parseCastTuple(result.stdout.trim());
  logInfo(`Total ${label} Balance: ${await castFromWei(current)} ${label}`);
  logInfo(`${label} Already Charged Fees: ${await castFromWei(charged)} ${label}`);
  logInfo(`${label} Chargeable (new earnings): ${await castFromWei(chargeable)} ${label}`);
  const pct = Number(feeBps) / 100;
  logInfo(`Protocol Fee: ${pct.toFixed(2)}%`);
}

async function printLegacyBgt(smartOperator, rpcUrl) {
  const unboosted = runCast([
    'call',
    smartOperator,
    'unboostedBalance()(uint256)',
    '-r',
    rpcUrl,
  ]);
  const feeState = runCast([
    'call',
    smartOperator,
    'getEarnedBGTFeeState()(uint256,uint256,uint256,uint96)',
    '-r',
    rpcUrl,
  ]);
  const unboostedNum = unboosted.status === 0 ? stripScientificNotation(unboosted.stdout) : '0';
  let current = '0';
  let chargeable = '0';
  if (feeState.status === 0) {
    [current, , chargeable] = parseCastTuple(feeState.stdout.trim());
  }
  if (unboostedNum === '0' && current === '0' && chargeable === '0') {
    return;
  }
  logInfo('=== Legacy BGT Disposition ===');
  await printWeiField('Unboosted BGT', smartOperator, 'unboostedBalance()(uint256)', rpcUrl, 'BGT');
  await printFeeState('BGT', smartOperator, 'getEarnedBGTFeeState()(uint256,uint256,uint256,uint96)', rpcUrl);
}

async function printWalletHoldings(env, stakingPool, network, rpcUrl) {
  console.log('');
  logInfo('=== Wallet Holdings (PRIVATE_KEY) ===');
  const wallet = runCast(['wallet', 'address', '--private-key', env.PRIVATE_KEY.trim()]);
  if (wallet.status !== 0) {
    logWarn('Could not derive wallet address from PRIVATE_KEY');
    return;
  }
  const walletAddr = wallet.stdout.trim();
  logInfo(`Address: ${walletAddr}`);

  const shares = runCast([
    'call',
    stakingPool,
    'balanceOf(address)(uint256)',
    walletAddr,
    '-r',
    rpcUrl,
  ]);
  const sharesPretty =
    shares.status === 0 ? await castFromWei(stripScientificNotation(shares.stdout)) : '0';
  logInfo(`stBERA Shares: ${sharesPretty}`);

  const withdrawalVault = getWithdrawalVault(network, env);
  const nftCount = runCast([
    'call',
    withdrawalVault,
    'balanceOf(address)(uint256)',
    walletAddr,
    '-r',
    rpcUrl,
  ]);
  const count = nftCount.status === 0 ? stripScientificNotation(nftCount.stdout) : '0';
  logInfo(`Withdrawal NFTs: ${count}`);
}
