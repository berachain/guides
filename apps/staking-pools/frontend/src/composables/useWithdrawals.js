import { ref } from 'vue'
import { formatEther, parseEther } from 'viem'
import { WITHDRAWAL_VAULT_ABI } from '../utils/abis.js'
import { formatBeraDisplay } from '../utils/format.js'

export function useWithdrawals(publicClient, walletClient, withdrawalVaultAddress, poolAddress, validatorPubkey, account) {
  const isLoading = ref(false)
  const error = ref(null)
  
  // User's withdrawal requests (NFTs)
  const withdrawalRequests = ref([])
  const pendingCount = ref(0)
  
  // Finalization delay (blocks). Prefer reading from the contract; fall back to a
  // contract getter. Do not hardcode: query WithdrawalVault each time per network.
  const finalizationDelayBlocks = ref(null)
  let lastDelayVault = null
  const SECONDS_PER_BLOCK = 2 // berachain assumed 2s block time for UX math

  async function loadFinalizationDelay() {
    const client = publicClient?.value || publicClient
    const vault = withdrawalVaultAddress?.value
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
      
      const targetPubkey = (validatorPubkey?.value || validatorPubkey || '').toLowerCase()

      // Enumerate all tokens owned by user
      const requests = []
      for (let i = 0n; i < balance; i++) {
        const tokenId = await publicClient.value.readContract({
          address: withdrawalVaultAddress.value,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [account.value, i]
        })
        
        const request = await publicClient.value.readContract({
          address: withdrawalVaultAddress.value,
          abi: WITHDRAWAL_VAULT_ABI,
          functionName: 'getWithdrawalRequest',
          args: [tokenId]
        })

        if (targetPubkey && request.pubkey?.toLowerCase() !== targetPubkey) {
          continue
        }

        const readyBlock = typeof delayBlocks === 'bigint' ? (request.requestBlock + delayBlocks) : null
        const isReady = readyBlock ? currentBlock >= readyBlock : false
        const blocksRemaining = readyBlock ? (isReady ? 0n : readyBlock - currentBlock) : null
        
        requests.push({
          id: tokenId,
          pubkey: request.pubkey,
          assetsRequested: request.assetsRequested,
          sharesBurnt: request.sharesBurnt,
          user: request.user,
          requestBlock: request.requestBlock,
          isReady,
          blocksRemaining: blocksRemaining === null ? null : Number(blocksRemaining),
          estimatedTimeRemaining: blocksRemaining === null ? null : Number(blocksRemaining) * SECONDS_PER_BLOCK // seconds
        })
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
    
    isLoading.value = true
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
      isLoading.value = false
    }
  }

  async function finalizeWithdrawal(requestId) {
    if (!walletClient.value || !withdrawalVaultAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isLoading.value = true
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
      isLoading.value = false
    }
  }

  async function finalizeMultiple(requestIds) {
    if (!walletClient.value || !withdrawalVaultAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    if (requestIds.length === 0) {
      throw new Error('No requests to finalize')
    }
    
    isLoading.value = true
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
      isLoading.value = false
    }
  }

  function formatAssets(assets) {
    const s = formatEther(assets)
    return formatBeraDisplay(s, { decimals: 4 }) || '0.0000'
  }

  function formatTimeRemaining(seconds) {
    if (seconds <= 0) return 'Ready'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) return `~${hours}h ${minutes}m`
    return `~${minutes}m`
  }

  return {
    isLoading,
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
