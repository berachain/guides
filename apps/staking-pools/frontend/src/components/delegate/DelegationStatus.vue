<template>
  <div class="card delegation-status">
    <h3 class="card-title">Delegation Status</h3>
    
    <div v-if="!isConnected" class="empty-state">
      <p class="text-secondary">Connect wallet to view delegation status</p>
    </div>
    
    <div v-else-if="!isDelegated" class="empty-state">
      <p class="text-secondary">No active delegation</p>
    </div>
    
    <template v-else>
      <div class="status-grid">
        <div class="status-item">
          <span class="status-label">Status</span>
          <span class="badge badge-success">Active</span>
        </div>
        <div class="status-item">
          <span class="status-label">Delegated Amount</span>
          <span class="status-value">{{ formattedDelegatedAmount }} BERA</span>
        </div>
        <div class="status-item" v-if="stakingPoolAddress">
          <span class="status-label">Staking Pool</span>
          <a 
            :href="explorerUrl + '/address/' + stakingPoolAddress" 
            target="_blank" 
            rel="noopener"
            class="address-link"
          >
            {{ shortenAddress(stakingPoolAddress) }}
          </a>
        </div>
      </div>
      
      <div class="actions">
        <button
          class="btn btn-secondary"
          @click="handleUndelegate"
          :disabled="isLoading"
        >
          {{ isLoading ? 'Processing...' : 'Undelegate' }}
        </button>
        
        <button
          class="btn btn-outline"
          @click="handleRequestWithdrawal"
          :disabled="isLoading"
        >
          Request Withdrawal
        </button>
      </div>
      
      <div class="withdraw-section" v-if="showWithdrawInput">
        <div class="input-group">
          <label class="label">Amount to withdraw</label>
          <div class="input-wrapper">
            <input
              type="number"
              class="input"
              v-model="withdrawAmount"
              placeholder="0.0"
              step="0.01"
            />
            <span class="input-suffix">BERA</span>
          </div>
        </div>
        <button
          class="btn btn-primary"
          @click="handleWithdraw"
          :disabled="!canWithdraw || isLoading"
        >
          Withdraw
        </button>
      </div>
      
      <div v-if="error" class="error-message">{{ error }}</div>
      <div v-if="txHash" class="success-message">
        Transaction successful! 
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
  isDelegated: { type: Boolean, default: false },
  formattedDelegatedAmount: { type: String, default: '0' },
  stakingPoolAddress: { type: String, default: null },
  explorerUrl: { type: String, default: 'https://berascan.com' }
})

const emit = defineEmits(['undelegate', 'withdraw', 'requestWithdrawal'])

const showWithdrawInput = ref(false)
const withdrawAmount = ref('')
const error = ref(null)
const txHash = ref(null)

const canWithdraw = computed(() => {
  return withdrawAmount.value && parseFloat(withdrawAmount.value) > 0
})

function shortenAddress(addr) {
  if (!addr) return ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

async function handleUndelegate() {
  error.value = null
  txHash.value = null
  
  try {
    const result = await new Promise((resolve, reject) => {
      emit('undelegate', { resolve, reject })
    })
    txHash.value = result.hash
  } catch (err) {
    error.value = err.message || 'Undelegate failed'
  }
}

function handleRequestWithdrawal() {
  showWithdrawInput.value = !showWithdrawInput.value
}

async function handleWithdraw() {
  error.value = null
  txHash.value = null
  
  try {
    const result = await new Promise((resolve, reject) => {
      emit('withdraw', withdrawAmount.value, { resolve, reject })
    })
    txHash.value = result.hash
    withdrawAmount.value = ''
    showWithdrawInput.value = false
  } catch (err) {
    error.value = err.message || 'Withdraw failed'
  }
}
</script>

<style scoped>
.delegation-status {
  height: fit-content;
}

.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0 0 var(--space-4) 0;
}

.empty-state {
  padding: var(--space-4) 0;
  text-align: center;
}

.status-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
}

.status-item:last-child {
  border-bottom: none;
}

.status-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.status-value {
  font-weight: 600;
}

.address-link {
  font-family: monospace;
  font-size: var(--font-size-sm);
  color: var(--color-accent);
  text-decoration: none;
}

.address-link:hover {
  text-decoration: underline;
}

.actions {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.actions .btn {
  flex: 1;
}

.withdraw-section {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.input-wrapper {
  position: relative;
}

.input-wrapper .input {
  padding-right: 60px;
}

.input-suffix {
  position: absolute;
  right: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.error-message {
  padding: var(--space-3);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: var(--font-size-sm);
}

.success-message {
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
