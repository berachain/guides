<template>
  <div class="pool-list-view">
    <div class="header-section">
      <h1>Discover Staking Pools</h1>
      <p class="text-secondary">Browse available staking pools from validators</p>
    </div>

    <div v-if="isLoading" class="loading-state">
      <p>Discovering pools...</p>
      <p class="text-secondary">This may take a moment</p>
    </div>

    <div v-else-if="error" class="error-state">
      <p class="error-text">{{ error }}</p>
      <div class="error-help">
        <p class="text-secondary">Troubleshooting:</p>
        <ul class="help-list">
          <li>Check that <code>public/config.json</code> is configured correctly</li>
          <li>For discovery mode: ensure your RPC works; discovery uses <code>api.berachain.com/graphql</code> + on-chain factory lookups</li>
          <li>For single mode: ensure a pool is configured in the <code>pools</code> section</li>
          <li>See <code>CONFIG_GUIDE.md</code> for detailed instructions</li>
        </ul>
      </div>
      <button class="btn btn-primary" @click="$emit('retry')">Retry</button>
    </div>

    <div v-else-if="pools.length === 0" class="empty-state">
      <p>No staking pools found</p>
      <p class="text-secondary">Validators with staking pools will appear here</p>
    </div>

    <div v-else class="pools-grid">
      <div
        v-for="pool in pools"
        :key="pool.stakingPool"
        :class="['pool-card', 'card', { dead: isDeadPool(pool) }]"
        @click="$emit('select-pool', pool)"
      >
        <div class="pool-header">
          <h3>{{ pool.name || (pool.validator.index !== null ? `Validator ${pool.validator.index}` : 'Staking Pool') }}</h3>
          <span :class="['status-badge', getStatusClass(pool)]">
            {{ getStatusLabel(pool) }}
          </span>
        </div>
        
        <div class="pool-info">
          <div class="info-row">
            <span class="label">
              Pool Assets
              <span
                class="info-tip"
                tabindex="0"
                data-tip="Total BERA held by the staking pool contract (on-chain totalAssets). This is pool TVL, not validator stake."
              >ⓘ</span>:
            </span>
            <span class="value">{{ formatNumber(pool.totalAssets) }} BERA</span>
          </div>
          <div v-if="pool.isActive && hasComparablePolFigures(pool)" class="info-row">
            <span class="label">
              Staked BERA
              <span
                class="info-tip"
                tabindex="0"
                data-tip="Amount of BERA Staked to POL by this Validator"
              >ⓘ</span>:
            </span>
            <span class="value">{{ formatPolStaked(pool.polStakedBeraAmount) }} BERA</span>
          </div>
          <div class="info-row">
            <span class="label">Pool Address:</span>
            <span class="value"><code class="address-inline">{{ shortenAddress(pool.stakingPool) }}</code></span>
          </div>
        </div>

        <button :class="['btn', getViewButtonClass(pool), 'btn-block']">
          {{ getViewButtonLabel(pool) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  pools: { type: Array, default: () => [] },
  isLoading: { type: Boolean, default: false },
  error: { type: String, default: null }
})

defineEmits(['select-pool', 'retry'])

function formatNumber(value) {
  const num = parseFloat(value)
  if (!Number.isFinite(num)) return '—'
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M'
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(2) + 'K'
  }
  return num.toFixed(2)
}

function hasComparablePolFigures(pool) {
  const raw = pool?.polStakedBeraAmount
  const n = raw === null || raw === undefined ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0
}

function formatPolStaked(value) {
  const n = value === null || value === undefined ? NaN : Number(value)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return formatNumber(n)
}

function shortenAddress(address) {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getStatusLabel(pool) {
  if (isDeadPool(pool)) {
    return 'Dead'
  }
  if (pool.isFullyExited) {
    return 'Exited'
  }
  return pool.isActive ? 'Active' : 'Inactive'
}

function getStatusClass(pool) {
  if (isDeadPool(pool)) {
    return 'dead'
  }
  if (pool.isFullyExited) {
    return 'exited'
  }
  return pool.isActive ? 'active' : 'inactive'
}

function isDeadPool(pool) {
  if (pool?.isDead === true) return true
  if (pool?.totalAssetsWei) {
    try {
      // Match display rounding: anything under 0.005 BERA is effectively 0.00 on the card.
      return pool?.isFullyExited && BigInt(pool.totalAssetsWei) < 5_000_000_000_000_000n
    } catch {
      // Fall through to float path.
    }
  }
  if (!pool?.isFullyExited) return false
  const staked = parseFloat(pool?.totalAssets)
  // Treat tiny dust as zero; UI rounds to 0.00 anyway.
  return Number.isFinite(staked) && staked < 0.005
}

function getViewButtonLabel(pool) {
  if (isDeadPool(pool)) return 'View Dead Pool'
  if (pool?.isFullyExited) return 'View Exited Pool'
  return 'View Pool'
}

function getViewButtonClass(pool) {
  if (isDeadPool(pool)) return 'btn-secondary'
  return 'btn-primary'
}
</script>

<style scoped>
.pool-list-view {
  padding: var(--space-4);
}

.header-section {
  margin-bottom: var(--space-6);
}

.header-section h1 {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  margin: 0 0 var(--space-2) 0;
}

.loading-state,
.error-state,
.empty-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--color-text-secondary);
}

.error-text {
  color: var(--color-error);
  margin-bottom: var(--space-4);
  font-weight: 600;
}

.error-help {
  text-align: left;
  max-width: 600px;
  margin: var(--space-4) auto;
  padding: var(--space-4);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

.help-list {
  margin: var(--space-2) 0 0 0;
  padding-left: var(--space-6);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.help-list li {
  margin-bottom: var(--space-2);
}

.help-list code {
  background: var(--color-bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: monospace;
}

.address-inline {
  font-family: monospace;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  background: var(--color-bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.info-tip {
  display: inline-block;
  margin-left: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  cursor: help;
  user-select: none;
  position: relative;
}

.info-tip::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  width: min(320px, 70vw);
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: rgba(17, 24, 39, 0.98);
  border: 1px solid var(--color-border);
  color: #fff;
  font-size: var(--font-size-sm);
  line-height: 1.25;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  z-index: 1000;
}

.info-tip:hover::after,
.info-tip:focus-visible::after {
  opacity: 1;
  visibility: visible;
}

.pools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}

.pool-card {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.pool-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.pool-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}

.pool-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0;
}

.status-badge {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
}

.status-badge.active {
  background: var(--color-success-light);
  color: var(--color-success);
}

.status-badge.inactive {
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}

.status-badge.exited {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
}

.status-badge.dead {
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.pool-card.dead {
  opacity: 0.75;
}

.pool-info {
  margin-bottom: var(--space-4);
}

.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.info-row .label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.info-row .value {
  font-weight: 600;
  font-size: var(--font-size-sm);
}

.pool-address {
  margin-bottom: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border);
}

.pool-address .label {
  display: block;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  margin-bottom: var(--space-1);
}

.address-text {
  font-family: monospace;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.btn-block {
  width: 100%;
}
</style>
