<template>
  <div class="delegate-view">
    <!-- Stats Row -->
    <div class="stats-row">
      <StatCard
        label="Wallet Balance"
        :value="walletBalance + ' BERA'"
        icon="💳"
      />
      <StatCard
        label="Delegated Amount"
        :value="formattedDelegatedAmount + ' BERA'"
        :value-class="isDelegated ? 'text-accent' : ''"
        icon="🔗"
      />
      <StatCard
        label="Delegation Status"
        :value="isDelegated ? 'Active' : 'None'"
        :value-class="isDelegated ? 'text-success' : ''"
        icon="📍"
      />
    </div>
    
    <!-- Delegate + Status Cards -->
    <div class="two-column">
      <DelegateCard
        :is-connected="isConnected"
        :is-loading="isLoading"
        :wallet-balance="walletBalance"
        :explorer-url="explorerUrl"
        @connect="$emit('connect')"
        @delegate="(amount, handlers) => $emit('delegate', amount, handlers)"
      />
      
      <DelegationStatus
        :is-connected="isConnected"
        :is-loading="isLoading"
        :is-delegated="isDelegated"
        :formatted-delegated-amount="formattedDelegatedAmount"
        :staking-pool-address="stakingPoolAddress"
        :explorer-url="explorerUrl"
        @undelegate="(handlers) => $emit('undelegate', handlers)"
        @withdraw="(amount, handlers) => $emit('withdraw', amount, handlers)"
      />
    </div>
  </div>
</template>

<script setup>
import StatCard from '../components/common/StatCard.vue'
import DelegateCard from '../components/delegate/DelegateCard.vue'
import DelegationStatus from '../components/delegate/DelegationStatus.vue'

defineProps({
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  walletBalance: { type: String, default: '0' },
  explorerUrl: { type: String, default: 'https://berascan.com' },
  isDelegated: { type: Boolean, default: false },
  formattedDelegatedAmount: { type: String, default: '0' },
  stakingPoolAddress: { type: String, default: null }
})

defineEmits(['connect', 'delegate', 'undelegate', 'withdraw'])
</script>

<style scoped>
.delegate-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
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

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: 1fr;
  }
  
  .two-column {
    grid-template-columns: 1fr;
  }
}
</style>
