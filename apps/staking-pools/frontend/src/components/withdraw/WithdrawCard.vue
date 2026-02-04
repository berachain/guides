<template>
  <div class="card withdraw-card">
    <h3 class="card-title">Request Withdrawal</h3>
    
    <div v-if="!isConnected" class="connect-prompt">
      <p class="text-secondary">Connect your wallet to request withdrawals</p>
      <button class="btn btn-primary" @click="$emit('connect')">Connect Wallet</button>
    </div>
    
    <template v-else>
      <div class="available-balance">
        <span class="label">Available to withdraw</span>
        <span class="balance-value">{{ formattedShares }} stBERA</span>
        <span class="balance-subvalue text-muted">≈ {{ formattedAssets }} BERA</span>
      </div>
      
      <div class="input-group">
        <div class="input-header">
          <label class="label">Shares to redeem</label>
        </div>
        
        <div class="input-wrapper">
          <input
            type="number"
            class="input amount-input"
            v-model="sharesAmount"
            placeholder="0.0"
            step="0.0001"
            min="0"
            :disabled="!hasPosition"
          />
          <button 
            v-if="hasPosition" 
            class="max-btn"
            @click="setMax"
          >
            MAX
          </button>
          <span class="input-suffix">stBERA</span>
        </div>
        
        <div v-if="previewAssets" class="preview text-secondary">
          You will receive ≈ {{ previewAssets }} BERA after delay
        </div>
      </div>
      
      <div class="fee-info">
        <span class="label">Withdrawal fee (EIP-7002)</span>
        <span class="fee-value">{{ maxFee }} BERA</span>
      </div>
      
      <button
        class="btn btn-primary withdraw-btn"
        @click="handleRequestRedeem"
        :disabled="!canWithdraw"
      >
        <span v-if="isLoading">Requesting...</span>
        <span v-else-if="!hasPosition">No shares to withdraw</span>
        <span v-else>Request Withdrawal</span>
      </button>
      
      <p class="info-text text-muted">
        Withdrawals have a ~24 hour delay before they can be finalized.
      </p>
      
      <div v-if="error" class="error-message">{{ error }}</div>
      <div v-if="txHash" class="success-message">
        Withdrawal requested! 
        <a :href="explorerUrl + '/tx/' + txHash" target="_blank" rel="noopener">View tx</a>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { parseEther, formatEther } from 'viem'

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  userShares: { type: BigInt, default: 0n },
  formattedShares: { type: String, default: '0' },
  formattedAssets: { type: String, default: '0' },
  explorerUrl: { type: String, default: 'https://berascan.com' }
})

const emit = defineEmits(['connect', 'requestRedeem', 'previewRedeem'])

const sharesAmount = ref('')
const previewAssets = ref(null)
const error = ref(null)
const txHash = ref(null)
const maxFee = ref('0.01')

const hasPosition = computed(() => {
  return props.userShares > 0n
})

const canWithdraw = computed(() => {
  if (!props.isConnected) return false
  if (props.isLoading) return false
  if (!hasPosition.value) return false
  if (!sharesAmount.value || parseFloat(sharesAmount.value) <= 0) return false
  return true
})

function setMax() {
  sharesAmount.value = formatEther(props.userShares)
}

async function handleRequestRedeem() {
  error.value = null
  txHash.value = null
  
  try {
    const shares = parseEther(sharesAmount.value)
    const result = await new Promise((resolve, reject) => {
      emit('requestRedeem', shares, parseEther(maxFee.value), { resolve, reject })
    })
    txHash.value = result.hash
    sharesAmount.value = ''
    previewAssets.value = null
  } catch (err) {
    error.value = err.message || 'Request failed'
  }
}

// Debounced preview
let previewTimeout = null
watch(sharesAmount, (newAmount) => {
  if (previewTimeout) clearTimeout(previewTimeout)
  
  if (!newAmount || parseFloat(newAmount) <= 0) {
    previewAssets.value = null
    return
  }
  
  previewTimeout = setTimeout(() => {
    emit('previewRedeem', parseEther(newAmount), (assets) => {
      previewAssets.value = parseFloat(formatEther(assets)).toFixed(4)
    })
  }, 300)
})
</script>

<style scoped>
.withdraw-card {
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

.available-balance {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.balance-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
}

.balance-subvalue {
  font-size: var(--font-size-sm);
}

.input-group {
  margin-bottom: var(--space-4);
}

.input-header {
  margin-bottom: var(--space-2);
}

.input-wrapper {
  position: relative;
}

.amount-input {
  padding-right: 120px;
  font-size: var(--font-size-lg);
}

.max-btn {
  position: absolute;
  right: 80px;
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
  font-size: var(--font-size-sm);
}

.preview {
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
}

.fee-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-4);
}

.fee-value {
  font-weight: 500;
}

.withdraw-btn {
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
