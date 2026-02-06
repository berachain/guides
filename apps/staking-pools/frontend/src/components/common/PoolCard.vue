<template>
  <div
    :class="['pool-card', 'card', { dead: isDead }]"
    @click="$emit('select', pool)"
  >
    <div class="pool-header">
      <h3>{{ pool.name || (pool.validator?.index != null ? `Validator ${pool.validator.index}` : 'Staking Pool') }}</h3>
      <span :class="['status-badge', statusClass]">{{ statusLabel }}</span>
    </div>
    <div class="pool-info">
      <div class="info-row">
        <span class="label">Assets:</span>
        <span class="value">{{ formatNumber(pool.totalAssets) }} BERA</span>
      </div>
      <div v-if="showUserPosition" class="info-row">
        <span class="label">Your Position:</span>
        <span class="value position-value"><span class="position-assets">{{ formatNumber(pool.userAssets) }} BERA</span></span>
      </div>
    </div>
    <button :class="['btn', viewButtonClass, 'btn-block']">{{ viewButtonLabel }}</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatNumber } from '../../utils/format.js'
import { DEAD_POOL_THRESHOLD_WEI } from '../../constants/thresholds.js'

const props = defineProps({
  pool: { type: Object, required: true }
})

defineEmits(['select'])

const isDead = computed(() => {
  const pool = props.pool
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
})

const showUserPosition = computed(() => {
  const pool = props.pool
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
})

const statusLabel = computed(() => {
  if (isDead.value) return 'Dead'
  if (props.pool.isFullyExited) return 'Exited'
  return props.pool.isActive ? 'Active' : 'Inactive'
})

const statusClass = computed(() => {
  if (isDead.value) return 'dead'
  if (props.pool.isFullyExited) return 'exited'
  return props.pool.isActive ? 'active' : 'inactive'
})

const viewButtonLabel = computed(() => {
  if (isDead.value) return 'View Dead Pool'
  if (props.pool?.isFullyExited) return 'View Exited Pool'
  return 'View Pool'
})

const viewButtonClass = computed(() => {
  if (isDead.value) return 'btn-secondary'
  return 'btn-primary'
})
</script>

<style scoped>
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

.pool-card.dead {
  opacity: 0.75;
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

.position-assets {
  color: var(--color-accent);
  font-weight: 700;
}

.btn-block {
  width: 100%;
}
</style>
