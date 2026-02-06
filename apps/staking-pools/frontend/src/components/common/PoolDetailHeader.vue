<template>
  <div class="pool-detail-header">
    <div class="top-row">
      <div class="title-block">
        <div class="title-row">
          <h1 class="title">{{ titleText }}</h1>
          <span v-if="poolStatusLabel" :class="['status-pill', poolStatusClass]">
            {{ poolStatusLabel }}
          </span>
        </div>
        <div v-if="exchangeRateDisplay" class="subline">
          1 stBERA = {{ exchangeRateDisplay }} BERA
        </div>
      </div>
    </div>

    <details v-if="hasDetails" class="details">
      <summary class="details-summary">Details</summary>
      <div class="details-body">
        <div v-if="validatorPubkey" class="detail-item">
          <div class="detail-label">Validator Pubkey</div>
          <div class="detail-value">
            <a v-if="hubBoostUrl" class="code-link" :href="hubBoostUrl" target="_blank" rel="noreferrer">
              <code class="code">{{ shortValidatorPubkey }}</code>
            </a>
            <code v-else class="code">{{ shortValidatorPubkey }}</code>
            <button class="copy-btn" type="button" @click="copyText(validatorPubkey)">
              {{ copiedKey === 'pubkey' ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>

        <div v-if="poolAddress" class="detail-item">
          <div class="detail-label">Pool Address</div>
          <div class="detail-value">
            <a v-if="poolExplorerUrl" class="code-link" :href="poolExplorerUrl" target="_blank" rel="noreferrer">
              <code class="code">{{ shortPoolAddress }}</code>
            </a>
            <code v-else class="code">{{ shortPoolAddress }}</code>
            <button class="copy-btn" type="button" @click="copyText(poolAddress)">
              {{ copiedKey === 'pool' ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>

        <div v-if="formattedTotalDelegation" class="detail-item">
          <div class="detail-label">Delegation</div>
          <div class="detail-value">{{ formattedTotalDelegation }}</div>
        </div>

        <div v-if="incentiveCollector" class="detail-item detail-item-multiline">
          <div class="detail-label">
            IncentiveCollector
            <a class="docs-link" :href="docsUrl('IncentiveCollector')" target="_blank" rel="noreferrer" title="Docs">ⓘ</a>
          </div>
          <div class="detail-value detail-value-multiline">
            <div class="detail-value-row">
              <a v-if="addressExplorerUrl(incentiveCollector)" class="code-link" :href="addressExplorerUrl(incentiveCollector)" target="_blank" rel="noreferrer">
                <code class="code">{{ shortAddress(incentiveCollector) }}</code>
              </a>
              <code v-else class="code">{{ shortAddress(incentiveCollector) }}</code>
              <button class="copy-btn" type="button" @click="copyText(incentiveCollector)">
                {{ copiedKey === 'incentiveCollector' ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <div v-if="formattedIncentivePayoutAmount || formattedIncentiveFeePercentage" class="detail-subtext">
              <span v-if="formattedIncentivePayoutAmount && formattedIncentiveFeePercentage">
                Pay {{ formattedIncentivePayoutAmount }} to get accumulated incentives, less {{ formattedIncentiveFeePercentage }} fee.
              </span>
              <span v-else-if="formattedIncentivePayoutAmount">
                Pay {{ formattedIncentivePayoutAmount }} to get accumulated incentives.
              </span>
              <span v-else>
                Fee {{ formattedIncentiveFeePercentage }} applies when claiming incentives.
              </span>
              <a
                class="subdocs-link"
                :href="docsUrl('IncentiveCollector') + '#claim'"
                target="_blank"
                rel="noreferrer"
              >
                Claim docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { shortAddress } from '../../utils/format.js'

const props = defineProps({
  title: { type: String, default: null },
  explorerUrl: { type: String, default: null },
  poolAddress: { type: String, default: null },
  validatorPubkey: { type: String, default: null },
  hubBoostUrl: { type: String, default: null },
  formattedTotalDelegation: { type: String, default: null },
  formattedTotalAssets: { type: String, default: null },
  exchangeRate: { type: Number, default: 0 },
  poolStatus: { type: String, default: null },
  incentiveCollector: { type: String, default: null },
  formattedIncentivePayoutAmount: { type: String, default: null },
  formattedIncentiveFeePercentage: { type: String, default: null }
})

const titleText = computed(() => props.title || 'Staking Pool')

const exchangeRateDisplay = computed(() => {
  if (!props.exchangeRate || props.exchangeRate === 0) return null
  return props.exchangeRate.toFixed(4)
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
    case 'active': return 'status-pill-success'
    case 'inactive': return 'status-pill-warning'
    case 'exited': return 'status-pill-error'
    default: return ''
  }
})

const copiedKey = ref(null)

const shortPoolAddress = computed(() => {
  return shortAddress(props.poolAddress, 6, 4)
})

const shortValidatorPubkey = computed(() => {
  return shortAddress(props.validatorPubkey, 10, 6)
})

const poolExplorerUrl = computed(() => {
  if (!props.explorerUrl || !props.poolAddress) return null
  return `${props.explorerUrl.replace(/\/$/, '')}/address/${props.poolAddress}`
})

const hasDetails = computed(() => {
  return Boolean(
    props.validatorPubkey ||
      props.poolAddress ||
      props.formattedTotalDelegation ||
      props.incentiveCollector ||
      props.formattedIncentivePayoutAmount ||
      props.formattedIncentiveFeePercentage
  )
})

function addressExplorerUrl(address) {
  if (!props.explorerUrl || !address) return null
  return `${props.explorerUrl.replace(/\/$/, '')}/address/${address}`
}

function docsUrl(contractName) {
  let base = 'https://docs.berachain.com'
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      base = 'http://localhost:5173'
    }
  }
  return `${base}/nodes/staking-pools/contracts/${encodeURIComponent(contractName)}`
}

async function copyText(text) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    // heuristic: infer key from the exact value we copied
    if (text === props.poolAddress) copiedKey.value = 'pool'
    else if (text === props.validatorPubkey) copiedKey.value = 'pubkey'
    else if (text === props.incentiveCollector) copiedKey.value = 'incentiveCollector'
    else copiedKey.value = 'other'
    window.setTimeout(() => {
      copiedKey.value = null
    }, 1000)
  } catch {
    // Intentionally ignore: clipboard may be unavailable (non-secure context, permissions, etc).
  }
}
</script>

<style scoped>
.pool-detail-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.top-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
}

.title-block {
  min-width: 0;
}

.title-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.title {
  margin: 0;
  font-size: var(--font-size-2xl);
  line-height: 1.1;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.status-pill {
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
}

.status-pill-success {
  border-color: rgba(34, 197, 94, 0.35);
  color: var(--color-success);
  background: rgba(34, 197, 94, 0.12);
}

.status-pill-warning {
  border-color: rgba(234, 179, 8, 0.35);
  color: var(--color-warning);
  background: rgba(234, 179, 8, 0.12);
}

.status-pill-error {
  border-color: rgba(239, 68, 68, 0.35);
  color: var(--color-error);
  background: rgba(239, 68, 68, 0.12);
}

.subline {
  margin-top: var(--space-2);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  min-width: 0;
}

.copy-btn {
  flex: 0 0 auto;
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.copy-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
  background: var(--color-bg-card);
}

.copy-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.details {
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
}

.details-summary {
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.details-body {
  margin-top: var(--space-3);
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-2);
}

.detail-item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  align-items: center;
}

.detail-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.detail-value {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
}

.detail-item-multiline {
  align-items: flex-start;
}

.detail-value-multiline {
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.detail-value-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.detail-subtext {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.2;
}

.subdocs-link {
  text-decoration: none;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  background: var(--color-bg-input);
  padding: 0 6px;
  border-radius: var(--radius-sm);
  line-height: 18px;
  font-size: var(--font-size-xs);
}

.subdocs-link:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
  background: var(--color-bg-card);
}

.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.code-link {
  text-decoration: none;
  color: inherit;
}

.docs-link {
  text-decoration: none;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  border: none;
  background: transparent;
  padding: 0;
  line-height: 18px;
}

.docs-link:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
  background: var(--color-bg-card);
}

@media (max-width: 768px) {
  .top-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

