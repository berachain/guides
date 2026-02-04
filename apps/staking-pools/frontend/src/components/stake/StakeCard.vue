<template>
  <div class="card stake-card">
    <h3 class="card-title">Stake BERA</h3>
    
    <div class="input-group">
      <div class="input-header">
        <label class="label">Amount</label>
        <span v-if="isConnected" class="balance text-muted">
          Balance: {{ walletBalance }} BERA
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
    </div>
    
    <button
      class="btn btn-primary stake-btn"
      @click="handleStake"
      :disabled="!canStake"
    >
      <span v-if="!isConnected">Connect Wallet</span>
      <span v-else-if="isExited">Pool Exited</span>
      <span v-else-if="isLoading">Staking...</span>
      <span v-else>Stake</span>
    </button>
    
    <div v-if="error" class="error-message">
      {{ error }}
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
import { ref, computed, watch } from 'vue'
import { formatEther } from 'viem'

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
  if (!props.isConnected) return true // Show "Connect Wallet"
  if (props.isExited) return false
  if (props.isLoading) return false
  if (!amount.value || parseFloat(amount.value) <= 0) return false
  return true
})

function formatShares(shares) {
  return parseFloat(formatEther(shares)).toFixed(4)
}

function setMax() {
  // Leave a small amount for gas
  const balance = parseFloat(props.walletBalance)
  const maxAmount = Math.max(0, balance - 0.01).toFixed(4)
  amount.value = maxAmount
}

async function handleStake() {
  if (!props.isConnected) {
    emit('connect')
    return
  }
  
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
    error.value = err.message || 'Stake failed'
  }
}

// Debounced preview
let previewTimeout = null
watch(amount, (newAmount) => {
  if (previewTimeout) clearTimeout(previewTimeout)
  
  if (!newAmount || parseFloat(newAmount) <= 0) {
    previewShares.value = null
    return
  }
  
  previewTimeout = setTimeout(() => {
    emit('preview', newAmount, (shares) => {
      previewShares.value = shares
    })
  }, 300)
})
</script>

<style scoped>
.stake-card {
  height: fit-content;
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

.stake-btn {
  width: 100%;
  padding: var(--space-4);
  font-size: var(--font-size-lg);
}

.error-message {
  margin-top: var(--space-4);
  padding: var(--space-3);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: var(--font-size-sm);
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
