import { toEventHash, toFunctionSelector } from 'viem'

export const STAKING_POOL_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'bufferedAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalDeposits', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'minEffectiveBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'paused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'isActive', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'isFullyExited', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'activeThresholdReached', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'convertToShares', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'previewDeposit', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'previewRedeem', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'submit', type: 'function', stateMutability: 'payable', inputs: [{ name: 'receiver', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }
]

/** Minimal ERC20 for balanceOf. Incentive tokens are plain ERC20s; no extensions needed. */
export const ERC20_BALANCE_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }
]

/** ERC20 name/symbol for incentive token display. */
export const ERC20_NAME_SYMBOL_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] }
]

export const WITHDRAWAL_VAULT_ABI = [
  // ERC721 enumerable
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'tokenOfOwnerByIndex', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  // Withdrawal view + operations
  { name: 'allocatedWithdrawalsAmount', type: 'function', stateMutability: 'view', inputs: [{ name: 'pubkey', type: 'bytes' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getWithdrawalRequestFee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'paused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'requestWithdrawal', type: 'function', stateMutability: 'payable', inputs: [{ name: 'pubkey', type: 'bytes' }, { name: 'assetsInGWei', type: 'uint64' }, { name: 'maxFeeToPay', type: 'uint256' }], outputs: [{ name: 'requestId', type: 'uint256' }] },
  { name: 'requestRedeem', type: 'function', stateMutability: 'payable', inputs: [{ name: 'pubkey', type: 'bytes' }, { name: 'shares', type: 'uint256' }, { name: 'maxFeeToPay', type: 'uint256' }], outputs: [{ name: 'requestId', type: 'uint256' }] },
  { name: 'finalizeWithdrawalRequest', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'requestId', type: 'uint256' }], outputs: [] },
  { name: 'finalizeWithdrawalRequests', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'requestIds', type: 'uint256[]' }], outputs: [] },
  { name: 'getWithdrawalRequest', type: 'function', stateMutability: 'view', inputs: [{ name: 'requestId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'pubkey', type: 'bytes' }, { name: 'assetsRequested', type: 'uint256' }, { name: 'sharesBurnt', type: 'uint256' }, { name: 'user', type: 'address' }, { name: 'requestBlock', type: 'uint256' }] }] }
]

export const DELEGATION_HANDLER_ABI = [
  { name: 'stakingPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'delegatedAmount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'delegatedAmountAvailable', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'delegatedFundsPendingWithdrawal', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'delegate', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'undelegate', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [] },
  { name: 'depositDelegatedFunds', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'requestDelegatedFundsWithdrawal', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  { name: 'requestYieldWithdrawal', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  { name: 'completeWithdrawal', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'requestId', type: 'uint256' }], outputs: [] }
]

export const DELEGATION_HANDLER_FACTORY_ABI = [
  { name: 'delegationHandlers', type: 'function', stateMutability: 'view', inputs: [{ name: 'pubkey', type: 'bytes' }], outputs: [{ name: '', type: 'address' }] }
]

export const INCENTIVE_COLLECTOR_ABI = [
  { name: 'payoutAmount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'queuedPayoutAmount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'feePercentage', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint96' }] }
]

/** SmartOperator view functions for Nosy real-time metrics. */
export const SMART_OPERATOR_ABI = [
  { name: 'protocolFeePercentage', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint96' }] },
  { name: 'rebaseableBgtAmount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'unboostedBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getEarnedBGTFeeState', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'currentBalance', type: 'uint256' }, { name: 'bgtBalanceAlreadyCharged', type: 'uint256' }, { name: 'chargeableBalance', type: 'uint256' }, { name: 'protocolFeePercentage', type: 'uint96' }] }
]

export const STAKING_POOL_FACTORY_ABI = [
  { 
    name: 'getCoreContracts', 
    type: 'function', 
    stateMutability: 'view', 
    inputs: [{ name: 'pubkey', type: 'bytes' }], 
    outputs: [
      { name: 'smartOperator', type: 'address' },
      { name: 'stakingPool', type: 'address' },
      { name: 'stakingRewardsVault', type: 'address' },
      { name: 'incentiveCollector', type: 'address' }
    ] 
  },
  { 
    name: 'withdrawalVault', 
    type: 'function', 
    stateMutability: 'view', 
    inputs: [], 
    outputs: [{ name: '', type: 'address' }] 
  }
]

/** IncentiveTokenClaimed(from, token, amount) — for on-chain discovery of incentive token addresses. */
export const INCENTIVE_TOKEN_CLAIMED_ABI = [
  { type: 'event', name: 'IncentiveTokenClaimed', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] }
]

/**
 * Event ABIs for Nosy Mode historical scan (getLogs).
 * Address set for getLogs must be exactly the contracts that emit these events, resolved from
 * StakingPoolFactory.getCoreContracts(validatorPubkey) + factory.withdrawalVault():
 *   - StakingPool (core.stakingPool): DepositSubmitted, Transfer, StakingPoolActivated, StakingRewardsReceived, TotalDepositsUpdated
 *   - WithdrawalVault (factory.withdrawalVault()): WithdrawalRequested, WithdrawalRequestFinalized
 *   - SmartOperator (core.smartOperator): BGTRedeemed
 * StakingRewardsVault and IncentiveCollector do not emit events we scan.
 * Verify signatures against vendor/contracts-staking-pools when available (see project/briefs/staking-pool-nosy-mode.md).
 */
export const NOSY_EVENTS_ABI = [
  { type: 'event', name: 'Initialized', inputs: [{ name: 'version', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'SharesMinted', inputs: [{ name: 'to', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'SharesBurned', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'DepositSubmitted', inputs: [{ name: 'receiver', type: 'address', indexed: true }, { name: 'userDepositAmount', type: 'uint256', indexed: false }, { name: 'shares', type: 'uint256', indexed: false }, { name: 'rewardsCollected', type: 'uint256', indexed: false }, { name: 'bufferedAssets', type: 'uint256', indexed: false }, { name: 'totalDeposits', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'WithdrawalRequested', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amountOfAsset', type: 'uint256', indexed: false }, { name: 'amountOfShares', type: 'uint256', indexed: false }, { name: 'requestId', type: 'uint256', indexed: false }, { name: 'isFullExitWithdraw', type: 'bool', indexed: false }] },
  { type: 'event', name: 'WithdrawalRequestFinalized', inputs: [{ name: 'requestId', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'StakingPoolActivated', inputs: [] },
  { type: 'event', name: 'StakingPoolContractsDeployed', inputs: [{ name: 'smartOperator', type: 'address', indexed: false }, { name: 'stakingPool', type: 'address', indexed: false }, { name: 'stakingRewardsVault', type: 'address', indexed: false }, { name: 'incentiveCollector', type: 'address', indexed: false }] },
  { type: 'event', name: 'BGTRedeemed', inputs: [{ name: 'receiver', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'StakingRewardsReceived', inputs: [{ name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'TotalDepositsUpdated', inputs: [{ name: 'newTotalDeposits', type: 'uint256', indexed: false }] }
]

/** Event topic0 (keccak256 of canonical event signature), derived from NOSY_EVENTS_ABI. */
export const NOSY_EVENT_TOPICS = Object.fromEntries(
  NOSY_EVENTS_ABI.map((e) => [e.name, toEventHash(e)])
)

/** Function selectors (first 4 bytes of keccak256 of canonical function signature), derived from factory ABI. */
export const STAKING_POOL_FACTORY_SELECTORS = Object.fromEntries(
  STAKING_POOL_FACTORY_ABI.filter((e) => e.type === 'function').map((e) => [e.name, toFunctionSelector(e)])
)
