export const STAKING_POOL_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
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

export const WITHDRAWAL_VAULT_ABI = [
  // ERC721 enumerable
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'tokenOfOwnerByIndex', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  // Withdrawal operations
  { name: 'requestWithdrawal', type: 'function', stateMutability: 'payable', inputs: [{ name: 'pubkey', type: 'bytes' }, { name: 'assetsInGWei', type: 'uint64' }, { name: 'maxFeeToPay', type: 'uint256' }], outputs: [{ name: 'requestId', type: 'uint256' }] },
  { name: 'requestRedeem', type: 'function', stateMutability: 'payable', inputs: [{ name: 'pubkey', type: 'bytes' }, { name: 'shares', type: 'uint256' }, { name: 'maxFeeToPay', type: 'uint256' }], outputs: [{ name: 'requestId', type: 'uint256' }] },
  { name: 'finalizeWithdrawalRequest', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'requestId', type: 'uint256' }], outputs: [] },
  { name: 'finalizeWithdrawalRequests', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'requestIds', type: 'uint256[]' }], outputs: [] },
  { name: 'getWithdrawalRequest', type: 'function', stateMutability: 'view', inputs: [{ name: 'requestId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'pubkey', type: 'bytes' }, { name: 'assetsRequested', type: 'uint256' }, { name: 'sharesBurnt', type: 'uint256' }, { name: 'user', type: 'address' }, { name: 'requestBlock', type: 'uint256' }] }] }
]

export const DELEGATION_HANDLER_ABI = [
  { name: 'stakingPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'delegatedAmount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
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
