<template>
  <div class="accordion">
    <button
      type="button"
      class="accordion-trigger"
      :aria-expanded="open"
      :aria-controls="'accordion-' + id"
      :id="'accordion-' + id + '-trigger'"
      @click="$emit('toggle')"
    >
      <span class="accordion-trigger-text"><slot name="title" /></span>
      <span v-if="$slots.badge" class="accordion-trigger-count"><slot name="badge" /></span>
    </button>
    <div
      :id="'accordion-' + id"
      class="accordion-panel"
      role="region"
      :aria-labelledby="'accordion-' + id + '-trigger'"
      :hidden="!open"
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  id: { type: String, required: true },
  open: { type: Boolean, default: true }
})

defineEmits(['toggle'])
</script>

<style scoped>
.accordion {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--color-bg-card);
}

.accordion-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: none;
  cursor: pointer;
  text-align: left;
  min-height: 44px;
}

.accordion-trigger:hover {
  background: var(--color-bg-card-hover);
}

.accordion-trigger:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.accordion-trigger[aria-expanded="true"]::after {
  content: '\2212';
}

.accordion-trigger[aria-expanded="false"]::after {
  content: '+';
}

.accordion-trigger-text {
  flex: 1 1 auto;
}

.accordion-trigger-count {
  font-size: var(--font-size-sm);
  font-weight: 400;
  color: var(--color-text-muted);
  margin-right: var(--space-3);
}

.accordion-panel {
  padding: 0 var(--space-4) var(--space-4);
}

.accordion-panel[hidden] {
  display: none;
}
</style>
