<template>
  <div class="wallet-connect">
    <button
      v-if="!isConnected"
      class="btn btn-primary"
      :disabled="isConnecting"
      @click="$emit('connect')"
    >
      {{ isConnecting ? 'Connecting...' : 'Connect Wallet' }}
    </button>
    
    <div v-else class="wallet-info">
      <span class="address">{{ shortAddress }}</span>
      <button class="btn btn-secondary btn-sm" @click="$emit('disconnect')">
        Disconnect
      </button>
    </div>
    
    <div v-if="error" class="wallet-error">{{ error }}</div>
  </div>
</template>

<script setup>
defineProps({
  isConnected: { type: Boolean, default: false },
  isConnecting: { type: Boolean, default: false },
  shortAddress: { type: String, default: '' },
  error: { type: String, default: null }
})

defineEmits(['connect', 'disconnect'])
</script>

<style scoped>
.wallet-connect {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
}

.wallet-info {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.address {
  font-family: monospace;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}

.wallet-error {
  font-size: var(--font-size-xs);
  color: var(--color-error);
}
</style>
