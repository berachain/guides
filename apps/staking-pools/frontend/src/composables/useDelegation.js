import { ref, computed } from 'vue'
import { formatEther, parseEther } from 'viem'
import { DELEGATION_HANDLER_ABI } from '../utils/abis.js'

export function useDelegation(publicClient, walletClient, delegationHandlerAddress, account) {
  const isLoading = ref(false)
  const error = ref(null)
  
  // Delegation state
  const stakingPoolAddress = ref(null)
  const delegatedAmount = ref(0n)
  const isDelegated = ref(false)
  
  // Formatted values
  const formattedDelegatedAmount = computed(() => {
    return formatNumber(Number(formatEther(delegatedAmount.value)), 4)
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

  async function loadDelegationData() {
    if (!publicClient.value || !delegationHandlerAddress.value) return
    
    try {
      // Get the staking pool address from the delegation handler
      const poolAddr = await publicClient.value.readContract({
        address: delegationHandlerAddress.value,
        abi: DELEGATION_HANDLER_ABI,
        functionName: 'stakingPool'
      })
      
      stakingPoolAddress.value = poolAddr
      
      // Note: The delegation handler doesn't have a direct way to query
      // a user's delegated amount from the interface. This would need
      // additional contract methods or event parsing in a production app.
      // For now, we'll track delegation state locally.
      
    } catch (err) {
      console.error('Failed to load delegation data:', err)
      error.value = 'Failed to load delegation data'
    }
  }

  async function delegate(amount) {
    if (!walletClient.value || !delegationHandlerAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isLoading.value = true
    error.value = null
    
    try {
      const amountWei = parseEther(amount)
      
      const hash = await walletClient.value.writeContract({
        address: delegationHandlerAddress.value,
        abi: DELEGATION_HANDLER_ABI,
        functionName: 'delegate',
        args: [amountWei],
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Update local state
      delegatedAmount.value += amountWei
      isDelegated.value = true
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Delegation failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function undelegate() {
    if (!walletClient.value || !delegationHandlerAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isLoading.value = true
    error.value = null
    
    try {
      const hash = await walletClient.value.writeContract({
        address: delegationHandlerAddress.value,
        abi: DELEGATION_HANDLER_ABI,
        functionName: 'undelegate',
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Update local state
      isDelegated.value = false
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Undelegation failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function withdraw(amount, receiver = null) {
    if (!walletClient.value || !delegationHandlerAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isLoading.value = true
    error.value = null
    
    try {
      const amountWei = parseEther(amount)
      const receiverAddress = receiver || account.value
      
      const hash = await walletClient.value.writeContract({
        address: delegationHandlerAddress.value,
        abi: DELEGATION_HANDLER_ABI,
        functionName: 'withdraw',
        args: [amountWei, receiverAddress],
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Update local state
      delegatedAmount.value = delegatedAmount.value > amountWei 
        ? delegatedAmount.value - amountWei 
        : 0n
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Withdrawal failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function requestDelegatedFundsWithdrawal(maxFee = parseEther('0.01')) {
    if (!walletClient.value || !delegationHandlerAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isLoading.value = true
    error.value = null
    
    try {
      const hash = await walletClient.value.writeContract({
        address: delegationHandlerAddress.value,
        abi: DELEGATION_HANDLER_ABI,
        functionName: 'requestDelegatedFundsWithdrawal',
        value: maxFee,
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Request withdrawal failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function completeWithdrawal(requestId) {
    if (!walletClient.value || !delegationHandlerAddress.value || !account.value) {
      throw new Error('Wallet not connected')
    }
    
    isLoading.value = true
    error.value = null
    
    try {
      const hash = await walletClient.value.writeContract({
        address: delegationHandlerAddress.value,
        abi: DELEGATION_HANDLER_ABI,
        functionName: 'completeWithdrawal',
        args: [requestId],
        account: account.value
      })
      
      const receipt = await publicClient.value.waitForTransactionReceipt({ hash })
      
      // Reset delegation state after complete withdrawal
      delegatedAmount.value = 0n
      isDelegated.value = false
      
      return { hash, receipt }
    } catch (err) {
      error.value = err.message || 'Complete withdrawal failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    error,
    stakingPoolAddress,
    delegatedAmount,
    isDelegated,
    formattedDelegatedAmount,
    loadDelegationData,
    delegate,
    undelegate,
    withdraw,
    requestDelegatedFundsWithdrawal,
    completeWithdrawal
  }
}
