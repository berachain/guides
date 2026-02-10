<template>
  <div :class="['stat-card', `stat-card--${variant}`]">
    <div class="stat-icon" v-if="icon">
      <span class="icon-emoji">{{ icon }}</span>
    </div>
    <div class="stat-content">
      <component :is="variant === 'panel' ? 'h3' : 'span'" :class="['stat-label', { 'card-title': variant === 'panel' }]">
        {{ label }}
      </component>
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
  valueClass: { type: String, default: '' },
  variant: { type: String, default: 'stat' }
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

.stat-card--panel {
  padding: var(--space-6);
}

.stat-card--panel .stat-content {
  gap: var(--space-3);
}

.stat-card--panel .stat-label.card-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text-primary);
}

.stat-value {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
  white-space: pre-line;
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
