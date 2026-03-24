<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import DisclaimerModal from '@/components/DisclaimerModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAppStore } from '@/stores/app'
import { adminToken, clearAuth } from '@/utils/auth'
import { localizeRuntimeText } from '@/utils/runtime-text'

const router = useRouter()
const appStore = useAppStore()

const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)
const showDisclaimer = ref(false)
const pendingAuthData = ref<any>(null)

function saveCurrentUser(user: any) {
  if (user)
    localStorage.setItem('current_user', JSON.stringify(user))
  else
    localStorage.removeItem('current_user')
}

const hasCustomBackground = computed(() => !!appStore.loginBackground.trim())

const backgroundStyle = computed(() => {
  if (hasCustomBackground.value) {
    return {
      backgroundImage: `url(${appStore.loginBackground.trim()})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return {}
})

const backgroundOverlayStyle = computed(() => ({
  backgroundColor: `color-mix(in srgb, var(--ui-overlay-backdrop) ${appStore.loginBackgroundOverlayOpacity}%, transparent)`,
  backdropFilter: `blur(${appStore.loginBackgroundBlur}px)`,
  WebkitBackdropFilter: `blur(${appStore.loginBackgroundBlur}px)`,
}))

async function ensureBootstrapStillRequired() {
  try {
    const res = await api.get('/api/auth/bootstrap-status')
    const required = !!res.data?.data?.required
    if (!required) {
      if (adminToken.value)
        router.replace({ name: 'dashboard' })
      else
        router.replace({ name: 'login' })
    }
  }
  catch {
    // 保持页面可用，避免网络抖动时把用户卡死
  }
}

function validatePasswordForm() {
  if (!password.value.trim()) {
    error.value = '请输入管理员密码'
    return false
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return false
  }
  if (password.value.length < 8) {
    error.value = '管理员密码至少需要 8 位'
    return false
  }
  return true
}

async function handleInitPassword() {
  if (!validatePasswordForm())
    return

  loading.value = true
  error.value = ''
  try {
    const res = await api.post('/api/auth/init-password', {
      password: password.value,
    })
    if (res.data?.ok) {
      pendingAuthData.value = res.data.data
      showDisclaimer.value = true
      return
    }
    error.value = localizeRuntimeText(res.data?.error || '初始化失败')
  }
  catch (e: any) {
    error.value = localizeRuntimeText(e.response?.data?.error || e.message || '初始化失败')
  }
  finally {
    loading.value = false
  }
}

function onDisclaimerAgree() {
  if (!pendingAuthData.value)
    return

  const authData = pendingAuthData.value
  const user = authData.user
  adminToken.value = user?.username || 'admin'
  saveCurrentUser(user)
  pendingAuthData.value = null
  showDisclaimer.value = false
  router.replace({ name: 'dashboard' })
}

function onDisclaimerDecline() {
  pendingAuthData.value = null
  showDisclaimer.value = false
  clearAuth()
  error.value = '您已拒绝免责声明协议，无法继续使用本软件。'
}

onMounted(async () => {
  await appStore.fetchUIConfig()
  await ensureBootstrapStillRequired()

  document.documentElement.style.overflow = 'auto'
  document.documentElement.style.height = 'auto'
  document.body.style.overflow = 'auto'
  document.body.style.height = 'auto'
})

onUnmounted(() => {
  document.documentElement.style.overflow = ''
  document.documentElement.style.height = ''
  document.body.style.overflow = ''
  document.body.style.height = ''
})
</script>

<template>
  <div
    class="login-page-root relative min-h-screen w-screen flex items-start justify-center overflow-y-auto py-4 transition-all duration-700 lg:items-center lg:py-0"
    :class="{ 'login-page-fallback-bg': !hasCustomBackground }"
    :style="backgroundStyle"
  >
    <div v-if="hasCustomBackground" class="absolute inset-0" :style="backgroundOverlayStyle" />

    <div class="relative z-10 mx-4 my-4 max-w-3xl w-full lg:mx-auto lg:my-0">
      <div class="glass-panel rounded-2xl p-6 shadow-2xl shadow-black/20 ring-1 ring-white/20 lg:rounded-3xl lg:p-10">
        <div class="text-center">
          <div class="mx-auto mb-4 h-14 w-14 flex items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--ui-brand-500)_18%,transparent)] text-[color:var(--ui-brand-500)]">
            <div class="i-carbon-password text-3xl" />
          </div>
          <h1 class="glass-text-main text-2xl font-bold tracking-tight lg:text-3xl">
            首次初始化管理员密码
          </h1>
          <p class="glass-text-muted mt-2 text-sm leading-6">
            当前实例检测到仍处于首次部署状态。请先设置管理员密码，完成后即可进入系统。
          </p>
        </div>

        <div class="mt-6 border border-[color:var(--ui-border-subtle)] rounded-2xl bg-[color-mix(in_srgb,var(--ui-bg-surface)_78%,transparent)] p-4">
          <div class="glass-text-main text-sm font-semibold">
            密码建议
          </div>
          <ul class="glass-text-muted mt-2 text-xs leading-5 space-y-1">
            <li>至少 8 位，尽量同时包含大小写字母、数字和符号。</li>
            <li>不要继续使用默认密码，也不要和常用 QQ 密码相同。</li>
            <li>初始化完成后会直接进入免责声明确认，再自动登录后台。</li>
          </ul>
        </div>

        <form class="mt-6 space-y-4" @submit.prevent="handleInitPassword">
          <BaseInput
            v-model="password"
            label="管理员密码"
            type="password"
            autocomplete="new-password"
            placeholder="请输入新的管理员密码"
          />
          <BaseInput
            v-model="confirmPassword"
            label="确认密码"
            type="password"
            autocomplete="new-password"
            placeholder="请再次输入管理员密码"
          />

          <p v-if="error" class="text-sm text-[color:var(--ui-status-danger)]">
            {{ error }}
          </p>

          <div class="flex items-center justify-end pt-2">
            <BaseButton
              type="submit"
              variant="primary"
              :loading="loading"
            >
              初始化并继续
            </BaseButton>
          </div>
        </form>
      </div>
    </div>

    <DisclaimerModal
      :show="showDisclaimer"
      @agree="onDisclaimerAgree"
      @decline="onDisclaimerDecline"
    />
  </div>
</template>
