<template>
  <div class="stake-view">
    <PoolDetailHeader
      :title="poolName"
      :explorer-url="explorerUrl"
      :pool-address="poolAddress"
      :validator-pubkey="validatorPubkey"
      :hub-boost-url="hubBoostUrl"
      :formatted-total-delegation="formattedTotalDelegation"
      :formatted-total-assets="formattedTotalAssets"
      :exchange-rate="exchangeRate"
      :pool-status="poolStatus"
      :incentive-collector="incentiveCollector"
      :formatted-incentive-payout-amount="formattedIncentivePayoutAmount"
      :formatted-incentive-fee-percentage="formattedIncentiveFeePercentage"
    />

    <div class="summary-row">
      <StatCard
        label="Assets"
        :value="formattedTotalAssets + ' BERA'"
        variant="panel"
      />
      <PositionCard
        :is-connected="isConnected"
        :formatted-shares="formattedUserShares"
        :formatted-assets="formattedUserAssets"
      />
    </div>

    <!-- Stake Card -->
    <div class="single-column">
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
    </div>
  </div>
</template>

<script setup>
import StatCard from '../components/common/StatCard.vue'
import PoolDetailHeader from '../components/common/PoolDetailHeader.vue'
import StakeCard from '../components/stake/StakeCard.vue'
import PositionCard from '../components/stake/PositionCard.vue'

const props = defineProps({
  poolName: { type: String, default: null },
  poolAddress: { type: String, default: null },
  validatorPubkey: { type: String, default: null },
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  walletBalance: { type: String, default: '0' },
  explorerUrl: { type: String, default: 'https://berascan.com' },
  hubBoostUrl: { type: String, default: null },
  incentiveCollector: { type: String, default: null },
  formattedIncentivePayoutAmount: { type: String, default: null },
  formattedIncentiveFeePercentage: { type: String, default: null },
  formattedTotalAssets: { type: String, default: '0' },
  exchangeRate: { type: Number, default: 1 },
  poolStatus: { type: String, default: 'active' },
  isFullyExited: { type: Boolean, default: false },
  formattedUserShares: { type: String, default: '0' },
  formattedUserAssets: { type: String, default: '0' },
  formattedTotalDelegation: { type: String, default: null }
})

defineEmits(['connect', 'stake', 'previewDeposit'])
</script>

<style scoped>
.stake-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.summary-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
  align-items: stretch;
}

.single-column {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
}

@media (max-width: 768px) {
  .summary-row {
    grid-template-columns: 1fr;
  }

  .single-column {
    grid-template-columns: 1fr;
  }
}
</style>
