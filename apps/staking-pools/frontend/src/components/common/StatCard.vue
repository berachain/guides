<template>
  <div class="stat-card">
    <div class="stat-icon" v-if="icon">
      <span class="icon-emoji">{{ icon }}</span>
    </div>
    <div class="stat-content">
      <span class="stat-label">{{ label }}</span>
      <span :class="['stat-value', valueClass]">{{ value }}</span>
      <span v-if="subvalue" class="stat-subvalue">{{ subvalue }}</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  subvalue: { type: String, default: '' },
  icon: { type: String, default: '' },
  valueClass: { type: String, default: '' }
})
</script>

<style scoped>
.stat-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}

.stat-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.icon-emoji {
  font-size: 1.25rem;
}

.stat-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.stat-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.stat-value.text-accent {
  color: var(--color-accent);
}

.stat-value.text-success {
  color: var(--color-success);
}

.stat-subvalue {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
</style>
