/**
 * Enhanced Mock Wallet Helper for Single Pool Testing
 * 
 * Purpose: Enable comprehensive UI testing for single pool frontend
 * Design: Focuses on single pool scenarios (see project decision doc)
 * 
 * Features:
 * - Custom balance mocking
 * - Contract read mocking (for single pool)
 * - Transaction result mocking
 * - Common single pool test scenarios
 */

import { installMockWallet } from '@finn_gal/patchright-wallet-mock-ts'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain, http, custom, formatEther, parseEther, encodeFunctionData, decodeFunctionResult } from 'viem'
import { STAKING_POOL_ABI, WITHDRAWAL_VAULT_ABI } from '../../src/utils/abis.js'

// Define Bepolia chain for testing
export const bepolia = defineChain({
  id: 80069,
  name: 'Bepolia',
  nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
  rpcUrls: { default: { http: ['https://bepolia.rpc.berachain.com'] } },
  blockExplorers: { default: { name: 'Berascan', url: 'https://testnet.berascan.com' } }
})

// Test account private key (well-known test key from Hardhat)
export const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY)

/**
 * Enhanced mock wallet with support for:
 * - Custom balance mocking
 * - Contract read mocking
 * - Transaction result mocking
 * - Common test scenarios
 */
export async function installEnhancedMockWallet({
  page,
  account = TEST_ACCOUNT,
  defaultChain = bepolia,
  mocks = {}
}) {
  const {
    balance = null, // Mock balance in BERA (e.g., '1000')
    contractReads = {}, // Mock contract reads: { '0x...': { 'totalAssets()': '1000000000000000000' } }
    transactionResults = {}, // Mock transaction results: { 'submit': '0x...' }
    autoApprove = true, // Auto-approve all transactions
  } = mocks

  // Create custom transport that intercepts and mocks specific calls
  const customTransport = custom({
    request: async ({ method, params }) => {
      // Mock balance if provided
      if (method === 'eth_getBalance' && balance !== null) {
        const address = params?.[0]
        if (address?.toLowerCase() === account.address.toLowerCase()) {
          return parseEther(balance)
        }
      }

      // Mock current block number for withdrawal readiness calculation
      if (method === 'eth_blockNumber') {
        // Return a high block number so withdrawal requests can be ready
        return '0xe9c4e0' // ~15350000 in hex
      }

      // Mock contract reads if provided
      if (method === 'eth_call') {
        const [callParams] = params || []
        const contractAddress = callParams?.to?.toLowerCase()
        const data = callParams?.data

        if (contractAddress && data && contractAddress in contractReads) {
          const contractMocks = contractReads[contractAddress]
          
          // Try to match the function call by function selector
          for (const [functionName, mockValue] of Object.entries(contractMocks)) {
            try {
              // Encode function to get selector (first 4 bytes)
              const abi = [...STAKING_POOL_ABI, ...WITHDRAWAL_VAULT_ABI]
              const encoded = encodeFunctionData({
                abi,
                functionName,
                args: []
              })
              const selector = encoded.slice(0, 10) // 0x + 4 bytes
              
              // Check if call data starts with this selector
              if (data.toLowerCase().startsWith(selector.toLowerCase())) {
                if (typeof mockValue === 'function') {
                  // Call the mock function with context
                  const result = await mockValue(method, params, { abi, functionName, data })
                  if (result !== undefined) {
                    // Ensure result is hex string
                    return typeof result === 'string' && result.startsWith('0x') 
                      ? result 
                      : `0x${BigInt(result).toString(16).padStart(64, '0')}`
                  }
                } else {
                  // Return encoded value
                  // If it's already hex, return as-is
                  if (typeof mockValue === 'string' && mockValue.startsWith('0x')) {
                    return mockValue
                  }
                  // Otherwise encode as uint256
                  const value = typeof mockValue === 'bigint' ? mockValue : parseEther(mockValue.toString())
                  return `0x${value.toString(16).padStart(64, '0')}`
                }
              }
            } catch (err) {
              // Function not in ABI or encoding failed, continue to next
              continue
            }
          }
        }
      }

      // Mock transaction results if provided
      if (method === 'eth_sendTransaction' && transactionResults) {
        const [txParams] = params || []
        const data = txParams?.data || ''
        
        // Check if we have a mock for this transaction type
        for (const [txType, mockHash] of Object.entries(transactionResults)) {
          // Simple matching - in production you'd decode the function selector
          if (typeof mockHash === 'function') {
            const result = await mockHash(method, params)
            if (result !== undefined) return result
          } else if (data.includes(txType) || txType === 'default') {
            return mockHash
          }
        }
      }

      // Pass through to real RPC for everything else
      return await http()({ method, params })
    }
  })

  // Install the mock wallet with custom transport
  await installMockWallet({
    page,
    account,
    defaultChain,
    transports: { [defaultChain.id]: customTransport }
  })
}

/**
 * Helper to create contract read mocks
 * @param {string} address - Contract address
 * @param {Object} reads - Object mapping function names to return values
 *   Example: { 'totalAssets': '1000000000000000000', 'balanceOf': (method, params) => '500000000000000000' }
 * @returns {Object} Contract read mocks object
 */
export function createContractReadMocks(address, reads) {
  return {
    [address.toLowerCase()]: reads
  }
}

/**
 * Helper to create pool state mocks
 * @param {string} poolAddress - Staking pool address
 * @param {Object} state - Pool state values
 * @returns {Object} Contract read mocks for the pool
 */
export function createPoolStateMocks(poolAddress, state = {}) {
  const {
    totalAssets = '1000', // Total assets in BERA
    totalSupply = '950', // Total supply in stBERA
    isActive = true,
    isFullyExited = false,
    userShares = '0', // User's stBERA shares
    userAddress = null // User address for balanceOf calls
  } = state

  return createContractReadMocks(poolAddress, {
    totalAssets: parseEther(totalAssets),
    totalSupply: parseEther(totalSupply),
    isActive: isActive ? 1n : 0n,
    isFullyExited: isFullyExited ? 1n : 0n,
    activeThresholdReached: isActive ? 1n : 0n, // Active pools have reached threshold
    balanceOf: (method, params, context) => {
      // Extract address from call params (encoded in data after selector)
      const callParams = params?.[0]
      const data = callParams?.data || ''
      // Address is encoded after 4-byte selector (10 chars = 0x + 4 bytes)
      const address = '0x' + data.slice(34, 74) // Extract 20-byte address
      if (userAddress && address?.toLowerCase() === userAddress.toLowerCase()) {
        return parseEther(userShares)
      }
      return parseEther(userShares) // Default to user shares
    },
    previewDeposit: (method, params, context) => {
      // Simple mock: return shares proportional to assets
      const assets = BigInt(totalAssets)
      const supply = BigInt(totalSupply)
      if (supply === 0n) return parseEther('0')
      // Simplified 1:1 for testing (adjust as needed)
      return parseEther(totalAssets)
    }
  })
}

/**
 * Common test scenarios
 */
export const TestScenarios = {
  // User with high balance
  highBalance: {
    balance: '10000'
  },

  // User with low balance (just enough for gas)
  lowBalance: {
    balance: '0.1'
  },

  // User with existing stake position
  withStake: {
    balance: '5000',
    contractReads: {
      // Mock user shares in staking pool
      // This would need the actual pool address and function selector
    }
  },

  // User with pending withdrawals
  withWithdrawals: {
    balance: '1000',
    // Mock withdrawal requests
  }
}

/**
 * Helper to wait for wallet connection
 */
export async function waitForWalletConnection(page, timeout = 10000) {
  await page.waitForFunction(
    () => window.ethereum?.isConnected?.() || document.querySelector('.address'),
    { timeout }
  )
}

/**
 * Helper to connect wallet in tests
 */
export async function connectWallet(page) {
  await page.locator('header button:has-text("Connect Wallet")').first().click()
  await waitForWalletConnection(page)
}

/**
 * Helper to get wallet address from page
 */
export async function getWalletAddress(page) {
  const addressElement = await page.locator('header .address').first()
  return await addressElement.textContent()
}
