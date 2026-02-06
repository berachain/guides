<template>
  <div class="app">
    <header class="header">
      <div class="header-content">
        <div class="logo">
          <img v-if="config?.branding?.logo" :src="config.branding.logo" alt="Logo" class="logo-img" />
          <span class="logo-text">{{ config?.branding?.name || 'Staking Pool' }}</span>
        </div>
        <WalletConnect
          :is-connected="wallet.isConnected.value"
          :is-connecting="wallet.isConnecting.value"
          :short-address="wallet.shortAddress.value"
          :error="wallet.error.value"
          @connect="wallet.connect"
          @disconnect="wallet.disconnect"
        />
      </div>
    </header>
    
    <main class="main">
      <div class="container">
        <div v-if="isLoading" class="loading">
          Loading...
        </div>
        
        <div v-else-if="loadError" class="error-state">
          <p>{{ loadError }}</p>
          <button class="btn btn-primary" @click="initialize">Retry</button>
        </div>
        
        <template v-else>
          <TabNav v-model="activeTab" :tabs="tabs" />
          
          <PoolListView
            v-if="activeTab === 'discover'"
            :pools="poolDiscovery.pools.value"
            :is-loading="poolDiscovery.isLoading.value"
            :error="poolDiscovery.error.value"
            @select-pool="handleSelectPool"
            @retry="poolDiscovery.discoverPools"
          />
          
          <div v-else-if="!poolAddress && activeTab !== 'discover'" class="error-state">
            <p>No pool selected</p>
            <p class="text-secondary">Go to the Discover tab to select a pool</p>
            <button class="btn btn-primary" @click="activeTab = 'discover'">Discover Pools</button>
          </div>
          
          <StakeView
            v-else-if="activeTab === 'stake' && poolAddress"
            :pool-name="poolConfig?.name"
            :pool-address="poolAddress"
            :validator-pubkey="poolConfig?.validatorPubkey"
            :is-connected="wallet.isConnected.value"
            :is-loading="pool.isTxPending.value"
            :wallet-balance="walletBalance"
            :explorer-url="explorerUrl"
            :hub-boost-url="hubBoostUrl"
            :incentive-collector="poolConfig?.incentiveCollector"
            :formatted-total-assets="pool.formattedTotalAssets.value"
            :formatted-incentive-payout-amount="pool.formattedIncentivePayoutAmount.value"
            :formatted-incentive-fee-percentage="pool.formattedIncentiveFeePercentage.value"
            :exchange-rate="pool.exchangeRate.value"
            :pool-status="pool.poolStatus.value"
            :is-fully-exited="pool.isFullyExited.value"
            :formatted-user-shares="pool.formattedUserShares.value"
            :formatted-user-assets="pool.formattedUserAssets.value"
            :formatted-total-delegation="pool.formattedTotalDelegation.value"
            @connect="wallet.connect"
            @stake="handleStake"
            @preview-deposit="handlePreviewDeposit"
          />
          
          <WithdrawView
            v-else-if="activeTab === 'withdraw' && poolAddress"
            :pool-name="poolConfig?.name"
            :pool-address="poolAddress"
            :validator-pubkey="poolConfig?.validatorPubkey"
            :is-connected="wallet.isConnected.value"
            :is-loading="withdrawals.isTxPending.value"
            :explorer-url="explorerUrl"
            :hub-boost-url="hubBoostUrl"
            :finalization-delay-blocks="withdrawals.finalizationDelayBlocks.value"
            :seconds-per-block="withdrawals.SECONDS_PER_BLOCK"
            :formatted-total-delegation="pool.formattedTotalDelegation.value"
            :formatted-total-assets="pool.formattedTotalAssets.value"
            :incentive-collector="poolConfig?.incentiveCollector"
            :formatted-incentive-payout-amount="pool.formattedIncentivePayoutAmount.value"
            :formatted-incentive-fee-percentage="pool.formattedIncentiveFeePercentage.value"
            :exchange-rate="pool.exchangeRate.value"
            :pool-status="pool.poolStatus.value"
            :user-shares="pool.userShares.value"
            :formatted-user-shares="pool.formattedUserShares.value"
            :formatted-user-assets="pool.formattedUserAssets.value"
            :withdrawal-requests="withdrawals.withdrawalRequests.value"
            @connect="wallet.connect"
            @request-redeem="handleRequestRedeem"
            @preview-redeem="handlePreviewRedeem"
            @finalize="handleFinalize"
            @finalize-multiple="handleFinalizeMultiple"
          />

          <NosyView
            v-else-if="activeTab === 'nosy' && poolAddress && nosyModeEnabled"
            :pool-address="poolAddress"
            :explorer-url="explorerUrl"
            :nosy-data="nosyData"
            :scan-status="nosyScan.scanStatus?.value"
            :scan-error="nosyScan.scanError?.value"
            :scanned-ranges="nosyScan.scannedRanges?.value ?? []"
            :events="nosyScan.events?.value ?? []"
            :last-scanned-block="nosyScan.lastScannedBlock?.value"
            :scan-start-block="nosyScan.scanStartBlock?.value"
            :tip-watcher-active="nosyScan.tipWatcherActive?.value"
            :tip-blocks-scanned="nosyScan.tipBlocksScanned?.value ?? 0"
            :can-scan="nosyCanScan?.value ?? nosyCanScan"
            :start-scan="nosyScan.startScan"
            :stop-scan="nosyScan.stopScan"
            :start-tip-watcher="nosyScan.startTipWatcher"
            :reset-nosy-browser-state="resetNosyBrowserState"
          />

          <!-- Nosy mode disabled: redirect to stake -->
          <div v-else-if="activeTab === 'nosy' && !nosyModeEnabled" class="nosy-disabled-notice">
            <p>Nosy Mode is disabled.</p>
          </div>
          
        </template>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { formatEther } from 'viem'
import { loadConfig, loadTheme } from './utils/config.js'
import { defaultPoolName } from './utils/format.js'
import { useWallet } from './composables/useWallet.js'
import { useStakingPool } from './composables/useStakingPool.js'
import { useWithdrawals } from './composables/useWithdrawals.js'
import { STAKING_POOL_FACTORY_ABI } from './utils/abis.js'
import { getChainConstants } from './constants/chains.js'
import { resolveCoreContracts, resolveDelegationHandler } from './utils/contracts.js'
import { isValidAddress, isValidValidatorPubkey } from './constants/addresses.js'
import { REFRESH_INTERVAL_MS } from './constants/thresholds.js'
import WalletConnect from './components/common/WalletConnect.vue'
import TabNav from './components/common/TabNav.vue'
import StakeView from './views/StakeView.vue'
import WithdrawView from './views/WithdrawView.vue'
import PoolListView from './views/PoolListView.vue'
import NosyView from './views/NosyView.vue'
import { usePoolDiscovery } from './composables/usePoolDiscovery.js'
import { usePoolEventScan } from './composables/usePoolEventScan.js'
import { useNosyData } from './composables/useNosyData.js'
import { deleteNosyDb } from './utils/nosyDb.js'

// App state
const config = ref(null)
const poolConfig = ref(null)
const isLoading = ref(true)
const loadError = ref(null)
const walletBalance = ref('0')
const activeTab = ref('stake') // Default to stake; discover only shown in discovery mode
const isApplyingUrlState = ref(false)

// Computed
const explorerUrl = computed(() => getChainConstants(config.value?.network?.chainId)?.explorerUrl || 'https://berascan.com')
const stakingPoolFactoryAddress = computed(() => getChainConstants(config.value?.network?.chainId)?.stakingPoolFactoryAddress ?? null)
const hubBoostUrl = computed(() => {
  const pubkey = poolConfig.value?.validatorPubkey
  const chainId = config.value?.network?.chainId
  if (!pubkey || typeof pubkey !== 'string') return null
  const chain = getChainConstants(chainId)
  if (!chain?.hubBaseUrl) return null
  return `${chain.hubBaseUrl}/boost/${encodeURIComponent(pubkey)}`
})

const nosyModeEnabled = computed(() => config.value?.nosyMode === true)

const tabs = computed(() => {
  const count = withdrawals.pendingCount.value
  const showBadge =
    (activeTab.value === 'stake' || activeTab.value === 'withdraw') &&
    poolAddress.value &&
    count > 0
  const mode = config.value?.mode || 'single'
  const allTabs = [
    { id: 'discover', label: 'Discover', icon: '🔍' },
    { id: 'stake', label: 'Stake', icon: '📥' },
    { id: 'withdraw', label: 'Withdraw', icon: '📤', badge: showBadge ? count : null },
    ...(nosyModeEnabled.value ? [{ id: 'nosy', label: 'Nosy', icon: '👁' }] : [])
  ]
  return mode === 'single' ? allTabs.filter(t => t.id !== 'discover') : allTabs
})

function normalizeTab(tab) {
  const mode = config.value?.mode || 'single'
  if (mode === 'single' && tab === 'discover') return 'stake'
  if (tab === 'nosy' && !nosyModeEnabled.value) return 'stake'
  if (tab === 'discover' || tab === 'stake' || tab === 'withdraw' || tab === 'nosy') return tab
  return null
}

function getUrlState() {
  const params = new URLSearchParams(window.location.search)
  const tab = normalizeTab(params.get('tab'))
  const pool = params.get('pool')
  const pubkey = params.get('pubkey')
  return { tab, pool, pubkey }
}

function writeUrlState(next, mode = 'push') {
  const params = new URLSearchParams(window.location.search)
  if (next.tab) params.set('tab', next.tab)
  else params.delete('tab')

  if (next.pool) params.set('pool', next.pool)
  else params.delete('pool')

  if (next.pubkey) params.set('pubkey', next.pubkey)
  else params.delete('pubkey')

  const qs = params.toString()
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  if (mode === 'replace') window.history.replaceState({}, '', url)
  else window.history.pushState({}, '', url)
}

async function applyUrlState(state) {
  isApplyingUrlState.value = true
  try {
    if (state.tab) activeTab.value = state.tab

    // If URL specifies a pool, select it (works in discovery mode too). Validate before use.
    const poolValid = state.pool && isValidAddress(state.pool)
    const pubkeyValid = state.pubkey && isValidValidatorPubkey(state.pubkey)
    if (poolValid && pubkeyValid) {
      poolAddress.value = state.pool
      poolConfig.value = {
        name: poolConfig.value?.name || defaultPoolName(state.pool),
        validatorPubkey: state.pubkey,
        stakingPool: state.pool,
        enabled: true
      }

      // Best-effort: fetch core contracts and delegation handler for deep links.
      if (wallet.publicClient.value) {
        try {
          const core = await resolveCoreContracts(wallet.publicClient.value, config.value?.network?.chainId, state.pubkey)
          if (core) {
            poolConfig.value = {
              ...poolConfig.value,
              smartOperator: core.smartOperator || poolConfig.value?.smartOperator,
              stakingRewardsVault: core.stakingRewardsVault || poolConfig.value?.stakingRewardsVault,
              ...(core.incentiveCollector && { incentiveCollector: core.incentiveCollector })
            }
          }
        } catch {
          // ignore: deep link may point at unknown validator/pool combination
        }

        try {
          delegationHandlerAddress.value = await resolveDelegationHandler(wallet.publicClient.value, config.value?.network?.chainId, state.pubkey)
        } catch {
          delegationHandlerAddress.value = null
        }
      }

      await pool.loadPoolData()
      if (wallet.isConnected.value) await pool.loadUserData()
    }
  } finally {
    isApplyingUrlState.value = false
  }
}

// Composables
const wallet = useWallet()

const poolAddress = ref(null)
const delegationHandlerAddress = ref(null)
const incentiveCollectorAddress = computed(() => poolConfig.value?.incentiveCollector || null)
const pool = useStakingPool(
  wallet.publicClient,
  wallet.walletClient,
  poolAddress,
  wallet.account,
  delegationHandlerAddress,
  incentiveCollectorAddress
)

const withdrawalVaultAddress = ref(null)
const withdrawals = useWithdrawals(
  wallet.publicClient,
  wallet.walletClient,
  withdrawalVaultAddress,
  poolAddress,
  computed(() => poolConfig.value?.validatorPubkey || null),
  wallet.account,
  computed(() => config.value?.network?.chainId || null)
)

const nosyScan = usePoolEventScan(
  wallet.publicClient,
  computed(() => config.value?.network?.chainId ?? null),
  poolAddress,
  computed(() => poolConfig.value?.smartOperator ?? null),
  withdrawalVaultAddress,
  stakingPoolFactoryAddress
)

const nosyCanScan = computed(() =>
  !!poolAddress.value &&
  !!poolConfig.value?.smartOperator &&
  !!withdrawalVaultAddress.value
)

const nosyDataEnabled = computed(() => activeTab.value === 'nosy' && !!poolAddress.value)
const nosyData = useNosyData(
  wallet.publicClient,
  computed(() => config.value?.network?.chainId ?? null),
  poolAddress,
  computed(() => poolConfig.value?.smartOperator ?? null),
  computed(() => poolConfig.value?.stakingRewardsVault ?? null),
  withdrawalVaultAddress,
  incentiveCollectorAddress,
  delegationHandlerAddress,
  computed(() => poolConfig.value?.validatorPubkey ?? null),
  nosyDataEnabled
)

async function resetNosyBrowserState() {
  // Reset everything Nosy sets in the browser: IndexedDB + module-level caches + in-memory scan state.
  try {
    nosyScan.resetState?.()
    await deleteNosyDb()
    await nosyScan.loadEventsFromDb?.()
    await nosyData.fetch?.()
  } catch (e) {
    console.warn('[App] resetNosyBrowserState failed:', e)
    throw e
  }
}

// Pool discovery - respects explicit mode or auto-detects
const poolDiscovery = usePoolDiscovery(
  wallet.publicClient,
  computed(() => config.value?.network?.chainId),
  computed(() => config.value?.pools),
  computed(() => config.value?.mode),
  wallet.account
)

// Initialization
async function initialize() {
  isLoading.value = true
  loadError.value = null
  
  try {
    let cfg = await loadConfig()
    const chainId = cfg.network?.chainId
    if (chainId != null && typeof chainId === 'number') {
      const chainConstants = getChainConstants(chainId)
      if (chainConstants) {
        cfg = {
          ...cfg,
          network: {
            name: cfg.network?.name ?? chainConstants.name,
            chainId,
            rpcUrl: cfg.network?.rpcUrl ?? chainConstants.rpcUrl,
            explorerUrl: cfg.network?.explorerUrl ?? chainConstants.explorerUrl,
            ...cfg.network
          }
        }
      }
    }
    config.value = cfg

    if (cfg.branding?.theme) {
      loadTheme(cfg.branding.theme)
    }

    await wallet.initializeChain(cfg)
    await wallet.reconnect()

    // Determine mode
    const mode = cfg.mode || 'single'
    const isDiscoveryMode = (mode === 'discovery')
    const enabledPools = Object.entries(cfg.pools || {})
      .filter(([_, p]) => p.enabled)
      .map(([key, p]) => ({ key, ...p }))
    const firstEnabledPool = enabledPools[0] || null
    
    // For single pool mode, get first enabled pool
    if (!isDiscoveryMode) {
      if (!firstEnabledPool) {
        throw new Error('Single pool mode requires at least one enabled pool in config.json. Add a pool to the "pools" section, or set "mode": "discovery" to use multi-pool mode.')
      }
      
      poolConfig.value = firstEnabledPool
      const pubkey = firstEnabledPool.validatorPubkey
      if (!pubkey || typeof pubkey !== 'string' || pubkey.length !== 98) {
        throw new Error('Single pool mode requires a valid validatorPubkey (98 hex chars) in the pool config.')
      }
      
      // Derive pool address and core contracts from factory if not fully specified in config
      let poolAddr = firstEnabledPool.stakingPool
      let incentiveCollector = firstEnabledPool.incentiveCollector
      let smartOperator = firstEnabledPool.smartOperator
      let stakingRewardsVault = firstEnabledPool.stakingRewardsVault

      const needsPoolAddr = !poolAddr || poolAddr === '0x0000000000000000000000000000000000000000'
      const needsCoreFields = !smartOperator || !stakingRewardsVault

      if ((needsPoolAddr || needsCoreFields) && wallet.publicClient.value) {
        let core
        try {
          core = await resolveCoreContracts(wallet.publicClient.value, cfg.network?.chainId, pubkey)
        } catch (err) {
          if (needsPoolAddr) throw new Error('Could not resolve staking pool from chain. Check RPC and chain ID (80069 or 80094).')
        }
        if (core) {
          if (needsPoolAddr) {
            if (!core.stakingPool) {
              throw new Error('No staking pool found for this validator. Ensure the pool is deployed on this chain.')
            }
            poolAddr = core.stakingPool
            incentiveCollector = core.incentiveCollector ?? incentiveCollector
          }
          smartOperator = core.smartOperator ?? smartOperator
          stakingRewardsVault = core.stakingRewardsVault ?? stakingRewardsVault
        }
      }
      
      poolAddress.value = poolAddr
      poolConfig.value = {
        ...firstEnabledPool,
        stakingPool: poolAddr,
        incentiveCollector: incentiveCollector || firstEnabledPool.incentiveCollector,
        smartOperator: smartOperator || firstEnabledPool.smartOperator,
        stakingRewardsVault: stakingRewardsVault || firstEnabledPool.stakingRewardsVault
      }
    } else {
      // Discovery mode: pools will be loaded when discover tab is opened
      // For now, we can't set a default pool, so leave it null
      // User will need to select a pool from the discover tab
    }
    
    // Derive withdrawal vault from factory if not in config
    let vaultAddr = cfg.contracts?.withdrawalVault
    if (!vaultAddr || vaultAddr === '0x0000000000000000000000000000000000000000') {
      try {
        const chain = getChainConstants(cfg.network?.chainId)
        vaultAddr = await wallet.publicClient.value.readContract({
          address: chain.stakingPoolFactoryAddress,
          abi: STAKING_POOL_FACTORY_ABI,
          functionName: 'withdrawalVault'
        })
        if (!vaultAddr || vaultAddr === '0x0000000000000000000000000000000000000000') {
          throw new Error('Withdrawal vault not found on chain.')
        }
      } catch (err) {
        throw new Error('Could not resolve withdrawal vault from factory. Check RPC and chain ID.')
      }
    }
    withdrawalVaultAddress.value = vaultAddr
    
    // Try to get delegation handler from config, or query from factory if pubkey available
    let handlerAddr = cfg.contracts?.delegationHandler
    const handlerPubkey = firstEnabledPool?.validatorPubkey
    if ((!handlerAddr || handlerAddr === '0x0000000000000000000000000000000000000000') && handlerPubkey && wallet.publicClient.value) {
      try {
        handlerAddr = await resolveDelegationHandler(wallet.publicClient.value, cfg.network?.chainId, handlerPubkey)
      } catch (err) {
        throw new Error('Could not resolve delegation handler from factory. Check RPC and chain ID.')
      }
    }
    
    delegationHandlerAddress.value = handlerAddr || null
    
    // Apply URL state after pool initialization (but only for discovery mode or tab changes)
    const urlState = getUrlState()
    if (isDiscoveryMode && (urlState.pool || urlState.pubkey)) {
      await applyUrlState(urlState)
    } else if (urlState.tab) {
      activeTab.value = urlState.tab
    }
    
    // Normalize URL to reflect current state
    // In single-pool mode, omit pool/pubkey from URL (they're implicit)
    writeUrlState(
      {
        tab: activeTab.value === 'stake' ? null : activeTab.value,
        pool: isDiscoveryMode ? poolAddress.value : null,
        pubkey: isDiscoveryMode ? poolConfig.value?.validatorPubkey : null
      },
      'replace'
    )
    
    // Load initial data (only if we have a pool address)
    if (poolAddress.value) {
      await pool.loadPoolData()
    }
    
  } catch (err) {
    console.error('Initialization failed:', err)
    loadError.value = err.message || 'Failed to initialize'
  } finally {
    isLoading.value = false
  }
}

async function loadWalletBalance() {
  if (!wallet.isConnected.value || !wallet.publicClient.value) {
    walletBalance.value = '0'
    return
  }
  
  try {
    const balance = await wallet.publicClient.value.getBalance({
      address: wallet.account.value
    })
    walletBalance.value = parseFloat(formatEther(balance)).toFixed(4)
  } catch (err) {
    console.error('Failed to load balance:', err)
    walletBalance.value = '0'
  }
}

// Event handlers - Stake
async function handleStake(amount, { resolve, reject }) {
  try {
    const result = await pool.stake(amount)
    await loadWalletBalance()
    resolve(result)
  } catch (err) {
    reject(err)
  }
}

async function handlePreviewDeposit(amount, callback) {
  const shares = await pool.previewDeposit(amount)
  callback(shares)
}

// Event handlers - Withdrawals
async function handleRequestRedeem(shares, maxFee, { resolve, reject }) {
  try {
    const result = await withdrawals.requestRedeem(shares, poolConfig.value?.validatorPubkey || '0x', maxFee)
    await pool.loadUserData()
    resolve(result)
  } catch (err) {
    reject(err)
  }
}

async function handlePreviewRedeem(shares, callback) {
  const result = await pool.previewRedeem(shares)
  callback(result.success ? result.assets : 0n)
}

async function handleFinalize(requestId, { resolve, reject }) {
  try {
    const result = await withdrawals.finalizeWithdrawal(requestId)
    await loadWalletBalance()
    resolve(result)
  } catch (err) {
    reject(err)
  }
}

async function handleFinalizeMultiple(requestIds, { resolve, reject }) {
  try {
    const result = await withdrawals.finalizeMultiple(requestIds)
    await loadWalletBalance()
    resolve(result)
  } catch (err) {
    reject(err)
  }
}


// Watch for wallet connection changes
watch(() => wallet.isConnected.value, async (connected) => {
  if (connected) {
    await Promise.all([
      loadWalletBalance(),
      pool.loadUserData(),
      withdrawals.loadWithdrawalRequests(),
      activeTab.value === 'discover'
        ? poolDiscovery.discoverPoolsFromApi()
        : poolDiscovery.discoverPools()
    ])
  }
})

// Watch for tab changes to refresh data
watch(activeTab, async (tab) => {
  if (tab === 'discover') {
    // Always load all pools from chain API so Discover shows every pool (not just config in single mode)
    // This will include user positions if wallet is connected
    await poolDiscovery.discoverPoolsFromApi()
  } else if (wallet.isConnected.value && (tab === 'stake' || tab === 'withdraw')) {
    // Refresh pending count for current pool so badge is correct
    await withdrawals.loadWithdrawalRequests()
  }
})

watch(
  [activeTab, poolAddress, () => poolConfig.value?.validatorPubkey],
  ([tab, pool, pubkey]) => {
    if (isApplyingUrlState.value) return
    const mode = config.value?.mode || 'single'
    const isDiscovery = mode === 'discovery'
    
    if (tab === 'discover') {
      writeUrlState({ tab: 'discover', pool: null, pubkey: null }, 'push')
    } else if (isDiscovery) {
      // Discovery mode: include pool/pubkey in URL
      writeUrlState({ tab, pool, pubkey }, 'push')
    } else {
      // Single-pool mode: omit pool/pubkey, only include tab if not stake
      writeUrlState({ tab: tab === 'stake' ? null : tab, pool: null, pubkey: null }, 'push')
    }
  }
)

// Handle pool selection from discovery
async function handleSelectPool(selectedPool) {
  // Update pool address and related state
  poolAddress.value = selectedPool.stakingPool
  poolConfig.value = {
    name: selectedPool.name || 'Staking Pool',
    validatorPubkey: selectedPool.validator.pubkey,
    stakingPool: selectedPool.stakingPool,
    smartOperator: selectedPool.smartOperator,
    stakingRewardsVault: selectedPool.stakingRewardsVault,
    incentiveCollector: selectedPool.incentiveCollector,
    enabled: true
  }
  
  // Try to get delegation handler
  if (selectedPool.validator.pubkey && wallet.publicClient.value) {
    try {
      delegationHandlerAddress.value = await resolveDelegationHandler(wallet.publicClient.value, config.value?.network?.chainId, selectedPool.validator.pubkey)
    } catch {
      delegationHandlerAddress.value = null
    }
  }
  
  // Load pool data
  await pool.loadPoolData()
  if (wallet.isConnected.value) {
    await pool.loadUserData()
    await withdrawals.loadWithdrawalRequests()
  }

  // Switch to stake tab
  activeTab.value = 'stake'
}

// Periodic refresh
let refreshInterval = null
let visibilityHandler = null

async function refreshData() {
  if (document.visibilityState === 'hidden') return
  if (poolAddress.value) {
    await pool.loadPoolData()
    if (wallet.isConnected.value) {
      await pool.loadUserData()
      if (activeTab.value === 'withdraw') {
        await withdrawals.loadWithdrawalRequests()
      }
    }
  }
}

onMounted(() => {
  initialize()

  window.addEventListener('popstate', async () => {
    if (!config.value) return
    const st = getUrlState()
    await applyUrlState(st)
  })
  
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      refreshData()
    }
  }
  document.addEventListener('visibilitychange', visibilityHandler)

  refreshInterval = setInterval(refreshData, REFRESH_INTERVAL_MS) // Refresh every 15 seconds
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
  }
})
</script>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  padding: var(--space-4) var(--space-6);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  max-width: 1000px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.logo-img {
  height: 32px;
  width: auto;
}

.logo-text {
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.main {
  flex: 1;
  padding: var(--space-8) var(--space-6);
}

.container {
  max-width: 1000px;
  margin: 0 auto;
}

.loading,
.error-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--color-text-secondary);
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}
</style>
