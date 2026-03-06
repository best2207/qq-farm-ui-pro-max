<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useStatusStore } from '@/stores/status'
import { adminToken } from '@/utils/auth'

// Async lazy load heavy components
const NotificationModal = defineAsyncComponent(() => import('@/components/NotificationModal.vue'))
const ToastContainer = defineAsyncComponent(() => import('@/components/ToastContainer.vue'))

const appStore = useAppStore()
const statusStore = useStatusStore()

// 全局更新弹窗逻辑
const currentVersion = __APP_VERSION__
const seenVersion = useStorage('app_seen_version', '')
const showUpdateModal = ref(false)

onMounted(() => {
  appStore.fetchUIConfig()

  // 检查是否需要弹出版更公告
  if (seenVersion.value !== currentVersion) {
    showUpdateModal.value = true
    seenVersion.value = currentVersion // 设定当前版本为已读
  }
})

// === 后续优化：全局 Socket 生命周期管理 ===
// 当 Token 被移除（用户点击退出或 Token 过期被拦截器清除）时，彻底断开 Socket 连接
watch(adminToken, (newToken) => {
  if (!newToken) {
    statusStore.disconnectRealtime()
  }
})
</script>

<template>
  <div class="relative z-0 h-screen w-screen overflow-hidden bg-theme-bg text-gray-700 transition-colors duration-300 dark:bg-theme-darkbg dark:text-gray-200">
    <!-- 动态流动光球背景层 -->
    <div class="mesh-bg">
      <div class="mesh-orb orb-1" />
      <div class="mesh-orb orb-2" />
      <div class="mesh-orb orb-3" />
    </div>

    <RouterView class="relative z-10" />
    <ToastContainer class="relative z-50" />
    <!-- 全局首次更新大弹窗 -->
    <NotificationModal
      :show="showUpdateModal"
      class="relative z-50"
      @close="showUpdateModal = false"
    />
  </div>
</template>

<style>
/* Global styles */
body {
  margin: 0;
  font-family: 'DM Sans', sans-serif;
}
</style>
