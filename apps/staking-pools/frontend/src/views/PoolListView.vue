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
      <section v-for="section in poolSections" :key="section.title" class="pool-section">
        <h2 class="section-title">{{ section.title }}</h2>
        <div class="pools-grid">
          <PoolCard
            v-for="pool in section.pools"
            :key="pool.stakingPool"
            :pool="pool"
            @select="$emit('select-pool', pool)"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { DEAD_POOL_THRESHOLD_WEI } from '../constants/thresholds.js'
import PoolCard from '../components/common/PoolCard.vue'

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

const poolSections = computed(() => {
  const sections = [
    { title: 'Active', pools: props.pools.filter(p => !isDeadPool(p) && !p.isFullyExited && p.isActive) },
    { title: 'Inactive', pools: props.pools.filter(p => !isDeadPool(p) && !p.isFullyExited && !p.isActive) },
    { title: 'Exited', pools: props.pools.filter(p => !isDeadPool(p) && p.isFullyExited) },
    { title: 'Dead', pools: props.pools.filter(p => isDeadPool(p)) }
  ]
  return sections.filter(s => s.pools.length > 0)
})
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
</style>
