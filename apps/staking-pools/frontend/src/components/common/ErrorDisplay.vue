<template>
  <div v-if="error" class="error-message">
    <div class="error-summary">{{ displaySummary }}</div>
    <details v-if="displayMessage && displayMessage !== displaySummary" class="error-details">
      <summary>Technical details</summary>
      <pre class="error-full">{{ displayMessage }}</pre>
    </details>
    <div class="error-actions">
      <button v-if="onRetry" type="button" class="btn btn-secondary error-retry" @click="onRetry">Retry</button>
      <button type="button" class="error-dismiss" @click="$emit('dismiss')">Dismiss</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** Parsed error from parseError(): { message, summary } or null */
  error: { type: [Object, String], default: null },
  /** Optional retry callback */
  onRetry: { type: Function, default: null }
})

defineEmits(['dismiss'])

const displaySummary = computed(() => {
  const e = props.error
  if (!e) return ''
  if (typeof e === 'object' && e.summary) return e.summary
  if (typeof e === 'string') return e
  return e.message || 'Something went wrong.'
})

const displayMessage = computed(() => {
  const e = props.error
  if (!e) return ''
  if (typeof e === 'object' && e.message) return e.message
  return typeof e === 'string' ? e : String(e)
})
</script>

<style scoped>
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

.error-actions {
  margin-top: var(--space-3);
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.error-dismiss,
.error-retry {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.error-dismiss:hover,
.error-retry:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
}
</style>
