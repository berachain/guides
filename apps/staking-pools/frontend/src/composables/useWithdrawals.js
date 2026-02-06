import { ref, toValue } from 'vue'
import { parseEther } from 'viem'
import { WITHDRAWAL_VAULT_ABI } from '../utils/abis.js'
import { formatAssets, formatTimeRemaining } from '../utils/format.js'
import { getChainConstants } from '../constants/chains.js'
import { SECONDS_PER_BLOCK } from '../constants/thresholds.js'

async function fetchValidatorNamesByPubkeys(chainId, pubkeys) {
  const chain = getChainConstants(chainId)
  if (!chain?.graphqlEndpoint || !chain?.chainEnum || !pubkeys?.length) return new Map()
  const normalized = pubkeys.map(pk => (pk?.startsWith('0x') ? pk : `0x${pk || ''}`))
  try {
    const res = await fetch(chain.graphqlEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query GetValidators($chain: GqlChain!, $pubkeys: [String!]!) { polGetValidators(chain: $chain, where: { pubkeyIn: $pubkeys }) { validators { pubkey metadata { name } } } }`,
        variables: { chain: chain.chainEnum, pubkeys: normalized }
      })
    })
    if (!res.ok) return new Map()
    const json = await res.json()
    const list = json.data?.polGetValidators?.validators || []
    const map = new Map()
    for (const v of list) {
      const key = v.pubkey?.toLowerCase()
      if (key) map.set(key, { name: v.metadata?.name ?? null, metadata: v.metadata ?? null })
    }
    return map
  } catch {
    return new Map()
  }
}

export function useWithdrawals(publicClient, walletClient, withdrawalVaultAddress, poolAddress, validatorPubkey, account, chainId = null) {
  const isTxPending = ref(false)
  const error = ref(null)
  
  // User's withdrawal requests (NFTs)
  const withdrawalRequests = ref([])
  const pendingCount = ref(0)
  
  // Finalization delay (blocks). Prefer reading from the contract; fall back to a
  // contract getter. Do not hardcode: query WithdrawalVault each time per network.
  const finalizationDelayBlocks = ref(null)
  let lastDelayVault = null
  async function loadFinalizationDelay() {
    const client = toValue(publicClient)
    const vault = toValue(withdrawalVaultAddress)
    if (!client || !vault) {
      finalizationDelayBlocks.value = null
      lastDelayVault = null
      return
    }

    if (lastDelayVault === vault && finalizationDelayBlocks.value !== null) return

    lastDelayVault = vault
    finalizationDelayBlocks.value = null

    try {
      const abi = [
        {
          name: 'WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'uint256' }]
        }
      ]
      const v = await client.readContract({
        address: vault,
        abi,
        functionName: 'WITHDRAWAL_REQUEST_FINALIZATION_BLOCK_DELAY'
      })
      finalizationDelayBlocks.value = typeof v === 'bigint' && v > 0n ? v : null
    } catch (err) {
      console.warn('Could not read withdrawal finalization delay from contract:', err)
      finalizationDelayBlocks.value = null
    }
  }

  async function loadWithdrawalRequests() {
    if (!publicClient.value || !withdrawalVaultAddress.value || !account.value) {
      withdrawalRequests.value = []
      return
    }
    
    try {
      await loadFinalizationDelay()
      const delayBlocks = finalizationDelayBlocks.value

      // Get user's NFT balance (number of withdrawal requests)
      const balance = await publicClient.value.readContract({
        address: withdrawalVaultAddress.value,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'balanceOf',
        args: [account.value]
      })
      
      if (balance === 0n) {
        withdrawalRequests.value = []
        pendingCount.value = 0
        return
      }
      
      // Get current block for status calculation
      const currentBlock = await publicClient.value.getBlockNumber()
      
      const targetPubkey = (toValue(validatorPubkey) || '').toLowerCase()

      // Enumerate all tokens owned by user (multicall)
      const tokenCalls = []
      for (let i = 0n; i < balance; i++) {
        tokenCalls.push({
          address: withdrawalVaultAddress.value,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [account.value, i]
        })
      }

      const tokenResults = await publicClient.value.multicall({
        contracts: tokenCalls,
        allowFailure: true
      })

      const tokenIds = tokenResults
        .map((res) => res?.result)
        .filter((tokenId) => typeof tokenId === 'bigint')

      if (tokenIds.length === 0) {
        withdrawalRequests.value = []
        pendingCount.value = 0
        return
      }

      const requestCalls = tokenIds.map((tokenId) => ({
        address: withdrawalVaultAddress.value,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'getWithdrawalRequest',
        args: [tokenId]
      }))

      const requestResults = await publicClient.value.multicall({
        contracts: requestCalls,
        allowFailure: true
      })

      const requests = []
      for (let i = 0; i < tokenIds.length; i++) {
        const request = requestResults[i]?.result
        if (!request) continue

        if (targetPubkey && request.pubkey?.toLowerCase() !== targetPubkey) {
          continue
        }

        const readyBlock = typeof delayBlocks === 'bigint' ? (request.requestBlock + delayBlocks) : null
        const isReady = readyBlock ? currentBlock >= readyBlock : false
        const blocksRemaining = readyBlock ? (isReady ? 0n : readyBlock - currentBlock) : null

        requests.push({
          id: tokenIds[i],
          pubkey: request.pubkey,
          assetsRequested: request.assetsRequested,
          sharesBurnt: request.sharesBurnt,
          user: request.user,
          requestBlock: request.requestBlock,
          isReady,
          blocksRemaining: blocksRemaining === null ? null : Number(blocksRemaining),
          estimatedTimeRemaining: blocksRemaining === null ? null : Number(blocksRemaining) * SECONDS_PER_BLOCK, // seconds
          validatorName: null // Will be enriched below
        })
      }
      
      // Enrich with validator names from GraphQL API
      try {
        const chain = toValue(chainId)
        if (chain && requests.length > 0) {
          const uniquePubkeys = [...new Set(requests.map(r => r.pubkey))]
          const validatorMap = await fetchValidatorNamesByPubkeys(chain, uniquePubkeys)
          
          for (const request of requests) {
            const normalizedPubkey = request.pubkey?.toLowerCase()
            const validatorData = validatorMap.get(normalizedPubkey)
            if (validatorData?.name) {
              request.validatorName = validatorData.name
            }
          }
        }
      } catch (err) {
        console.warn('Failed to enrich with validator names:', err)
        // Continue without validator names
      }
      
      withdrawalRequests.value = requests
      pendingCount.value = requests.filter(r => !r.isReady).length
    } catch (err) {
      console.error('Failed to load withdrawal requests:', err)
      error.value = 'Failed to load withdrawal requests'
    }
  }

  async function requestRedeem(shares, pubkey, maxFee = parseEther('0.01')) {
    if (!walletClient.value || !withdrawalVaultAddress.value || !poolAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isTxPending.value = true
    error.value = null
    
    try {
      // No approve needed: WithdrawalVault calls StakingPool.notifyWithdrawalRequest(user, amountInWei),
      // and the pool burns the user's shares directly (only callable by the vault). StBERA allowances are unused.
      const hash = await walletClient.value.writeContract({
        address: withdrawalVaultAddress.value,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'requestRedeem',
        args: [pubkey, shares, maxFee],
        value: maxFee,
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Reload withdrawal requests
      await loadWithdrawalRequests()
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Request redeem failed'
      throw err
    } finally {
      isTxPending.value = false
    }
  }

  async function finalizeWithdrawal(requestId) {
    if (!walletClient.value || !withdrawalVaultAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isTxPending.value = true
    error.value = null
    
    try {
      const hash = await walletClient.value.writeContract({
        address: withdrawalVaultAddress.value,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'finalizeWithdrawalRequest',
        args: [requestId],
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Reload withdrawal requests
      await loadWithdrawalRequests()
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Finalize withdrawal failed'
      throw err
    } finally {
      isTxPending.value = false
    }
  }

  async function finalizeMultiple(requestIds) {
    if (!walletClient.value || !withdrawalVaultAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    if (requestIds.length === 0) {
      throw new Error('No requests to finalize')
    }
    
    isTxPending.value = true
    error.value = null
    
    try {
      const hash = await walletClient.value.writeContract({
        address: withdrawalVaultAddress.value,
        abi: WITHDRAWAL_VAULT_ABI,
        functionName: 'finalizeWithdrawalRequests',
        args: [requestIds],
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Reload withdrawal requests
      await loadWithdrawalRequests()
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Finalize withdrawals failed'
      throw err
    } finally {
      isTxPending.value = false
    }
  }

  return {
    isTxPending,
    error,
    withdrawalRequests,
    pendingCount,
    finalizationDelayBlocks,
    SECONDS_PER_BLOCK,
    loadWithdrawalRequests,
    requestRedeem,
    finalizeWithdrawal,
    finalizeMultiple,
    formatAssets,
    formatTimeRemaining
  }
}
