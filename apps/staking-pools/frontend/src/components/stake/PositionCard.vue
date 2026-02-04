<template>
  <div class="card position-card">
    <h3 class="card-title">Your Position</h3>
    
    <div v-if="!isConnected" class="connect-prompt">
      <p class="text-secondary">Connect your wallet to view your position</p>
    </div>
    
    <div v-else-if="hasPosition" class="position-stats">
      <div class="stat">
        <span class="stat-label">Shares</span>
        <span class="stat-value">{{ formattedShares }} stBERA</span>
      </div>
      <div class="stat">
        <span class="stat-label">Value</span>
        <span class="stat-value text-accent">{{ formattedAssets }} BERA</span>
      </div>
    </div>
    
    <div v-else class="no-position">
      <p class="text-secondary">No staked position yet</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  formattedShares: { type: String, default: '0' },
  formattedAssets: { type: String, default: '0' }
})

const hasPosition = computed(() => {
  return props.formattedShares !== '0' && props.formattedShares !== '0.0000'
})
</script>

<style scoped>
.position-card {
  height: fit-content;
}

.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0 0 var(--space-4) 0;
}

.connect-prompt,
.no-position {
  padding: var(--space-4) 0;
  text-align: center;
}

.position-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.stat-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
}
</style>
