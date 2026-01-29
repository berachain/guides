export const STAKING_POOL_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalAssets', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'isActive', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'isFullyExited', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'activeThresholdReached', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'convertToShares', type: 'function', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'submit', type: 'function', stateMutability: 'payable', inputs: [{ name: 'receiver', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }
]

export const WITHDRAWAL_VAULT_ABI = [
  // ERC721 Enumerable surface needed to enumerate user's withdrawal request NFTs
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [
      { name: 'owner', type: 'address' }
    ], outputs: [ { name: '', type: 'uint256' } ] },
  { name: 'tokenOfOwnerByIndex', type: 'function', stateMutability: 'view', inputs: [
      { name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }
    ], outputs: [ { name: '', type: 'uint256' } ] },
  { name: 'requestWithdrawal', type: 'function', stateMutability: 'payable', inputs: [
      { name: 'pubkey', type: 'bytes' },
      { name: 'assetsInGWei', type: 'uint64' },
      { name: 'maxFeeToPay', type: 'uint256' }
    ], outputs: [] },
  { name: 'requestRedeem', type: 'function', stateMutability: 'payable', inputs: [
      { name: 'pubkey', type: 'bytes' },
      { name: 'shares', type: 'uint256' },
      { name: 'maxFeeToPay', type: 'uint256' }
    ], outputs: [] },
  { name: 'finalizeWithdrawalRequest', type: 'function', stateMutability: 'nonpayable', inputs: [
      { name: 'requestId', type: 'uint256' }
    ], outputs: [] },
  { name: 'getWithdrawalRequest', type: 'function', stateMutability: 'view', inputs: [
      { name: 'requestId', type: 'uint256' }
    ], outputs: [
      { name: '', type: 'tuple', components: [
        { name: 'pubkey', type: 'bytes' },
        { name: 'assetsRequested', type: 'uint256' },
        { name: 'sharesBurnt', type: 'uint256' },
        { name: 'user', type: 'address' },
        { name: 'requestBlock', type: 'uint256' }
      ] }
    ] },
  { type: 'event', name: 'WithdrawalRequested', inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amountOfAsset', type: 'uint256', indexed: false },
      { name: 'amountOfShares', type: 'uint256', indexed: false },
      { name: 'requestId', type: 'uint256', indexed: false },
      { name: 'isFullExitWithdraw', type: 'bool', indexed: false }
    ], anonymous: false },
  { type: 'event', name: 'WithdrawalRequestFinalized', inputs: [
      { name: 'requestId', type: 'uint256', indexed: false }
    ], anonymous: false }
]


