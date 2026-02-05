<template>
  <div class="withdraw-view">
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
    
    <!-- Withdraw + Queue -->
    <div :class="['withdraw-main', { 'with-queue': hasRequests }]">
      <WithdrawCard
        :is-connected="isConnected"
        :is-loading="isLoading"
        :user-shares="userShares"
        :formatted-shares="formattedUserShares"
        :formatted-assets="formattedUserAssets"
        :explorer-url="explorerUrl"
        :finalization-delay-blocks="finalizationDelayBlocks"
        :seconds-per-block="secondsPerBlock"
        @connect="$emit('connect')"
        @request-redeem="(shares, fee, handlers) => $emit('requestRedeem', shares, fee, handlers)"
        @preview-redeem="(shares, cb) => $emit('previewRedeem', shares, cb)"
      />
      
      <WithdrawQueue
        v-if="hasRequests"
        :is-connected="isConnected"
        :is-loading="isLoading"
        :requests="withdrawalRequests"
        :explorer-url="explorerUrl"
        @finalize="(id, handlers) => $emit('finalize', id, handlers)"
        @finalize-multiple="(ids, handlers) => $emit('finalizeMultiple', ids, handlers)"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import StatCard from '../components/common/StatCard.vue'
import PoolDetailHeader from '../components/common/PoolDetailHeader.vue'
import WithdrawCard from '../components/withdraw/WithdrawCard.vue'
import WithdrawQueue from '../components/withdraw/WithdrawQueue.vue'
import PositionCard from '../components/stake/PositionCard.vue'

const props = defineProps({
  poolName: { type: String, default: null },
  poolAddress: { type: String, default: null },
  validatorPubkey: { type: String, default: null },
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  explorerUrl: { type: String, default: 'https://berascan.com' },
  hubBoostUrl: { type: String, default: null },
  finalizationDelayBlocks: { type: [BigInt, Number], default: null },
  secondsPerBlock: { type: Number, default: 2 },
  formattedTotalDelegation: { type: String, default: null },
  formattedTotalAssets: { type: String, default: null },
  exchangeRate: { type: Number, default: 0 },
  poolStatus: { type: String, default: null },
  incentiveCollector: { type: String, default: null },
  formattedIncentivePayoutAmount: { type: String, default: null },
  formattedIncentiveFeePercentage: { type: String, default: null },
  userShares: { type: BigInt, default: 0n },
  formattedUserShares: { type: String, default: '0' },
  formattedUserAssets: { type: String, default: '0' },
  withdrawalRequests: { type: Array, default: () => [] }
})

defineEmits(['connect', 'requestRedeem', 'previewRedeem', 'finalize', 'finalizeMultiple'])

const hasRequests = computed(() => props.withdrawalRequests.length > 0)
</script>

<style scoped>
.withdraw-view {
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

.withdraw-main {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}

.withdraw-main.with-queue {
  grid-template-columns: 1fr 1fr;
}

@media (max-width: 900px) {
  .summary-row {
    grid-template-columns: 1fr;
  }

  .withdraw-main.with-queue {
    grid-template-columns: 1fr;
  }
}
</style>
