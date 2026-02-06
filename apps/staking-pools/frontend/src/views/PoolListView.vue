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

    <div v-else class="pools-sections">
      <section v-if="activePools.length > 0" class="pool-section">
        <h2 class="section-title">Active</h2>
        <div class="pools-grid">
          <div
            v-for="pool in activePools"
            :key="pool.stakingPool"
            class="pool-card card"
            @click="$emit('select-pool', pool)"
          >
            <div class="pool-header">
              <h3>{{ pool.name || (pool.validator?.index != null ? `Validator ${pool.validator.index}` : 'Staking Pool') }}</h3>
              <span :class="['status-badge', getStatusClass(pool)]">{{ getStatusLabel(pool) }}</span>
            </div>
            <div class="pool-info">
              <div class="info-row">
                <span class="label">Assets:</span>
                <span class="value">{{ formatNumber(pool.totalAssets) }} BERA</span>
              </div>
              <div v-if="hasUserPosition(pool)" class="info-row">
                <span class="label">Your Position:</span>
                <span class="value position-value"><span class="position-assets">{{ formatNumber(pool.userAssets) }} BERA</span></span>
              </div>
            </div>
            <button :class="['btn', getViewButtonClass(pool), 'btn-block']">{{ getViewButtonLabel(pool) }}</button>
          </div>
        </div>
      </section>
      <section v-if="inactivePools.length > 0" class="pool-section">
        <h2 class="section-title">Inactive</h2>
        <div class="pools-grid">
          <div
            v-for="pool in inactivePools"
            :key="pool.stakingPool"
            class="pool-card card"
            @click="$emit('select-pool', pool)"
          >
            <div class="pool-header">
              <h3>{{ pool.name || (pool.validator?.index != null ? `Validator ${pool.validator.index}` : 'Staking Pool') }}</h3>
              <span :class="['status-badge', getStatusClass(pool)]">{{ getStatusLabel(pool) }}</span>
            </div>
            <div class="pool-info">
              <div class="info-row">
                <span class="label">Assets:</span>
                <span class="value">{{ formatNumber(pool.totalAssets) }} BERA</span>
              </div>
              <div v-if="hasUserPosition(pool)" class="info-row">
                <span class="label">Your Position:</span>
                <span class="value position-value"><span class="position-assets">{{ formatNumber(pool.userAssets) }} BERA</span></span>
              </div>
            </div>
            <button :class="['btn', getViewButtonClass(pool), 'btn-block']">{{ getViewButtonLabel(pool) }}</button>
          </div>
        </div>
      </section>
      <section v-if="exitedPools.length > 0" class="pool-section">
        <h2 class="section-title">Exited</h2>
        <div class="pools-grid">
          <div
            v-for="pool in exitedPools"
            :key="pool.stakingPool"
            class="pool-card card"
            @click="$emit('select-pool', pool)"
          >
            <div class="pool-header">
              <h3>{{ pool.name || (pool.validator?.index != null ? `Validator ${pool.validator.index}` : 'Staking Pool') }}</h3>
              <span :class="['status-badge', getStatusClass(pool)]">{{ getStatusLabel(pool) }}</span>
            </div>
            <div class="pool-info">
              <div class="info-row">
                <span class="label">Assets:</span>
                <span class="value">{{ formatNumber(pool.totalAssets) }} BERA</span>
              </div>
              <div v-if="hasUserPosition(pool)" class="info-row">
                <span class="label">Your Position:</span>
                <span class="value position-value"><span class="position-assets">{{ formatNumber(pool.userAssets) }} BERA</span></span>
              </div>
            </div>
            <button :class="['btn', getViewButtonClass(pool), 'btn-block']">{{ getViewButtonLabel(pool) }}</button>
          </div>
        </div>
      </section>
      <section v-if="deadPools.length > 0" class="pool-section">
        <h2 class="section-title">Dead</h2>
        <div class="pools-grid">
          <div
            v-for="pool in deadPools"
            :key="pool.stakingPool"
            :class="['pool-card', 'card', 'dead']"
            @click="$emit('select-pool', pool)"
          >
            <div class="pool-header">
              <h3>{{ pool.name || (pool.validator?.index != null ? `Validator ${pool.validator.index}` : 'Staking Pool') }}</h3>
              <span :class="['status-badge', getStatusClass(pool)]">{{ getStatusLabel(pool) }}</span>
            </div>
            <div class="pool-info">
              <div class="info-row">
                <span class="label">Assets:</span>
                <span class="value">{{ formatNumber(pool.totalAssets) }} BERA</span>
              </div>
              <div v-if="hasUserPosition(pool)" class="info-row">
                <span class="label">Your Position:</span>
                <span class="value position-value"><span class="position-assets">{{ formatNumber(pool.userAssets) }} BERA</span></span>
              </div>
            </div>
            <button :class="['btn', getViewButtonClass(pool), 'btn-block']">{{ getViewButtonLabel(pool) }}</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatNumber } from '../utils/format.js'
import { DEAD_POOL_THRESHOLD_WEI } from '../constants/thresholds.js'

const props = defineProps({
  pools: { type: Array, default: () => [] },
  isLoading: { type: Boolean, default: false },
  error: { type: String, default: null }
})

defineEmits(['select-pool', 'retry'])

function isDeadPool(pool) {
  if (pool?.isDead === true) return true
  if (pool?.totalAssetsWei) {
    try {
      return pool?.isFullyExited && BigInt(pool.totalAssetsWei) < DEAD_POOL_THRESHOLD_WEI
    } catch {
      // fall through
    }
  }
  if (!pool?.isFullyExited) return false
  const deadThresholdBera = Number(DEAD_POOL_THRESHOLD_WEI) / 1e18
  const staked = parseFloat(pool?.totalAssets)
  return Number.isFinite(staked) && staked < deadThresholdBera
}

const activePools = computed(() =>
  props.pools.filter(p => !isDeadPool(p) && !p.isFullyExited && p.isActive)
)
const inactivePools = computed(() =>
  props.pools.filter(p => !isDeadPool(p) && !p.isFullyExited && !p.isActive)
)
const exitedPools = computed(() =>
  props.pools.filter(p => !isDeadPool(p) && p.isFullyExited)
)
const deadPools = computed(() =>
  props.pools.filter(p => isDeadPool(p))
)

function hasUserPosition(pool) {
  const deadThresholdBera = Number(DEAD_POOL_THRESHOLD_WEI) / 1e18
  const raw = pool?.userAssetsWei
  try {
    if (typeof raw === 'bigint') return raw >= DEAD_POOL_THRESHOLD_WEI
    if (typeof raw === 'string') return BigInt(raw) >= DEAD_POOL_THRESHOLD_WEI
  } catch {
    // Fall through to float path.
  }
  const n = Number(pool?.userAssets)
  return Number.isFinite(n) && n >= deadThresholdBera
}


function getStatusLabel(pool) {
  if (isDeadPool(pool)) return 'Dead'
  if (pool.isFullyExited) return 'Exited'
  return pool.isActive ? 'Active' : 'Inactive'
}

function getStatusClass(pool) {
  if (isDeadPool(pool)) return 'dead'
  if (pool.isFullyExited) return 'exited'
  return pool.isActive ? 'active' : 'inactive'
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
  padding: 0;
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

.pools-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.pool-section .section-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0 0 var(--space-4) 0;
  color: var(--color-text-secondary);
}

.pools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
}

.pool-card {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
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
  background: rgba(34, 197, 94, 0.1);
  color: var(--color-success);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-badge.inactive {
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}

.status-badge.exited {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
  border: 1px solid rgba(239, 68, 68, 0.3);
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
  flex-grow: 1;
}

.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-2);
  gap: var(--space-3);
  align-items: baseline;
}

.info-row .label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.info-row .value {
  font-weight: 600;
  font-size: var(--font-size-sm);
}

.position-value {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.position-shares {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.position-assets {
  color: var(--color-accent);
  font-weight: 700;
}

.position-sep {
  color: var(--color-text-muted);
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
