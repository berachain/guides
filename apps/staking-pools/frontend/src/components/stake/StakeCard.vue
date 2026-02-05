<template>
  <div class="card stake-card">
    <h3 class="card-title">Stake BERA</h3>

    <div v-if="isExited" class="exited-note">
      Pool exited; deposits are disabled.
    </div>
    
    <div class="input-group">
      <div class="input-header">
        <label class="label">Amount</label>
        <span v-if="isConnected" class="balance text-muted">
          Wallet Balance: {{ walletBalance }} BERA
        </span>
      </div>
      
      <div class="input-wrapper">
        <input
          type="number"
          class="input amount-input"
          v-model="amount"
          placeholder="0.0"
          step="0.01"
          min="0"
          :disabled="!isConnected || isExited"
        />
        <button 
          v-if="isConnected && parseFloat(walletBalance) > 0" 
          class="max-btn"
          @click="setMax"
        >
          MAX
        </button>
        <span class="input-suffix">BERA</span>
      </div>
      
    <div v-if="amount && previewShares" class="preview text-secondary">
        You will receive ≈ {{ formatShares(previewShares) }} stBERA
      </div>
    <div v-if="amountError" class="input-error">{{ amountError }}</div>
    </div>
    
    <button
      class="btn btn-primary stake-btn"
      @click="handleStake"
      :disabled="!canStake"
    >
      <span v-if="!isConnected && !isExited">Connect Wallet</span>
      <span v-else-if="isExited">Deposits Disabled</span>
      <span v-else-if="isLoading">Staking...</span>
      <span v-else>Stake</span>
    </button>
    
    <div v-if="error" class="error-message">
      <div class="error-summary">{{ errorSummary }}</div>
      <details class="error-details">
        <summary>Technical details</summary>
        <pre class="error-full">{{ errorMessage }}</pre>
      </details>
      <button type="button" class="error-dismiss" @click="error = null">Dismiss</button>
    </div>
    
    <div v-if="txHash" class="success-message">
      Staked successfully! 
      <a :href="explorerUrl + '/tx/' + txHash" target="_blank" rel="noopener">
        View transaction
      </a>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { formatEther } from 'viem'
import { validateAmount } from '../../utils/format.js'
import { parseError } from '../../utils/errors.js'
import { GAS_RESERVE_BERA, DEBOUNCE_MS } from '../../constants/thresholds.js'

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  isExited: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  walletBalance: { type: String, default: '0' },
  explorerUrl: { type: String, default: 'https://berascan.com' }
})

const emit = defineEmits(['stake', 'connect', 'preview'])

const amount = ref('')
const previewShares = ref(null)
const error = ref(null)
const txHash = ref(null)

const canStake = computed(() => {
  if (props.isExited) return false
  if (!props.isConnected) return true // Show "Connect Wallet"
  if (props.isLoading) return false
  if (!amountValidation.value.valid) return false
  return true
})

const errorSummary = computed(() => {
  const e = error.value
  if (!e) return ''
  if (typeof e === 'object' && e.summary) return e.summary
  return typeof e === 'string' ? e : 'Transaction failed.'
})
const errorMessage = computed(() => {
  const e = error.value
  if (!e) return ''
  if (typeof e === 'object' && e.message) return e.message
  return typeof e === 'string' ? e : ''
})
const amountValidation = computed(() => validateAmount(amount.value))
const amountError = computed(() => (amount.value ? amountValidation.value.error : null))

function formatShares(shares) {
  return parseFloat(formatEther(shares)).toFixed(4)
}

function setMax() {
  // Leave a small amount for gas
  const balance = parseFloat(props.walletBalance)
  const maxAmount = Math.max(0, balance - GAS_RESERVE_BERA).toFixed(4)
  amount.value = maxAmount
}

async function handleStake() {
  if (!props.isConnected) {
    emit('connect')
    return
  }
  if (!amountValidation.value.valid) return

  error.value = null
  txHash.value = null
  
  try {
    const result = await new Promise((resolve, reject) => {
      emit('stake', amount.value, { resolve, reject })
    })
    txHash.value = result.hash
    amount.value = ''
    previewShares.value = null
  } catch (err) {
    error.value = parseError(err)
  }
}

// Debounced preview
let previewTimeout = null
watch(amount, (newAmount) => {
  if (previewTimeout) clearTimeout(previewTimeout)

  const validation = validateAmount(newAmount)
  if (!validation.valid) {
    previewShares.value = null
    return
  }

  previewTimeout = setTimeout(() => {
    emit('preview', newAmount, (shares) => {
      previewShares.value = shares
    })
  }, DEBOUNCE_MS)
})

onUnmounted(() => {
  if (previewTimeout) clearTimeout(previewTimeout)
})
</script>

<style scoped>
.stake-card {
  height: fit-content;
}

.exited-note {
  margin: 0 0 var(--space-4) 0;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0 0 var(--space-4) 0;
}

.input-group {
  margin-bottom: var(--space-4);
}

.input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}

.balance {
  font-size: var(--font-size-sm);
}

.input-wrapper {
  position: relative;
}

.amount-input {
  padding-right: 110px;
  font-size: var(--font-size-xl);
  font-weight: 500;
}

.max-btn {
  position: absolute;
  right: 70px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-accent);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.max-btn:hover {
  background: var(--color-bg-card);
}

.input-suffix {
  position: absolute;
  right: var(--space-4);
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.preview {
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
}

.input-error {
  margin-top: var(--space-2);
  color: var(--color-error);
  font-size: var(--font-size-sm);
}

.stake-btn {
  width: 100%;
  padding: var(--space-4);
  font-size: var(--font-size-lg);
}

.error-message {
  margin-top: var(--space-4);
  padding: var(--space-3);
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: var(--font-size-sm);
}

.error-summary {
  font-weight: 500;
  margin-bottom: var(--space-2);
}

.error-details {
  margin-top: var(--space-2);
}

.error-details summary {
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  user-select: none;
}

.error-full {
  margin: var(--space-2) 0 0 0;
  padding: var(--space-2);
  max-height: 120px;
  overflow-y: auto;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.35;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-all;
}

.error-dismiss {
  margin-top: var(--space-3);
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.error-dismiss:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
}

.success-message {
  margin-top: var(--space-4);
  padding: var(--space-3);
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid var(--color-success);
  border-radius: var(--radius-md);
  color: var(--color-success);
  font-size: var(--font-size-sm);
}

.success-message a {
  color: inherit;
  text-decoration: underline;
}
</style>
