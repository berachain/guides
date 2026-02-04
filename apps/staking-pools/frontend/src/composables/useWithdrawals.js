import { ref } from 'vue'
import { formatEther, parseEther } from 'viem'
import { WITHDRAWAL_VAULT_ABI, STAKING_POOL_ABI } from '../utils/abis.js'

export function useWithdrawals(publicClient, walletClient, withdrawalVaultAddress, poolAddress, account) {
  const isLoading = ref(false)
  const error = ref(null)
  
  // User's withdrawal requests (NFTs)
  const withdrawalRequests = ref([])
  const pendingCount = ref(0)
  
  // Finalization delay (blocks)
  const FINALIZATION_DELAY = 7200 // ~24 hours at 12s blocks

  async function loadWithdrawalRequests() {
    if (!publicClient.value || !withdrawalVaultAddress.value || !account.value) {
      withdrawalRequests.value = []
      return
    }
    
    try {
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
        
        const readyBlock = request.requestBlock + BigInt(FINALIZATION_DELAY)
        const isReady = currentBlock >= readyBlock
        const blocksRemaining = isReady ? 0n : readyBlock - currentBlock
        
        requests.push({
          id: tokenId,
          pubkey: request.pubkey,
          assetsRequested: request.assetsRequested,
          sharesBurnt: request.sharesBurnt,
          user: request.user,
          requestBlock: request.requestBlock,
          isReady,
          blocksRemaining: Number(blocksRemaining),
          estimatedTimeRemaining: Number(blocksRemaining) * 12 // seconds
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
      // First, approve the withdrawal vault to spend shares
      const currentAllowance = await publicClient.value.readContract({
        address: poolAddress.value,
        abi: STAKING_POOL_ABI,
        functionName: 'allowance',
        args: [account.value, withdrawalVaultAddress.value]
      })
      
      if (currentAllowance < shares) {
        const approveHash = await walletClient.value.writeContract({
          address: poolAddress.value,
          abi: STAKING_POOL_ABI,
          functionName: 'approve',
          args: [withdrawalVaultAddress.value, shares],
          account: account.value
        })
        await publicClient.value.waitForTransactionReceipt({ hash: approveHash })
      }
      
      // Request the redeem
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
    return parseFloat(formatEther(assets)).toFixed(4)
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
    loadWithdrawalRequests,
    requestRedeem,
    finalizeWithdrawal,
    finalizeMultiple,
    formatAssets,
    formatTimeRemaining
  }
}
