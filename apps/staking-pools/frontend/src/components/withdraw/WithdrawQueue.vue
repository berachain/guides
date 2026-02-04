<template>
  <div class="card withdraw-queue">
    <div class="queue-header">
      <h3 class="card-title">Pending Withdrawals</h3>
      <button
        v-if="readyRequests.length > 1"
        class="btn btn-primary btn-sm"
        @click="handleFinalizeAll"
        :disabled="isLoading"
      >
        Claim All ({{ readyRequests.length }})
      </button>
    </div>
    
    <div v-if="!isConnected" class="empty-state">
      <p class="text-secondary">Connect wallet to view your withdrawals</p>
    </div>
    
    <div v-else-if="requests.length === 0" class="empty-state">
      <p class="text-secondary">No pending withdrawal requests</p>
    </div>
    
    <div v-else class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="request in requests" :key="request.id">
            <td class="id-cell">#{{ request.id }}</td>
            <td>
              <div class="amount-cell">
                <span class="amount-value">{{ formatAssets(request.assetsRequested) }}</span>
                <span class="amount-unit">BERA</span>
              </div>
            </td>
            <td>
              <span v-if="request.isReady" class="badge badge-success">Ready</span>
              <span v-else class="badge badge-warning">
                {{ formatTimeRemaining(request.estimatedTimeRemaining) }}
              </span>
            </td>
            <td>
              <button
                v-if="request.isReady"
                class="btn btn-primary btn-sm"
                @click="handleFinalize(request.id)"
                :disabled="isLoading"
              >
                Claim
              </button>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <div v-if="error" class="error-message">{{ error }}</div>
    <div v-if="txHash" class="success-message">
      Withdrawal claimed! 
      <a :href="explorerUrl + '/tx/' + txHash" target="_blank" rel="noopener">View tx</a>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { formatEther } from 'viem'

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  isLoading: { type: Boolean, default: false },
  requests: { type: Array, default: () => [] },
  explorerUrl: { type: String, default: 'https://berascan.com' }
})

const emit = defineEmits(['finalize', 'finalizeMultiple'])

const error = ref(null)
const txHash = ref(null)

const readyRequests = computed(() => {
  return props.requests.filter(r => r.isReady)
})

function formatAssets(assets) {
  return parseFloat(formatEther(assets)).toFixed(4)
}

function formatTimeRemaining(seconds) {
  if (seconds <= 0) return 'Ready'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `~${hours}h ${minutes}m`
  return `~${minutes}m`
}

async function handleFinalize(requestId) {
  error.value = null
  txHash.value = null
  
  try {
    const result = await new Promise((resolve, reject) => {
      emit('finalize', requestId, { resolve, reject })
    })
    txHash.value = result.hash
  } catch (err) {
    error.value = err.message || 'Claim failed'
  }
}

async function handleFinalizeAll() {
  error.value = null
  txHash.value = null
  
  try {
    const ids = readyRequests.value.map(r => r.id)
    const result = await new Promise((resolve, reject) => {
      emit('finalizeMultiple', ids, { resolve, reject })
    })
    txHash.value = result.hash
  } catch (err) {
    error.value = err.message || 'Claim failed'
  }
}
</script>

<style scoped>
.withdraw-queue {
  margin-top: var(--space-6);
}

.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}

.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0;
}

.empty-state {
  padding: var(--space-8) 0;
  text-align: center;
}

.id-cell {
  font-family: monospace;
  color: var(--color-text-secondary);
}

.amount-cell {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.amount-value {
  font-weight: 600;
}

.amount-unit {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
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
