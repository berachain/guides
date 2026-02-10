/**
 * Nosy Mode: real-time contract data for Risk Dashboard and accordion sections.
 * Multicall every 15s for pool, SmartOperator, WithdrawalVault, IncentiveCollector,
 * DelegationHandler; getBalance for StakingRewardsVault; BGT and incentive token balances.
 * Incentive token list comes from chain config (knownIncentiveTokenAddresses); for each token
 * we read name, symbol, and balanceOf(incentiveCollector). No event scanning.
 * See project/briefs/staking-pool-nosy-mode.md.
 */

import { ref, watch, onUnmounted, toValue } from 'vue'
import {
  STAKING_POOL_ABI,
  SMART_OPERATOR_ABI,
  WITHDRAWAL_VAULT_ABI,
  INCENTIVE_COLLECTOR_ABI,
  DELEGATION_HANDLER_ABI,
  ERC20_BALANCE_ABI,
  ERC20_NAME_SYMBOL_ABI
} from '../utils/abis.js'
import { getChainConstants } from '../constants/chains.js'

const NOSY_POLL_INTERVAL_MS = 15_000

/**
 * @param {import('vue').Ref<import('viem').PublicClient>} publicClient
 * @param {import('vue').Ref<number>} chainId
 * @param {import('vue').Ref<string>} poolAddress
 * @param {import('vue').Ref<string|null>} smartOperatorAddress
 * @param {import('vue').Ref<string|null>} stakingRewardsVaultAddress
 * @param {import('vue').Ref<string|null>} withdrawalVaultAddress
 * @param {import('vue').Ref<string|null>} incentiveCollectorAddress
 * @param {import('vue').Ref<string|null>} delegationHandlerAddress
 * @param {import('vue').Ref<string|null>} validatorPubkey - 0x-prefixed hex (98 chars)
 * @param {import('vue').Ref<boolean>} [enabled] - when true, poll; when false, stop
 */
export function useNosyData(
  publicClient,
  chainId,
  poolAddress,
  smartOperatorAddress,
  stakingRewardsVaultAddress,
  withdrawalVaultAddress,
  incentiveCollectorAddress,
  delegationHandlerAddress,
  validatorPubkey,
  enabled = ref(true)
) {
  const isLoading = ref(false)
  const error = ref(null)

  // StakingPool
  const totalAssets = ref(0n)
  const totalSupply = ref(0n)
  const bufferedAssets = ref(0n)
  const totalDeposits = ref(0n)
  const minEffectiveBalance = ref(0n)
  const poolPaused = ref(false)
  const isActive = ref(false)
  const isFullyExited = ref(false)

  // StakingRewardsVault (native balance)
  const stakingRewardsVaultBalance = ref(0n)

  // SmartOperator
  const protocolFeePercentage = ref(0n)
  const rebaseableBgtAmount = ref(0n)
  const unboostedBalance = ref(0n)
  const bgtFeeState = ref(null) // { currentBalance, bgtBalanceAlreadyCharged, chargeableBalance, protocolFeePercentage }
  const bgtBalanceOfSmartOperator = ref(null) // from BGT.balanceOf(smartOperator), if BGT address known

  // IncentiveCollector
  const payoutAmount = ref(0n)
  const queuedPayoutAmount = ref(0n)
  const feePercentage = ref(0n)
  const incentiveTokenBalances = ref([]) // { address, name?, symbol?, balance }[]

  // WithdrawalVault
  const allocatedWithdrawalsAmount = ref(0n)
  const withdrawalVaultTotalSupply = ref(0n)
  const withdrawalRequestFee = ref(0n)
  const withdrawalVaultPaused = ref(false)

  // DelegationHandler
  const delegatedAmount = ref(0n)
  const delegatedAmountAvailable = ref(0n)
  const delegatedFundsPendingWithdrawal = ref(0n)

  let pollTimerId = null

  async function fetch() {
    const client = toValue(publicClient)
    const cid = toValue(chainId)
    const pool = toValue(poolAddress)
    const smartOp = toValue(smartOperatorAddress)
    const rewardsVault = toValue(stakingRewardsVaultAddress)
    const wVault = toValue(withdrawalVaultAddress)
    const incCollector = toValue(incentiveCollectorAddress)
    const delHandler = toValue(delegationHandlerAddress)
    const pubkey = toValue(validatorPubkey)

    if (!client || !pool) return

    isLoading.value = true
    error.value = null

    const chain = cid != null ? getChainConstants(cid) : null
    const bgtAddress = chain?.bgtAddress ?? null
    const knownTokens = chain?.knownIncentiveTokenAddresses ?? []

    try {
      const contracts = []

      // StakingPool
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'totalAssets' })
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'totalSupply' })
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'bufferedAssets' })
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'totalDeposits' })
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'minEffectiveBalance' })
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'paused' })
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'isActive' })
      contracts.push({ address: pool, abi: STAKING_POOL_ABI, functionName: 'isFullyExited' })

      let smartOpCount = 0
      let wVaultCount = 0
      let incCount = 0
      let delCount = 0

      if (smartOp) {
        contracts.push({ address: smartOp, abi: SMART_OPERATOR_ABI, functionName: 'protocolFeePercentage' })
        contracts.push({ address: smartOp, abi: SMART_OPERATOR_ABI, functionName: 'rebaseableBgtAmount' })
        contracts.push({ address: smartOp, abi: SMART_OPERATOR_ABI, functionName: 'unboostedBalance' })
        contracts.push({ address: smartOp, abi: SMART_OPERATOR_ABI, functionName: 'getEarnedBGTFeeState' })
        smartOpCount = 4
        if (bgtAddress) {
          contracts.push({ address: bgtAddress, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [smartOp] })
          smartOpCount += 1
        }
      }

      if (wVault && pubkey) {
        const pubkeyBytes = pubkey.startsWith('0x') ? pubkey : '0x' + pubkey
        contracts.push({ address: wVault, abi: WITHDRAWAL_VAULT_ABI, functionName: 'allocatedWithdrawalsAmount', args: [pubkeyBytes] })
        contracts.push({ address: wVault, abi: WITHDRAWAL_VAULT_ABI, functionName: 'totalSupply' })
        contracts.push({ address: wVault, abi: WITHDRAWAL_VAULT_ABI, functionName: 'getWithdrawalRequestFee' })
        contracts.push({ address: wVault, abi: WITHDRAWAL_VAULT_ABI, functionName: 'paused' })
        wVaultCount = 4
      }

      if (incCollector) {
        contracts.push({ address: incCollector, abi: INCENTIVE_COLLECTOR_ABI, functionName: 'payoutAmount' })
        contracts.push({ address: incCollector, abi: INCENTIVE_COLLECTOR_ABI, functionName: 'queuedPayoutAmount' })
        contracts.push({ address: incCollector, abi: INCENTIVE_COLLECTOR_ABI, functionName: 'feePercentage' })
        incCount = 3
        if (knownTokens.length) {
          for (const tokenAddr of knownTokens) {
            contracts.push({ address: tokenAddr, abi: ERC20_NAME_SYMBOL_ABI, functionName: 'name' })
            contracts.push({ address: tokenAddr, abi: ERC20_NAME_SYMBOL_ABI, functionName: 'symbol' })
            contracts.push({ address: tokenAddr, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [incCollector] })
          }
        }
      }

      if (delHandler) {
        contracts.push({ address: delHandler, abi: DELEGATION_HANDLER_ABI, functionName: 'delegatedAmount' })
        contracts.push({ address: delHandler, abi: DELEGATION_HANDLER_ABI, functionName: 'delegatedAmountAvailable' })
        contracts.push({ address: delHandler, abi: DELEGATION_HANDLER_ABI, functionName: 'delegatedFundsPendingWithdrawal' })
        delCount = 3
      }

      const res = await client.multicall({ contracts, allowFailure: true })
      let idx = 0

      totalAssets.value = res[idx]?.result ?? 0n
      idx++
      totalSupply.value = res[idx]?.result ?? 0n
      idx++
      bufferedAssets.value = res[idx]?.result ?? 0n
      idx++
      totalDeposits.value = res[idx]?.result ?? 0n
      idx++
      minEffectiveBalance.value = res[idx]?.result ?? 0n
      idx++
      poolPaused.value = Boolean(res[idx]?.result ?? false)
      idx++
      isActive.value = Boolean(res[idx]?.result ?? false)
      idx++
      isFullyExited.value = Boolean(res[idx]?.result ?? false)
      idx++

      if (smartOpCount) {
        protocolFeePercentage.value = res[idx]?.result ?? 0n
        idx++
        rebaseableBgtAmount.value = res[idx]?.result ?? 0n
        idx++
        unboostedBalance.value = res[idx]?.result ?? 0n
        idx++
        const feeState = res[idx]?.result
        idx++
        bgtFeeState.value = feeState && Array.isArray(feeState) ? { currentBalance: feeState[0], bgtBalanceAlreadyCharged: feeState[1], chargeableBalance: feeState[2], protocolFeePercentage: feeState[3] } : null
        if (bgtAddress) {
          bgtBalanceOfSmartOperator.value = res[idx]?.result ?? null
          idx++
        } else {
          bgtBalanceOfSmartOperator.value = null
        }
      } else {
        protocolFeePercentage.value = 0n
        rebaseableBgtAmount.value = 0n
        unboostedBalance.value = 0n
        bgtFeeState.value = null
        bgtBalanceOfSmartOperator.value = null
      }

      if (wVaultCount) {
        allocatedWithdrawalsAmount.value = res[idx]?.result ?? 0n
        idx++
        withdrawalVaultTotalSupply.value = res[idx]?.result ?? 0n
        idx++
        withdrawalRequestFee.value = res[idx]?.result ?? 0n
        idx++
        withdrawalVaultPaused.value = Boolean(res[idx]?.result ?? false)
        idx++
      } else {
        allocatedWithdrawalsAmount.value = 0n
        withdrawalVaultTotalSupply.value = 0n
        withdrawalRequestFee.value = 0n
        withdrawalVaultPaused.value = false
      }

      if (incCount) {
        payoutAmount.value = res[idx]?.result ?? 0n
        idx++
        queuedPayoutAmount.value = res[idx]?.result ?? 0n
        idx++
        feePercentage.value = res[idx]?.result ?? 0n
        idx++
      } else {
        payoutAmount.value = 0n
        queuedPayoutAmount.value = 0n
        feePercentage.value = 0n
      }

      const tokenBalances = []
      if (knownTokens.length) {
        for (let i = 0; i < knownTokens.length; i++) {
          const name = res[idx]?.result ?? null
          idx++
          const symbol = res[idx]?.result ?? null
          idx++
          const balance = res[idx]?.result ?? 0n
          idx++
          tokenBalances.push({ address: knownTokens[i], name, symbol, balance })
        }
      }
      incentiveTokenBalances.value = tokenBalances

      if (delCount) {
        delegatedAmount.value = res[idx]?.result ?? 0n
        idx++
        delegatedAmountAvailable.value = res[idx]?.result ?? 0n
        idx++
        delegatedFundsPendingWithdrawal.value = res[idx]?.result ?? 0n
        idx++
      } else {
        delegatedAmount.value = 0n
        delegatedAmountAvailable.value = 0n
        delegatedFundsPendingWithdrawal.value = 0n
      }

      // StakingRewardsVault native balance
      if (rewardsVault) {
        stakingRewardsVaultBalance.value = await client.getBalance({ address: rewardsVault })
      } else {
        stakingRewardsVaultBalance.value = 0n
      }
    } catch (e) {
      console.error('[useNosyData] fetch failed:', e)
      error.value = e?.message ?? 'Failed to load Nosy data'
    } finally {
      isLoading.value = false
    }
  }

  function stopPolling() {
    if (pollTimerId) {
      clearInterval(pollTimerId)
      pollTimerId = null
    }
  }

  function startPolling() {
    stopPolling()
    fetch()
    pollTimerId = setInterval(fetch, NOSY_POLL_INTERVAL_MS)
  }

  watch(
    [publicClient, chainId, poolAddress, enabled],
    ([client, cid, pool, en]) => {
      if (!en || !client || cid == null || !pool) {
        stopPolling()
        return
      }
      startPolling()
    },
    { immediate: true }
  )

  onUnmounted(stopPolling)

  return {
    isLoading,
    error,
    fetch,
    startPolling,
    stopPolling,
    // StakingPool
    totalAssets,
    totalSupply,
    bufferedAssets,
    totalDeposits,
    minEffectiveBalance,
    poolPaused,
    isActive,
    isFullyExited,
    // StakingRewardsVault
    stakingRewardsVaultBalance,
    // SmartOperator
    protocolFeePercentage,
    rebaseableBgtAmount,
    unboostedBalance,
    bgtFeeState,
    bgtBalanceOfSmartOperator,
    // IncentiveCollector
    payoutAmount,
    queuedPayoutAmount,
    feePercentage,
    incentiveTokenBalances,
    // WithdrawalVault
    allocatedWithdrawalsAmount,
    withdrawalVaultTotalSupply,
    withdrawalRequestFee,
    withdrawalVaultPaused,
    // DelegationHandler
    delegatedAmount,
    delegatedAmountAvailable,
    delegatedFundsPendingWithdrawal
  }
}
