import { ethers } from './ethers-bundle.mjs';

export const RECEIPT_EVENT_ABIS = {
  deploy:
    'event StakingPoolContractsDeployed(address smartOperator, address stakingPool, address stakingRewardsVault, address incentiveCollector)',
  activate: 'event StakingPoolActivated(address stakingPool)',
  stake:
    'event DepositSubmitted(address indexed receiver, uint256 userDepositAmount, uint256 shares, uint256 rewardsCollected, uint256 bufferedAssets, uint256 totalDeposits)',
  'unstake.requestWithdrawal':
    'event WithdrawalRequested(address indexed user, uint256 amountOfAsset, uint256 amountOfShares, uint256 requestId, bool isFullExitWithdraw)',
  'unstake.requestRedeem':
    'event WithdrawalRequested(address indexed user, uint256 amountOfAsset, uint256 amountOfShares, uint256 requestId, bool isFullExitWithdraw)',
  'unstake.finalizeWithdrawalRequest': 'event WithdrawalRequestFinalized(uint256 requestId)',
  'set-min-balance': 'event MinEffectiveBalanceUpdated(uint256 newMinEffectiveBalance)',
};

export function eventTopic(eventAbi) {
  const iface = new ethers.Interface([eventAbi]);
  return iface.fragments[0].topicHash;
}

export async function recentFromBlock(chainReader, lookback = 256n) {
  const latest = BigInt(await chainReader.getBlockNumber());
  const from = latest > lookback ? latest - lookback : 0n;
  return ethers.toBeHex(from);
}

/** Inclusive eth_getLogs start that excludes events already in the current head. */
export async function exclusiveFromBlock(chainReader) {
  const latest = BigInt(await chainReader.getBlockNumber());
  return ethers.toBeHex(latest + 1n);
}

export async function recoverTxHash(chainReader, { address, eventAbi, fromBlock, toBlock = 'latest' }) {
  const topic = eventTopic(eventAbi);
  const fromTag =
    typeof fromBlock === 'string' && fromBlock.startsWith('0x')
      ? fromBlock
      : ethers.toBeHex(BigInt(fromBlock ?? 0));
  const logs = await chainReader.getLogs({
    address,
    topics: [topic],
    fromBlock: fromTag,
    toBlock,
  });
  if (!Array.isArray(logs) || logs.length === 0) {
    throw new Error(
      `Could not recover transaction hash: no matching logs for ${eventAbi} at ${address}`,
    );
  }
  return logs[logs.length - 1].transactionHash;
}
