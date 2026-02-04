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
            :is-connected="wallet.isConnected.value"
            :is-loading="pool.isLoading.value"
            :wallet-balance="walletBalance"
            :explorer-url="explorerUrl"
            :hub-boost-url="hubBoostUrl"
            :formatted-total-assets="pool.formattedTotalAssets.value"
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
            :is-connected="wallet.isConnected.value"
            :is-loading="withdrawals.isLoading.value"
            :explorer-url="explorerUrl"
            :hub-boost-url="hubBoostUrl"
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
          
        </template>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { formatEther } from 'viem'
import { loadConfig, loadTheme } from './utils/config.js'
import { useWallet } from './composables/useWallet.js'
import { useStakingPool } from './composables/useStakingPool.js'
import { useWithdrawals } from './composables/useWithdrawals.js'
import { DELEGATION_HANDLER_FACTORY_ABI } from './utils/abis.js'
import WalletConnect from './components/common/WalletConnect.vue'
import TabNav from './components/common/TabNav.vue'
import StakeView from './views/StakeView.vue'
import WithdrawView from './views/WithdrawView.vue'
import PoolListView from './views/PoolListView.vue'
import { usePoolDiscovery } from './composables/usePoolDiscovery.js'

// App state
const config = ref(null)
const poolConfig = ref(null)
const isLoading = ref(true)
const loadError = ref(null)
const walletBalance = ref('0')
const activeTab = ref('stake')
const isApplyingUrlState = ref(false)

// Computed
const explorerUrl = computed(() => config.value?.network?.explorerUrl || 'https://berascan.com')
const hubBoostUrl = computed(() => {
  const pubkey = poolConfig.value?.validatorPubkey
  const chainId = config.value?.network?.chainId
  if (!pubkey || typeof pubkey !== 'string') return null

  const base =
    chainId === 80069
      ? 'https://bepolia.hub.berachain.com'
      : 'https://hub.berachain.com'

  return `${base}/boost/${encodeURIComponent(pubkey)}`
})

const tabs = computed(() => [
  { id: 'discover', label: 'Discover', icon: '🔍' },
  { id: 'stake', label: 'Stake', icon: '📥' },
  { id: 'withdraw', label: 'Withdraw', icon: '📤', badge: withdrawals.pendingCount.value || null }
])

function normalizeTab(tab) {
  if (tab === 'discover' || tab === 'stake' || tab === 'withdraw') return tab
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

    // If URL specifies a pool, select it (works in discovery mode too).
    if (state.pool && state.pubkey) {
      poolAddress.value = state.pool
      poolConfig.value = {
        name: poolConfig.value?.name || 'Staking Pool',
        validatorPubkey: state.pubkey,
        stakingPool: state.pool,
        enabled: true
      }

      // Try to set delegation handler for this pubkey.
      if (wallet.publicClient.value) {
        try {
          const chainId = config.value?.network?.chainId
          const factoryAddress =
            chainId === 80069
              ? '0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c'
              : '0xAd17932a5B1aaeEa73D277a6AE670623F176E0D0'

          const handlerAddr = await wallet.publicClient.value.readContract({
            address: factoryAddress,
            abi: DELEGATION_HANDLER_FACTORY_ABI,
            functionName: 'delegationHandlers',
            args: [state.pubkey]
          })
          delegationHandlerAddress.value =
            handlerAddr && handlerAddr !== '0x0000000000000000000000000000000000000000'
              ? handlerAddr
              : null
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
const pool = useStakingPool(
  wallet.publicClient,
  wallet.walletClient,
  poolAddress,
  wallet.account,
  delegationHandlerAddress
)

const withdrawalVaultAddress = ref(null)
const withdrawals = useWithdrawals(
  wallet.publicClient,
  wallet.walletClient,
  withdrawalVaultAddress,
  poolAddress,
  wallet.account
)

// Pool discovery - respects explicit mode or auto-detects
const poolDiscovery = usePoolDiscovery(
  wallet.publicClient,
  computed(() => config.value?.network?.chainId),
  computed(() => config.value?.pools),
  computed(() => config.value?.mode)
)

// Initialization
async function initialize() {
  isLoading.value = true
  loadError.value = null
  
  try {
    const cfg = await loadConfig()
    config.value = cfg
    
    // Load theme if specified
    if (cfg.branding?.theme) {
      loadTheme(cfg.branding.theme)
    }
    
    // Initialize chain for wallet
    await wallet.initializeChain(cfg)

    // Apply any URL state after chain/config exists.
    const urlState = getUrlState()
    await applyUrlState(urlState)
    // Normalize URL to reflect current state (without adding a history entry).
    writeUrlState(
      {
        tab: activeTab.value,
        pool: poolAddress.value,
        pubkey: poolConfig.value?.validatorPubkey
      },
      'replace'
    )
    
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
      poolAddress.value = firstEnabledPool.stakingPool
    } else {
      // Discovery mode: pools will be loaded when discover tab is opened
      // For now, we can't set a default pool, so leave it null
      // User will need to select a pool from the discover tab
    }
    
    withdrawalVaultAddress.value = cfg.contracts?.withdrawalVault
    
    // Try to get delegation handler from config, or query from factory if pubkey available
    let handlerAddr = cfg.contracts?.delegationHandler
    const handlerPubkey = firstEnabledPool?.validatorPubkey
    if ((!handlerAddr || handlerAddr === '0x0000000000000000000000000000000000000000') && handlerPubkey && wallet.publicClient.value) {
      // Query delegation handler from factory using pubkey
      try {
        const factoryAddress = cfg.network?.chainId === 80069 
          ? '0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c' // bepolia
          : '0xAd17932a5B1aaeEa73D277a6AE670623F176E0D0' // mainnet
        
        handlerAddr = await wallet.publicClient.value.readContract({
          address: factoryAddress,
          abi: DELEGATION_HANDLER_FACTORY_ABI,
          functionName: 'delegationHandlers',
          args: [handlerPubkey]
        })
        
        if (handlerAddr && handlerAddr !== '0x0000000000000000000000000000000000000000') {
          console.log('Found delegation handler:', handlerAddr)
        }
      } catch (err) {
        // Error handling: Delegation handler query failed - this is expected if no handler exists
        console.warn('Could not query delegation handler from factory:', err)
      }
    }
    
    delegationHandlerAddress.value = handlerAddr && handlerAddr !== '0x0000000000000000000000000000000000000000' ? handlerAddr : null
    
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
  const assets = await pool.previewRedeem(shares)
  callback(assets)
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
      withdrawals.loadWithdrawalRequests()
    ])
  }
})

// Watch for tab changes to refresh data
watch(activeTab, async (tab) => {
  if (!wallet.isConnected.value && tab !== 'discover') return
  
  if (tab === 'discover') {
    // Discover pools when discover tab is opened
    await poolDiscovery.discoverPools()
  } else if (tab === 'withdraw') {
    await withdrawals.loadWithdrawalRequests()
  }
})

watch(
  [activeTab, poolAddress, () => poolConfig.value?.validatorPubkey],
  ([tab, pool, pubkey]) => {
    if (isApplyingUrlState.value) return
    writeUrlState({ tab, pool, pubkey }, 'push')
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
      const factoryAddress = config.value?.network?.chainId === 80069 
        ? '0x8b472791aC2f9e9Bd85f8919401b8Ce3bdFd464c' // bepolia
        : '0xAd17932a5B1aaeEa73D277a6AE670623F176E0D0' // mainnet
      
      const handlerAddr = await wallet.publicClient.value.readContract({
        address: factoryAddress,
        abi: DELEGATION_HANDLER_FACTORY_ABI,
        functionName: 'delegationHandlers',
        args: [selectedPool.validator.pubkey]
      })
      
      delegationHandlerAddress.value = handlerAddr && handlerAddr !== '0x0000000000000000000000000000000000000000' ? handlerAddr : null
    } catch (err) {
      delegationHandlerAddress.value = null
    }
  }
  
  // Load pool data
  await pool.loadPoolData()
  if (wallet.isConnected.value) {
    await pool.loadUserData()
  }
  
  // Switch to stake tab
  activeTab.value = 'stake'
}

// Periodic refresh
let refreshInterval = null

onMounted(() => {
  initialize()

  window.addEventListener('popstate', async () => {
    if (!config.value) return
    const st = getUrlState()
    await applyUrlState(st)
  })
  
  refreshInterval = setInterval(async () => {
    if (poolAddress.value) {
      await pool.loadPoolData()
      if (wallet.isConnected.value) {
        await pool.loadUserData()
        if (activeTab.value === 'withdraw') {
          await withdrawals.loadWithdrawalRequests()
        }
      }
    }
  }, 15000) // Refresh every 15 seconds
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
