<template>
  <nav class="tab-nav">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :class="['tab-btn', { active: modelValue === tab.id }]"
      @click="$emit('update:modelValue', tab.id)"
    >
      <span v-if="tab.icon" class="tab-icon">{{ tab.icon }}</span>
      {{ tab.label }}
      <span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
    </button>
  </nav>
</template>

<script setup>
defineProps({
  tabs: {
    type: Array,
    required: true,
    // Each tab: { id: string, label: string, icon?: string, badge?: string|number }
  },
  modelValue: {
    type: String,
    required: true
  }
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.tab-nav {
  display: flex;
  gap: var(--space-2);
  background: var(--color-bg-secondary);
  padding: var(--space-2);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-6);
}

.tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tab-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-card);
}

.tab-btn.active {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
}

.tab-icon {
  font-size: var(--font-size-lg);
}

.tab-badge {
  padding: var(--space-1) var(--space-2);
  background: var(--color-accent);
  color: #000;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-width: 20px;
  text-align: center;
}

@media (max-width: 640px) {
  .tab-nav {
    flex-wrap: wrap;
  }
  
  .tab-btn {
    flex: 1 1 calc(50% - var(--space-1));
    min-width: 0;
  }
}
</style>
