<template>
  <div class="card delegate-card">
    <h3 class="card-title">Delegate BERA</h3>
    
    <div v-if="!isConnected" class="connect-prompt">
      <p class="text-secondary">Connect your wallet to delegate</p>
      <button class="btn btn-primary" @click="$emit('connect')">Connect Wallet</button>
    </div>
    
    <template v-else>
      <div class="info-banner">
        <p>Delegate your BERA to earn staking rewards through the pool operator's validator.</p>
      </div>
      
      <div class="input-group">
        <div class="input-header">
          <label class="label">Amount to delegate</label>
          <span class="balance text-muted">Balance: {{ walletBalance }} BERA</span>
        </div>
        
        <div class="input-wrapper">
          <input
            type="number"
            class="input amount-input"
            v-model="amount"
            placeholder="0.0"
            step="0.01"
            min="0"
          />
          <button 
            v-if="parseFloat(walletBalance) > 0" 
            class="max-btn"
            @click="setMax"
          >
            MAX
          </button>
          <span class="input-suffix">BERA</span>
        </div>
      </div>
      
      <button
        class="btn btn-primary delegate-btn"
        @click="handleDelegate"
        :disabled="!canDelegate"
      >
        <span v-if="isLoading">Delegating...</span>
        <span v-else>Delegate</span>
      </button>
      
      <p class="info-text text-muted">
        Delegated funds are managed by the pool operator. You can undelegate at any time.
      </p>
      
      <div v-if="error" class="error-message">{{ error }}</div>
      <div v-if="txHash" class="success-message">
        Delegation successful! 
        <a :href="explorerUrl + '/tx/' + txHash" target="_blank" rel="noopener">View tx</a>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  walletBalance: { type: String, default: '0' },
  explorerUrl: { type: String, default: 'https://berascan.com' }
})

const emit = defineEmits(['connect', 'delegate'])

const amount = ref('')
const error = ref(null)
const txHash = ref(null)

const canDelegate = computed(() => {
  if (!props.isConnected) return false
  if (props.isLoading) return false
  if (!amount.value || parseFloat(amount.value) <= 0) return false
  if (parseFloat(amount.value) > parseFloat(props.walletBalance)) return false
  return true
})

function setMax() {
  const balance = parseFloat(props.walletBalance)
  const maxAmount = Math.max(0, balance - 0.01).toFixed(4)
  amount.value = maxAmount
}

async function handleDelegate() {
  error.value = null
  txHash.value = null
  
  try {
    const result = await new Promise((resolve, reject) => {
      emit('delegate', amount.value, { resolve, reject })
    })
    txHash.value = result.hash
    amount.value = ''
  } catch (err) {
    error.value = err.message || 'Delegation failed'
  }
}
</script>

<style scoped>
.delegate-card {
  height: fit-content;
}

.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0 0 var(--space-4) 0;
}

.connect-prompt {
  text-align: center;
  padding: var(--space-4) 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: center;
}

.info-banner {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  margin-bottom: var(--space-4);
}

.info-banner p {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
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
}

.input-suffix {
  position: absolute;
  right: var(--space-4);
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.delegate-btn {
  width: 100%;
  padding: var(--space-4);
  font-size: var(--font-size-lg);
}

.info-text {
  margin-top: var(--space-3);
  font-size: var(--font-size-sm);
  text-align: center;
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
