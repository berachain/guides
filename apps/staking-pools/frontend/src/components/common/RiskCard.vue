<template>
  <div class="risk-card">
    <div class="risk-label-row">
      <span class="risk-label">{{ label }}</span>
      <button
        type="button"
        class="info-btn"
        :aria-expanded="showMath"
        :aria-controls="mathId"
        :aria-label="'Show ' + label.toLowerCase() + ' math'"
        @click="$emit('toggle-math')"
      >
        &#9432;
      </button>
    </div>
    <slot />
    <span class="risk-hint">{{ hint }}</span>
    <div
      v-if="showMath"
      :id="mathId"
      class="info-pop"
      role="note"
    >
      <div class="info-pop-title">Math</div>
      <div class="mono info-pop-body">{{ math }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  math: { type: String, default: '' },
  mathId: { type: String, required: true },
  showMath: { type: Boolean, default: false }
})

defineEmits(['toggle-math'])
</script>

<style scoped>
.risk-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.risk-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.risk-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.info-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  padding: 0 var(--space-2);
  height: 24px;
  border-radius: var(--radius-full);
  cursor: pointer;
  line-height: 1;
}

.info-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
}

.info-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.risk-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.info-pop {
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
}

.info-pop-title {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-bottom: var(--space-2);
}

.info-pop-body {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.3;
  word-break: break-word;
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, monospace;
}
</style>
