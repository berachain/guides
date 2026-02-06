<template>
  <div
    v-if="address"
    ref="overlayRef"
    class="drawer-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="drawer-title"
    @keydown.esc="$emit('close')"
    @focusout="onFocusOut"
  >
    <div class="drawer-panel" tabindex="-1">
      <div class="drawer-header">
        <h3 id="drawer-title" class="drawer-title">Shareholder detail</h3>
        <button
          ref="closeRef"
          type="button"
          class="drawer-close"
          aria-label="Close drawer"
          @click="$emit('close')"
        >
          &times;
        </button>
      </div>
      <p class="drawer-address mono">{{ address }}</p>
      <h4 class="drawer-subtitle">Transaction history</h4>
      <ul v-if="events.length > 0" class="drawer-events" aria-label="Events for this address">
        <li v-for="(ev, i) in events" :key="i" class="drawer-event-item">
          <span class="event-name">{{ ev.eventName }}</span>
          <span class="event-meta">Block {{ ev.blockNumber }}</span>
          <a
            v-if="ev.transactionHash && explorerUrl"
            :href="`${explorerUrl}/tx/${ev.transactionHash}`"
            target="_blank"
            rel="noopener noreferrer"
            class="event-tx-link"
          >
            View tx
          </a>
        </li>
      </ul>
      <p v-else class="placeholder-text">No events for this address in cache.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  address: { type: String, default: null },
  events: { type: Array, default: () => [] },
  explorerUrl: { type: String, default: '' }
})

defineEmits(['close'])

const overlayRef = ref(null)
const closeRef = ref(null)

watch(() => props.address, (addr) => {
  if (addr) {
    setTimeout(() => closeRef.value?.focus(), 0)
  }
})

function onFocusOut(e) {
  if (!props.address || !overlayRef.value) return
  const next = e.relatedTarget
  if (next && overlayRef.value.contains(next)) return
  closeRef.value?.focus()
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: var(--space-4);
}

.drawer-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  max-width: 480px;
  width: 100%;
  max-height: 80vh;
  overflow: auto;
  padding: var(--space-4);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-3);
}

.drawer-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.drawer-close {
  width: 44px;
  height: 44px;
  border: none;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: 1.5rem;
  line-height: 1;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.drawer-close:hover {
  background: var(--color-bg-card-hover);
}

.drawer-close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.drawer-address {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  word-break: break-all;
  margin: 0 0 var(--space-4) 0;
}

.drawer-subtitle {
  font-size: var(--font-size-base);
  font-weight: 600;
  margin: 0 0 var(--space-2) 0;
  color: var(--color-text-primary);
}

.drawer-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.drawer-event-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.event-name {
  font-weight: 500;
  color: var(--color-text-primary);
}

.event-meta {
  color: var(--color-text-muted);
}

.event-tx-link {
  color: var(--color-accent);
  text-decoration: none;
  margin-left: auto;
}

.event-tx-link:hover {
  text-decoration: underline;
}

.event-tx-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.placeholder-text {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin: 0;
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, monospace;
}
</style>
