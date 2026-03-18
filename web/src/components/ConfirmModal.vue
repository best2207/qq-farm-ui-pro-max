<script setup lang="ts">
defineProps<{
  show: boolean
  title?: string
  message?: string
  confirmText?: string
  confirmDisabled?: boolean
  cancelText?: string
  showCancel?: boolean
  type?: 'danger' | 'primary'
  isAlert?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'close'): void
  (e: 'update:show', value: boolean): void
}>()

function handleCancel() {
  emit('cancel')
  emit('close')
  emit('update:show', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <!-- 背景遮罩 -->
      <div
        class="confirm-modal-overlay absolute inset-0 transition-opacity"
        @click="handleCancel"
      />

      <!-- 弹窗主体 -->
      <div class="confirm-modal-shell glass-panel relative max-w-sm w-full transform overflow-hidden rounded-2xl shadow-2xl transition-all" @click.stop>
        <!-- 头部 -->
        <div class="confirm-modal-header flex items-center justify-between px-6 py-4">
          <h3 class="glass-text-main text-lg font-bold">
            {{ title || '确认操作' }}
          </h3>
          <button
            class="confirm-modal-close rounded-full p-2 transition-colors"
            type="button"
            aria-label="关闭确认弹窗"
            @click="handleCancel"
          >
            <div class="i-carbon-close text-xl" />
          </button>
        </div>

        <!-- 内容区 -->
        <div class="px-6 py-6 text-center">
          <slot>
            <p class="glass-text-muted text-sm leading-relaxed">
              {{ message || '确定要执行此操作吗？' }}
            </p>
          </slot>
        </div>

        <!-- 底部操作区 -->
        <div class="confirm-modal-footer flex items-center gap-3 px-6 py-4">
          <button
            v-if="showCancel !== false && !isAlert"
            class="confirm-modal-secondary glass-text-main flex-1 rounded-xl px-4 py-2.5 text-sm font-medium shadow-sm transition-all active:scale-[0.98] focus:outline-none"
            type="button"
            :disabled="loading"
            @click="handleCancel"
          >
            {{ cancelText || '取消' }}
          </button>
          <button
            class="confirm-modal-primary flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-offset-2"
            type="button"
            :class="type === 'danger'
              ? 'confirm-modal-primary-danger'
              : 'confirm-modal-primary-brand'"
            :disabled="loading || confirmDisabled"
            @click="emit('confirm')"
          >
            <div v-if="loading" class="i-svg-spinners-ring-resize text-lg" />
            {{ confirmText || '确定' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-modal-overlay {
  background: color-mix(in srgb, var(--ui-overlay-backdrop) 84%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.confirm-modal-shell {
  border: 1px solid var(--ui-border-subtle);
}

.confirm-modal-header,
.confirm-modal-footer {
  border-color: var(--ui-border-subtle);
}

.confirm-modal-header {
  border-bottom: 1px solid var(--ui-border-subtle);
}

.confirm-modal-footer {
  border-top: 1px solid var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface) 74%, transparent);
}

.confirm-modal-close,
.confirm-modal-secondary {
  border: 1px solid var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 82%, transparent);
  color: var(--ui-text-2);
  touch-action: manipulation;
}

.confirm-modal-close:hover,
.confirm-modal-secondary:hover {
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 94%, transparent);
  color: var(--ui-text-1);
}

.confirm-modal-secondary:focus-visible {
  box-shadow: 0 0 0 2px var(--ui-focus-ring);
}

.confirm-modal-primary-brand {
  background: var(--ui-brand-500);
}

.confirm-modal-primary {
  color: var(--ui-text-on-brand);
}

.confirm-modal-primary-brand:hover {
  background: var(--ui-brand-600);
}

.confirm-modal-primary-danger {
  background: var(--ui-status-danger);
}

.confirm-modal-primary-danger:hover {
  background: color-mix(in srgb, var(--ui-status-danger) 88%, black 12%);
}
</style>
