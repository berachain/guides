<template>
  <div class="stake-view">
    <div v-if="hubBoostUrl" class="view-links">
      <a class="hub-link" :href="hubBoostUrl" target="_blank" rel="noreferrer">
        View validator on Hub
      </a>
    </div>

    <!-- Stats Row -->
    <div class="stats-row">
      <StatCard
        label="Pool Assets"
        :value="formattedTotalAssets + ' BERA'"
        icon="📊"
      />
      <StatCard
        label="stBERA Rate"
        :value="'1 BERA = ' + exchangeRateDisplay + ' stBERA'"
        icon="🔄"
      />
      <StatCard
        label="Status"
        :value="poolStatusLabel"
        :value-class="poolStatusClass"
        icon="⚡"
      />
    </div>
    
    <!-- Delegation Badge -->
    <div v-if="formattedTotalDelegation" class="delegation-badge">
      Delegation {{ formattedTotalDelegation }}
    </div>
    
    <!-- Stake + Position Cards -->
    <div class="two-column">
      <StakeCard
        :is-connected="isConnected"
        :is-exited="isFullyExited"
        :is-loading="isLoading"
        :wallet-balance="walletBalance"
        :explorer-url="explorerUrl"
        @connect="$emit('connect')"
        @stake="(amount, handlers) => $emit('stake', amount, handlers)"
        @preview="(amount, cb) => $emit('previewDeposit', amount, cb)"
      />
      
      <PositionCard
        :is-connected="isConnected"
        :formatted-shares="formattedUserShares"
        :formatted-assets="formattedUserAssets"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import StatCard from '../components/common/StatCard.vue'
import StakeCard from '../components/stake/StakeCard.vue'
import PositionCard from '../components/stake/PositionCard.vue'

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  walletBalance: { type: String, default: '0' },
  explorerUrl: { type: String, default: 'https://berascan.com' },
  hubBoostUrl: { type: String, default: null },
  formattedTotalAssets: { type: String, default: '0' },
  exchangeRate: { type: Number, default: 1 },
  poolStatus: { type: String, default: 'active' },
  isFullyExited: { type: Boolean, default: false },
  formattedUserShares: { type: String, default: '0' },
  formattedUserAssets: { type: String, default: '0' },
  formattedTotalDelegation: { type: String, default: null }
})

defineEmits(['connect', 'stake', 'previewDeposit'])

const exchangeRateDisplay = computed(() => {
  if (props.exchangeRate === 0) return '—'
  return (1 / props.exchangeRate).toFixed(4)
})

const poolStatusLabel = computed(() => {
  switch (props.poolStatus) {
    case 'active': return 'Active'
    case 'inactive': return 'Inactive'
    case 'exited': return 'Exited'
    default: return props.poolStatus
  }
})

const poolStatusClass = computed(() => {
  switch (props.poolStatus) {
    case 'active': return 'text-success'
    case 'inactive': return 'text-warning'
    case 'exited': return 'text-error'
    default: return ''
  }
})
</script>

<style scoped>
.stake-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.view-links {
  display: flex;
  justify-content: flex-end;
}

.hub-link {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-decoration: none;
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.hub-link:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
  background: var(--color-bg-card);
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}

.two-column {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
}

.delegation-badge {
  display: inline-block;
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: 1fr;
  }
  
  .two-column {
    grid-template-columns: 1fr;
  }
}
</style>
