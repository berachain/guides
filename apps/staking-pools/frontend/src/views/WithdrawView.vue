<template>
  <div class="withdraw-view">
    <div v-if="hubBoostUrl" class="view-links">
      <a class="hub-link" :href="hubBoostUrl" target="_blank" rel="noreferrer">
        View validator on Hub
      </a>
    </div>

    <!-- Stats Row -->
    <div class="stats-row">
      <StatCard
        label="Your Position"
        :value="formattedUserShares + ' stBERA'"
        :subvalue="'≈ ' + formattedUserAssets + ' BERA'"
        icon="💰"
      />
      <StatCard
        label="Pending Withdrawals"
        :value="String(pendingCount)"
        :subvalue="pendingCount > 0 ? 'in queue' : 'none'"
        icon="⏳"
      />
      <StatCard
        label="Ready to Claim"
        :value="String(readyCount)"
        :value-class="readyCount > 0 ? 'text-success' : ''"
        icon="✅"
      />
    </div>
    
    <!-- Withdraw Card -->
    <WithdrawCard
      :is-connected="isConnected"
      :is-loading="isLoading"
      :user-shares="userShares"
      :formatted-shares="formattedUserShares"
      :formatted-assets="formattedUserAssets"
      :explorer-url="explorerUrl"
      @connect="$emit('connect')"
      @request-redeem="(shares, fee, handlers) => $emit('requestRedeem', shares, fee, handlers)"
      @preview-redeem="(shares, cb) => $emit('previewRedeem', shares, cb)"
    />
    
    <!-- Withdrawal Queue -->
    <WithdrawQueue
      :is-connected="isConnected"
      :is-loading="isLoading"
      :requests="withdrawalRequests"
      :explorer-url="explorerUrl"
      @finalize="(id, handlers) => $emit('finalize', id, handlers)"
      @finalize-multiple="(ids, handlers) => $emit('finalizeMultiple', ids, handlers)"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import StatCard from '../components/common/StatCard.vue'
import WithdrawCard from '../components/withdraw/WithdrawCard.vue'
import WithdrawQueue from '../components/withdraw/WithdrawQueue.vue'

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  explorerUrl: { type: String, default: 'https://berascan.com' },
  hubBoostUrl: { type: String, default: null },
  userShares: { type: BigInt, default: 0n },
  formattedUserShares: { type: String, default: '0' },
  formattedUserAssets: { type: String, default: '0' },
  withdrawalRequests: { type: Array, default: () => [] }
})

defineEmits(['connect', 'requestRedeem', 'previewRedeem', 'finalize', 'finalizeMultiple'])

const pendingCount = computed(() => {
  return props.withdrawalRequests.filter(r => !r.isReady).length
})

const readyCount = computed(() => {
  return props.withdrawalRequests.filter(r => r.isReady).length
})
</script>

<style scoped>
.withdraw-view {
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

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: 1fr;
  }
}
</style>
