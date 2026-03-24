<script setup lang="ts">
import type { HelpArticleAudience } from '@/data/help-articles'
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { buildHelpRoute } from '@/data/help-articles'

const props = withDefaults(defineProps<{
  article: string
  audience?: HelpArticleAudience | 'recommended'
  section?: string
  label?: string
  iconClass?: string
  variant?: string
  size?: string
  ghost?: boolean
}>(), {
  audience: 'recommended',
  label: '查看帮助',
  iconClass: 'i-carbon-help',
  variant: 'secondary',
  size: 'sm',
  ghost: false,
})

const linkTarget = computed(() => buildHelpRoute({
  article: props.article,
  audience: props.audience,
  section: props.section,
}))
const resolvedVariant = computed(() => props.ghost ? 'ghost' : props.variant)
</script>

<template>
  <BaseButton
    :to="linkTarget"
    :variant="resolvedVariant as any"
    :size="size as any"
  >
    <div class="mr-1.5" :class="iconClass" />
    {{ label }}
  </BaseButton>
</template>
