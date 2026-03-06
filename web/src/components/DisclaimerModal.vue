<script setup lang="ts">
defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'agree'): void
  (e: 'decline'): void
}>()

const disclaimerHtml = `
欢迎使用御农·QQ农场智能助手（以下简称“本软件”）。在您开始使用本软件之前，请务必仔细阅读并理解以下全部内容。您点击“同意”、继续安装或使用本软件的行为，即视为您完全知情并自愿接受本声明的全部约束。如果您不同意本声明的任何条款，请立即拒绝并彻底删除本软件。

<b>1. 仅供学习与研究用途</b>
本软件仅作为个人编程学习、技术研究、自动化测试交流之用。开发者不鼓励、不支持将其用于任何破坏游戏公平性的日常游玩中。请在下载试用后24小时内自行删除，严禁将本软件用于任何商业用途或非法盈利。

<b>2. 账号风险与免责（重要）</b>
腾讯公司官方服务条款严格禁止使用任何第三方辅助工具、外挂或破坏游戏平衡的软件。<b>使用本软件操作“QQ农场”可能面临包括但不限于：警告、农场作物被清空、金币/经验扣除、甚至QQ账号被永久封禁的风险。</b>
用户须自行承担使用本软件带来的所有风险及后果。对于因使用本软件造成的任何账号降权、封禁、虚拟财产损失或数据异常，本软件开发者概不负责，也不承担任何直接或间接的赔偿责任。

<b>3. 版权及知识产权声明</b>
“QQ”、“QQ农场”及相关游戏的商标、美术素材、版权、知识产权均归属于深圳市腾讯计算机系统有限公司所有。本软件为独立的第三方交流工具，与腾讯公司无任何官方关联、赞助或授权关系。本软件不对游戏本体代码进行破解或恶意篡改，仅模拟常规操作。

<b>4. 软件“现状”提供（无担保）</b>
本软件按“现状”提供，开发者不提供任何形式的明示或暗示担保。受限于网络环境、游戏官方的更新维护、不可抗力及软件自身可能存在的Bug，开发者不保证本软件的绝对稳定、安全、无错或持续可用。因游戏官方更新导致本软件失效，开发者没有义务必须提供后续更新服务。

<b>5. 用户行为规范</b>
用户承诺在使用本软件时遵守国家相关法律法规。严禁利用本软件进行任何违法犯罪活动，严禁将本软件进行反向工程、恶意修改、植入木马病毒或进行二次打包售卖。如因用户的非法使用行为引发的法律纠纷，由用户单方承担全部法律责任。

<b>6. 声明修改权</b>
开发者保留随时修改本免责声明的权利。修改后的条款一旦公布即刻生效，若您继续使用本软件，则视为接受修改后的声明。

<b>我已仔细阅读并完全理解以上内容，自愿承担使用本软件产生的所有风险。</b>
`
</script>

<template>
  <Transition name="modal">
    <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden px-4">
      <!-- Apple风格超强高斯模糊背景遮罩 -->
      <div
        class="absolute inset-0 bg-white/20 backdrop-blur-md transition-opacity dark:bg-black/40"
        @click.stop
      />

      <!-- 弹窗本体 (仿苹果空间悬浮感) -->
      <div
        class="relative max-h-[90vh] max-w-2xl w-full flex flex-col transform overflow-hidden border border-white/50 rounded-3xl bg-white/80 shadow-2xl shadow-black/10 backdrop-blur-2xl transition-all dark:border-white/10 dark:bg-[#1C1C1E]/80 dark:shadow-black/50"
        @click.stop
      >
        <!-- 头部标题 -->
        <div class="shrink-0 border-b border-gray-200/50 px-6 pb-4 pt-6 text-center dark:border-gray-800/50">
          <div class="mx-auto mb-3 h-12 w-12 flex items-center justify-center rounded-xl from-blue-500 to-indigo-500 bg-gradient-to-tr shadow-lg">
            <div class="i-carbon-warning-alt text-2xl text-white drop-shadow-md" />
          </div>
          <h3 class="text-xl text-gray-900 font-bold tracking-tight dark:text-white">
            软件使用免责声明与条款
          </h3>
          <p class="mt-1.5 text-xs text-gray-500 font-medium dark:text-gray-400">
            请仔细阅读并同意以下条款以继续使用
          </p>
        </div>

        <!-- 可滚动内容区 -->
        <div class="custom-scrollbar flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <div class="prose dark:prose-invert prose-sm max-w-none text-[14px] text-gray-700 leading-relaxed space-y-3 dark:text-gray-300">
            <template v-for="(paragraph, index) in disclaimerHtml.split('\n\n')" :key="index">
              <p v-if="paragraph.trim()" class="apple-text mb-4 text-justify" v-html="paragraph.replace(/\n/g, '<br/>')" />
            </template>
          </div>
        </div>

        <!-- 底部作者版权声明 -->
        <div class="shrink-0 border-t border-gray-200/50 bg-gray-50/50 px-6 py-2.5 text-center dark:border-gray-800/50 dark:bg-black/20">
          <p class="text-xs text-gray-500 font-medium tracking-wide dark:text-gray-400/80">
            © {{ new Date().getFullYear() }} 御农 System | 架构与开发：<span class="text-blue-500 font-semibold dark:text-blue-400">smdk000</span>
          </p>
        </div>

        <!-- 底部毛玻璃悬浮操作栏 -->
        <div class="flex shrink-0 flex-col items-center justify-between gap-3 border-t border-gray-200/50 bg-white/50 px-6 py-4 sm:flex-row dark:border-gray-800/50 dark:bg-[#1C1C1E]/50">
          <!-- 左侧：社区互动卡片 -->
          <div class="order-last w-full flex items-center justify-between gap-3 sm:order-first sm:w-auto sm:justify-start">
            <a
              href="https://qm.qq.com/cgi-bin/qm/qr?k=&group_code=227916149"
              target="_blank"
              rel="noopener noreferrer"
              class="group flex flex-1 items-center justify-center gap-1.5 border border-gray-200/50 rounded-xl bg-white/60 px-3 py-2 text-xs text-gray-500 font-semibold no-underline shadow-sm transition-all sm:flex-none dark:border-gray-700/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:text-gray-400 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              <div class="i-carbon-chat text-sm text-blue-500 transition-transform group-hover:scale-110 dark:text-blue-400" />
              <span>加入技术群</span>
            </a>
            <a
              href="https://github.com/smdk000/qq-farm-bot-ui"
              target="_blank"
              rel="noopener noreferrer"
              class="group flex flex-1 items-center justify-center gap-1.5 border border-gray-200/50 rounded-xl bg-white/60 px-3 py-2 text-xs text-gray-500 font-semibold no-underline shadow-sm transition-all sm:flex-none dark:border-gray-700/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:text-gray-400 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              <div class="i-carbon-star text-sm text-yellow-500 transition-transform group-hover:scale-110 dark:text-yellow-400" />
              <span>给作者点赞</span>
            </a>
          </div>

          <!-- 右侧：主要操作按钮 -->
          <div class="w-full flex flex-1 items-center gap-3 sm:w-auto sm:flex-none">
            <button
              type="button"
              class="order-2 w-full flex-1 rounded-2xl bg-gray-100/80 px-6 py-2.5 text-sm text-gray-600 font-semibold transition-colors sm:order-1 sm:w-auto dark:bg-gray-800/80 hover:bg-gray-200 sm:py-3 sm:text-[15px] dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:hover:bg-gray-700"
              @click="emit('decline')"
            >
              拒绝并退出
            </button>
            <button
              type="button"
              class="order-1 w-full flex-1 rounded-2xl bg-blue-600 px-6 py-2.5 text-sm text-white font-semibold shadow-blue-500/20 shadow-md transition-all sm:order-2 sm:w-auto active:scale-[0.98] dark:bg-blue-600 hover:bg-blue-500 sm:py-3 sm:text-[15px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:hover:bg-blue-500 dark:focus:ring-offset-gray-900"
              @click="emit('agree')"
            >
              同意并继续
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.96) translateY(10px);
  opacity: 0;
}

/* 苹果风文字排版 */
.apple-text :deep(b) {
  display: block;
  font-size: 15px;
  font-weight: 700;
  color: #111827; /* 针对浅色模式 */
  margin-top: 1rem;
  margin-bottom: 0.25rem;
  letter-spacing: -0.01em;
}

.dark .apple-text :deep(b) {
  color: #f9fafb; /* 针对深色模式 */
}

/* iOS 风格的滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
  margin-top: 8px;
  margin-bottom: 8px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 20px;
  border: 2px solid transparent;
  background-clip: content-box;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}
</style>
