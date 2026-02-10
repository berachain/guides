/**
 * Pool test scenarios based on live bepolia pool data
 * Historical data, embedded so we don't ship snapshots.
 */

import { parseEther, encodeAbiParameters, formatEther } from 'viem'
import { createPoolStateMocks } from './mock-wallet-enhanced.js'
import { VALIDATOR_STATUS, isExitedStatus, isActiveStatus } from '../../src/constants/validator-status.js'

// Live bepolia pool addresses from snapshot 2026-01-27
export const BEPOLIA_POOLS = {
  // Normal active pool (validator index 15)
  normal: {
    index: 15,
    pubkey: '0xa6ce5adefe9d089ffd772297d77d147beff8fa8bf3c1b5a6b8ff204fc168a026968278214a8dd1624cb5947bb009d70f',
    stakingPool: '0x15aa5162f4c7915edc209296cd366ebb4658c520',
    smartOperator: '0x06957d41c7accbadc981cf7a28d5e302566999978879',
    status: 'active_ongoing',
    balanceGwei: '302566999978879'
  },
  
  // Exited pool (validator index 21)
  exited: {
    index: 21,
    pubkey: '0xb670c66ba3d2df25a5c3f9ef7150f01c6ba9201fa163ffa5afdef202ebbdfc683066609b3b035c2745dd2998164ae5c9',
    stakingPool: '0x7e25c7ab350a5817f63425aefd98a4e5c51db237',
    smartOperator: '0xfacebb7bb2106295754dd20d7208ca1b023e2431',
    status: 'exited_unslashed',
    balanceGwei: '250000000000000'
  },
  
  // Pending pool (hasn't reached activation threshold) - mock scenario
  pending: {
    index: 99, // Mock index
    pubkey: '0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    stakingPool: '0x0000000000000000000000000000000000000001', // Mock address
    smartOperator: '0x0000000000000000000000000000000000000002',
    status: 'pending_initialized',
    balanceGwei: '100000000000000' // Below activation threshold
  }
}

// Withdrawal vault address (same for all pools)
export const WITHDRAWAL_VAULT = '0xAFAc2f11Cb39F0521b22494F6101002ce653D2f4'

/**
 * Create comprehensive mock wallet scenario for a pool
 * @param {Object} pool - Pool data from BEPOLIA_POOLS
 * @param {Object} userState - User's state (shares, withdrawals, balance)
 * @returns {Object} Mock wallet configuration
 */
export function createPoolScenario(pool, userState = {}) {
  const {
    userShares = '0', // User's stBERA shares
    userBalance = '5000', // User's BERA balance
    withdrawalRequests = [], // Array of withdrawal request objects
    userAddress = null // User address (will be set by test)
  } = userState

  // Calculate pool state from live data
  const totalAssets = parseEther((BigInt(pool.balanceGwei) / BigInt(1e9)).toString()) // Convert gwei to BERA
  const totalSupply = totalAssets * BigInt(95) / BigInt(100) // Assume 95% exchange rate

  // Pool state mocks
  const poolMocks = createPoolStateMocks(pool.stakingPool.toLowerCase(), {
    totalAssets: formatEther(totalAssets),
    totalSupply: formatEther(totalSupply),
    isActive: isActiveStatus(pool.status),
    isFullyExited: isExitedStatus(pool.status),
    userShares,
    userAddress
  })
  
  // For pending pools, override isActive and activeThresholdReached
  if (pool.status === VALIDATOR_STATUS.PENDING_INITIALIZED) {
    const poolAddr = pool.stakingPool.toLowerCase()
    if (poolMocks[poolAddr]) {
      poolMocks[poolAddr].isActive = 0n
      poolMocks[poolAddr].activeThresholdReached = 0n
    }
  }

  // Withdrawal vault mocks
  const withdrawalMocks = createWithdrawalVaultMocks(
    WITHDRAWAL_VAULT,
    pool.stakingPool.toLowerCase(),
    withdrawalRequests,
    userAddress
  )

  return {
    balance: userBalance,
    contractReads: {
      ...poolMocks,
      ...withdrawalMocks
    }
  }
}

/**
 * Create withdrawal vault mocks with ERC721 withdrawal tokens
 * @param {string} vaultAddress - Withdrawal vault address
 * @param {string} poolAddress - Staking pool address (for pubkey)
 * @param {Array} requests - Array of withdrawal request objects
 * @param {string} userAddress - User address
 * @returns {Object} Contract read mocks
 */
function createWithdrawalVaultMocks(vaultAddress, poolAddress, requests, userAddress) {
  const mocks = {
    [vaultAddress.toLowerCase()]: {
      // ERC721: balanceOf returns number of withdrawal requests
      balanceOf: (method, params, context) => {
        const address = extractAddressFromCall(params)
        if (address?.toLowerCase() === userAddress?.toLowerCase()) {
          return BigInt(requests.length)
        }
        return 0n
      },
      
      // ERC721: tokenOfOwnerByIndex returns token ID
      tokenOfOwnerByIndex: (method, params, context) => {
        const address = extractAddressFromCall(params)
        if (address?.toLowerCase() === userAddress?.toLowerCase()) {
          const index = extractUint256FromCall(params, 1) // Second param is index
          if (index < requests.length) {
            const request = requests[Number(index)]
            return BigInt(request.tokenId || Number(index) + 1)
          }
        }
        return 0n
      },
      
      // Get withdrawal request data - returns encoded tuple
      getWithdrawalRequest: (method, params, context) => {
        const tokenId = extractUint256FromCall(params, 0)
        const request = requests.find(r => BigInt(r.tokenId || requests.indexOf(r) + 1) === tokenId)
        
        if (request) {
          // Encode tuple: (bytes pubkey, uint256 assetsRequested, uint256 sharesBurnt, address user, uint256 requestBlock)
          const pubkey = request.pubkey || '0x' + '0'.repeat(98) // 49 bytes
          const assetsRequested = parseEther(request.assetsRequested || '0')
          const sharesBurnt = parseEther(request.sharesBurnt || '0')
          const user = userAddress || '0x' + '0'.repeat(40)
          const requestBlock = BigInt(request.requestBlock || 0)
          
          // Encode as ABI tuple
          const encoded = encodeAbiParameters(
            [
              { name: 'pubkey', type: 'bytes' },
              { name: 'assetsRequested', type: 'uint256' },
              { name: 'sharesBurnt', type: 'uint256' },
              { name: 'user', type: 'address' },
              { name: 'requestBlock', type: 'uint256' }
            ],
            [pubkey, assetsRequested, sharesBurnt, user, requestBlock]
          )
          
          return encoded
        }
        // Return empty tuple if not found
        return encodeAbiParameters(
          [
            { name: 'pubkey', type: 'bytes' },
            { name: 'assetsRequested', type: 'uint256' },
            { name: 'sharesBurnt', type: 'uint256' },
            { name: 'user', type: 'address' },
            { name: 'requestBlock', type: 'uint256' }
          ],
          ['0x' + '0'.repeat(98), 0n, 0n, '0x' + '0'.repeat(40), 0n]
        )
      }
    },
    
    // Mock getBlockNumber for withdrawal readiness calculation
    // This is handled at the RPC level in the enhanced mock wallet
  }

  return mocks
}

/**
 * Extract address from encoded call params
 */
function extractAddressFromCall(params) {
  const callParams = params?.[0]
  const data = callParams?.data || ''
  if (data.length >= 74) {
    return '0x' + data.slice(34, 74) // Address is after 4-byte selector
  }
  return null
}

/**
 * Extract uint256 from encoded call params at position
 */
function extractUint256FromCall(params, position) {
  const callParams = params?.[0]
  const data = callParams?.data || ''
  // Skip selector (10 chars), then each param is 64 chars
  const offset = 10 + (position * 64)
  if (data.length >= offset + 64) {
    return BigInt('0x' + data.slice(offset, offset + 64))
  }
  return 0n
}

/**
 * Pre-configured test scenarios for single pool testing
 * Each scenario represents a different pool state with realistic user data
 */
export const TestPoolScenarios = {
  // Normal active pool with user position and withdrawals
  normalWithPosition: {
    pool: BEPOLIA_POOLS.normal,
    userState: {
      userShares: '1000', // 1000 stBERA
      userBalance: '5000', // 5000 BERA
      withdrawalRequests: [
        {
          tokenId: 1,
          assetsRequested: '100', // 100 BERA
          sharesBurnt: '95', // 95 stBERA
          requestBlock: 15200000, // Old enough to be ready (7200 blocks ago)
          pubkey: BEPOLIA_POOLS.normal.pubkey
        },
        {
          tokenId: 2,
          assetsRequested: '50', // 50 BERA
          sharesBurnt: '47.5', // 47.5 stBERA
          requestBlock: 15340000, // Recent, not ready yet (needs 7200 more blocks)
          pubkey: BEPOLIA_POOLS.normal.pubkey
        }
      ]
    }
  },

  // Exited pool - user can still withdraw but can't stake
  exitedPool: {
    pool: BEPOLIA_POOLS.exited,
    userState: {
      userShares: '500', // 500 stBERA
      userBalance: '1000', // 1000 BERA
      withdrawalRequests: [
        {
          tokenId: 1,
          assetsRequested: '200', // 200 BERA
          sharesBurnt: '190', // 190 stBERA
          requestBlock: 15200000, // Ready to finalize
          pubkey: BEPOLIA_POOLS.exited.pubkey
        }
      ]
    }
  },

  // Pending pool - hasn't reached activation threshold (isActive = false, activeThresholdReached = false)
  pendingPool: {
    pool: BEPOLIA_POOLS.pending,
    userState: {
      userShares: '0', // No shares yet
      userBalance: '10000', // High balance
      withdrawalRequests: []
    }
  },

  // Normal pool with no position (new user)
  normalNoPosition: {
    pool: BEPOLIA_POOLS.normal,
    userState: {
      userShares: '0',
      userBalance: '10000',
      withdrawalRequests: []
    }
  }
}
