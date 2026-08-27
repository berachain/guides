import { BEACON_DEPOSIT_CONTRACT } from '../constants.mjs';
import {
  getDelegationHandlerFactory,
  getFactoryAddress,
  resolveRpcUrl,
} from '../config.mjs';
import {
  detectNetwork,
  getValidatorPubkey,
  getWithdrawalVault,
  predictPoolAddresses,
} from '../beacond.mjs';
import { runCast, parseCastTuple, castFromWei, stripScientificNotation } from '../cast.mjs';
import { logInfo, logSuccess, logWarn, logError } from '../log.mjs';

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

  const core = runCast([
    'call',
    factory,
    'getCoreContracts(bytes)(address,address,address,address)',
    pubkey,
    '-r',
    rpcUrl,
  ]);
  if (core.status !== 0) {
    throw new Error('Failed to get core contracts — pool may not be deployed yet');
  }

  const [smartOperator, stakingPool, stakingRewardsVault, incentiveCollector] =
    parseCastTuple(core.stdout.trim());
  if (smartOperator === '0x0000000000000000000000000000000000000000') {
    throw new Error('Staking pool has not been deployed yet');
  }

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
  if (registeredOp === smartOperator.toLowerCase()) {
    logInfo(`✓ Validator operator correctly registered: ${registeredOp}`);
  } else {
    throw new Error(
      `Operator mismatch. Expected ${smartOperator}, registered ${registeredOp}`,
    );
  }
  console.log('');

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

  if (fullyExited.status === 0 && fullyExited.stdout.trim() === 'true') {
    logInfo('✓ Staking pool is FULLY EXITED');
  } else if (isActive.status === 0 && isActive.stdout.trim() === 'true') {
    logInfo('✓ Staking pool is ACTIVE');
  } else {
    logInfo('⚠ Staking pool is NOT ACTIVE yet');
    logInfo('  Run activate to activate the pool with validator proofs');
    return { active: false };
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

  return { active: true, stakingPool, smartOperator };
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
