import { ref, computed } from 'vue'
import { formatEther, parseEther } from 'viem'
import { STAKING_POOL_ABI, DELEGATION_HANDLER_ABI, INCENTIVE_COLLECTOR_ABI } from '../utils/abis.js'

export function useStakingPool(publicClient, walletClient, poolAddress, account, delegationHandlerAddress, incentiveCollectorAddress) {
  const isLoading = ref(false)
  const error = ref(null)
  
  // Pool state
  const totalAssets = ref(0n)
  const totalSupply = ref(0n)
  const isActive = ref(false)
  const isFullyExited = ref(false)
  const activeThresholdReached = ref(false)
  
  // User state
  const userShares = ref(0n)
  const userAssets = ref(0n)
  
  // Delegation state
  const totalDelegation = ref(0n)

  // Incentive collector state
  const incentivePayoutAmount = ref(null)
  const incentiveFeePercentage = ref(null)
  
  // Computed
  const exchangeRate = computed(() => {
    if (totalSupply.value === 0n) return 1
    return Number(formatEther(totalAssets.value)) / Number(formatEther(totalSupply.value))
  })
  
  const formattedTotalAssets = computed(() => {
    return formatNumber(Number(formatEther(totalAssets.value)))
  })
  
  const formattedUserShares = computed(() => {
    return formatNumber(Number(formatEther(userShares.value)), 4)
  })
  
  const formattedUserAssets = computed(() => {
    return formatNumber(Number(formatEther(userAssets.value)), 4)
  })
  
  const formattedTotalDelegation = computed(() => {
    if (totalDelegation.value === 0n) return null
    const amount = Number(formatEther(totalDelegation.value))
    // Format as $50K style
    if (amount >= 1_000_000) {
      return '$' + (amount / 1_000_000).toFixed(0) + 'M'
    }
    if (amount >= 1_000) {
      return '$' + (amount / 1_000).toFixed(0) + 'K'
    }
    return '$' + amount.toFixed(0)
  })

  const formattedIncentivePayoutAmount = computed(() => {
    if (incentivePayoutAmount.value === null || incentivePayoutAmount.value === undefined) return null
    try {
      const amount = Number(formatEther(incentivePayoutAmount.value))
      if (!Number.isFinite(amount)) return null
      return formatNumber(amount) + ' BERA'
    } catch {
      return null
    }
  })

  // Contract stores fee in basis points (100 = 1%, 1000 = 10%)
  const formattedIncentiveFeePercentage = computed(() => {
    const raw = incentiveFeePercentage.value
    if (raw === null || raw === undefined) return null
    const n = typeof raw === 'bigint' ? Number(raw) : Number(raw)
    if (!Number.isFinite(n)) return null
    return (n / 100).toFixed(2) + '%'
  })
  
  const poolStatus = computed(() => {
    if (isFullyExited.value) return 'exited'
    if (!isActive.value) return 'inactive'
    return 'active'
  })

  function formatNumber(num, decimals = 2) {
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(2) + 'M'
    }
    if (num >= 1_000) {
      return (num / 1_000).toFixed(2) + 'K'
    }
    return num.toFixed(decimals)
  }

  async function loadPoolData() {
    if (!publicClient.value || !poolAddress.value) return
    
    try {
      const promises = [
        publicClient.value.readContract({
          address: poolAddress.value,
          abi: STAKING_POOL_ABI,
          functionName: 'totalAssets'
        }),
        publicClient.value.readContract({
          address: poolAddress.value,
          abi: STAKING_POOL_ABI,
          functionName: 'totalSupply'
        }),
        publicClient.value.readContract({
          address: poolAddress.value,
          abi: STAKING_POOL_ABI,
          functionName: 'isActive'
        }),
        publicClient.value.readContract({
          address: poolAddress.value,
          abi: STAKING_POOL_ABI,
          functionName: 'isFullyExited'
        }),
        publicClient.value.readContract({
          address: poolAddress.value,
          abi: STAKING_POOL_ABI,
          functionName: 'activeThresholdReached'
        })
      ]
      
      // Load delegation if handler address is available
      if (delegationHandlerAddress?.value) {
        promises.push(
          publicClient.value.readContract({
            address: delegationHandlerAddress.value,
            abi: DELEGATION_HANDLER_ABI,
            functionName: 'delegatedAmount'
          }).catch((err) => {
            // Error handling: Log delegation query failures for debugging
            // This is expected if handler doesn't exist or contract call fails
            console.warn('Failed to query delegation amount:', err)
            return 0n
          })
        )
      } else {
        promises.push(Promise.resolve(0n))
      }

      if (incentiveCollectorAddress?.value) {
        promises.push(
          publicClient.value.readContract({
            address: incentiveCollectorAddress.value,
            abi: INCENTIVE_COLLECTOR_ABI,
            functionName: 'payoutAmount'
          }).catch(() => null)
        )
        promises.push(
          publicClient.value.readContract({
            address: incentiveCollectorAddress.value,
            abi: INCENTIVE_COLLECTOR_ABI,
            functionName: 'feePercentage'
          }).catch(() => null)
        )
      } else {
        promises.push(Promise.resolve(null))
        promises.push(Promise.resolve(null))
      }
      
      const [assets, supply, active, exited, threshold, delegation, payoutAmount, feePercentage] = await Promise.all(promises)
      
      totalAssets.value = assets
      totalSupply.value = supply
      isActive.value = active
      isFullyExited.value = exited
      activeThresholdReached.value = threshold
      totalDelegation.value = delegation || 0n
      incentivePayoutAmount.value = payoutAmount
      incentiveFeePercentage.value = feePercentage
    } catch (err) {
      // Error handling: Log pool data loading failures
      // This indicates a real problem (RPC failure, invalid address, etc.)
      console.error('Failed to load pool data:', err)
      error.value = 'Failed to load pool data'
    }
  }

  async function loadUserData() {
    if (!publicClient.value || !poolAddress.value || !account.value) return
    
    try {
      const shares = await publicClient.value.readContract({
        address: poolAddress.value,
        abi: STAKING_POOL_ABI,
        functionName: 'balanceOf',
        args: [account.value]
      })
      
      userShares.value = shares
      
      if (shares > 0n) {
        const assets = await publicClient.value.readContract({
          address: poolAddress.value,
          abi: STAKING_POOL_ABI,
          functionName: 'convertToAssets',
          args: [shares]
        })
        userAssets.value = assets
      } else {
        userAssets.value = 0n
      }
    } catch (err) {
      // Error handling: Log user data loading failures
      // This is expected if wallet not connected or RPC issues
      console.error('Failed to load user data:', err)
    }
  }

  async function previewDeposit(amount) {
    if (!publicClient.value || !poolAddress.value || !amount) return 0n
    
    try {
      // Ensure amount is a string for parseEther
      const amountStr = String(amount)
      const shares = await publicClient.value.readContract({
        address: poolAddress.value,
        abi: STAKING_POOL_ABI,
        functionName: 'previewDeposit',
        args: [parseEther(amountStr)]
      })
      return shares
    } catch (err) {
      // Error handling: Log preview failures for debugging
      // This indicates contract call issues or invalid amounts
      console.error('Preview deposit failed:', err)
      return 0n
    }
  }

  async function previewRedeem(shares) {
    if (!publicClient.value || !poolAddress.value || !shares) return 0n
    
    try {
      const assets = await publicClient.value.readContract({
        address: poolAddress.value,
        abi: STAKING_POOL_ABI,
        functionName: 'previewRedeem',
        args: [shares]
      })
      return assets
    } catch (err) {
      // Error handling: Log preview failures for debugging
      // This indicates contract call issues or invalid shares
      console.error('Preview redeem failed:', err)
      return 0n
    }
  }

  async function stake(amount) {
    if (!walletClient.value || !poolAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    if (isFullyExited.value) {
      throw new Error('Pool has exited, deposits are disabled')
    }
    
    isLoading.value = true
    error.value = null
    
    try {
      // Ensure amount is a string for parseEther
      const amountStr = String(amount)
      const hash = await walletClient.value.writeContract({
        address: poolAddress.value,
        abi: STAKING_POOL_ABI,
        functionName: 'submit',
        args: [account.value],
        value: parseEther(amountStr),
        account: account.value
      })
      
      // Wait for confirmation
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Reload data
      await Promise.all([loadPoolData(), loadUserData()])
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Stake failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  return {
    // State
    isLoading,
    error,
    totalAssets,
    totalSupply,
    isActive,
    isFullyExited,
    activeThresholdReached,
    userShares,
    userAssets,
    
    // Computed
    exchangeRate,
    formattedTotalAssets,
    formattedUserShares,
    formattedUserAssets,
    formattedTotalDelegation,
    formattedIncentivePayoutAmount,
    formattedIncentiveFeePercentage,
    poolStatus,
    
    // Methods
    loadPoolData,
    loadUserData,
    previewDeposit,
    previewRedeem,
    stake
  }
}
