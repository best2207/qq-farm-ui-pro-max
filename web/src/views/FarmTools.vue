<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

interface FarmToolsMenuItem {
  icon: string
  title: string
  href: string
  file: string | null
  locked: boolean
  count: number | null
}

interface FarmToolsMenuSection {
  id: string
  label: string
  items: FarmToolsMenuItem[]
}

interface FarmToolsManifest {
  defaultFile: string
  sections: FarmToolsMenuSection[]
}

const DEFAULT_MANIFEST: FarmToolsManifest = {
  defaultFile: 'calculator.html',
  sections: [
    {
      id: 'quick-access',
      label: '快捷入口',
      items: [
        { icon: '🏠', title: '首页', href: '/', file: 'index.html', locked: false, count: null },
        { icon: '🧮', title: '经验计算器', href: '/calculator', file: 'calculator.html', locked: false, count: null },
        { icon: '💰', title: '氪金计算器', href: '/levels', file: 'levels.html', locked: false, count: null },
        { icon: '🧬', title: '变异计算器', href: '/mutation', file: 'mutation.html', locked: false, count: null },
      ],
    },
    {
      id: 'atlas',
      label: '图鉴',
      items: [
        { icon: '📋', title: '总览', href: 'javascript:void(0)', file: null, locked: true, count: null },
        { icon: '🌿', title: '作物图鉴', href: '/plants', file: 'plants.html', locked: false, count: 108 },
        { icon: '🏞️', title: '土地图鉴', href: '/lands', file: 'lands.html', locked: false, count: 24 },
      ],
    },
    {
      id: 'items',
      label: '商店道具',
      items: [
        { icon: '🌱', title: '种子', href: '/items/05', file: 'items/05.html', locked: false, count: 108 },
        { icon: '🔑', title: '种子解锁卡', href: 'javascript:void(0)', file: null, locked: true, count: null },
        { icon: '🎁', title: '礼包与宝箱', href: 'javascript:void(0)', file: null, locked: true, count: null },
        { icon: '🎀', title: '自选礼包', href: 'javascript:void(0)', file: null, locked: true, count: null },
        { icon: '💰', title: '货币与计数', href: '/items/02', file: 'items/02.html', locked: false, count: 9 },
        { icon: '🛠️', title: '操作工具', href: '/items/04', file: 'items/04.html', locked: false, count: 8 },
        { icon: '🧪', title: '化肥道具', href: '/items/07', file: 'items/07.html', locked: false, count: 8 },
        { icon: '✨', title: '黄金果实', href: '/items/17', file: 'items/17.html', locked: false, count: 7 },
        { icon: '🎨', title: '头像框与装饰', href: 'javascript:void(0)', file: null, locked: true, count: null },
        { icon: '🐕', title: '狗与看门犬', href: '/items/08', file: 'items/08.html', locked: false, count: 4 },
        { icon: '🦴', title: '狗粮', href: '/items/09', file: 'items/09.html', locked: false, count: 3 },
        { icon: '📖', title: '图鉴点数', href: 'javascript:void(0)', file: null, locked: true, count: null },
        { icon: '🔧', title: '系统占位', href: '/items/01', file: 'items/01.html', locked: false, count: 1 },
        { icon: '⭐', title: '经验与成长', href: '/items/03', file: 'items/03.html', locked: false, count: 1 },
        { icon: '⚡', title: '活跃点数', href: 'javascript:void(0)', file: null, locked: true, count: null },
        { icon: '💎', title: '充值货币', href: '/items/15', file: 'items/15.html', locked: false, count: 1 },
      ],
    },
  ],
}

function filterAvailableSections(sections: FarmToolsMenuSection[]): FarmToolsMenuSection[] {
  return sections
    .map(section => ({
      ...section,
      items: section.items.filter(item => !item.locked && Boolean(item.file)),
    }))
    .filter(section => section.items.length > 0)
}

const DEFAULT_VISIBLE_SECTIONS = filterAvailableSections(DEFAULT_MANIFEST.sections)
const DEFAULT_FALLBACK_ITEM = DEFAULT_VISIBLE_SECTIONS[0]?.items[0] ?? {
  icon: '🌾',
  title: '农场百科工具',
  href: '/calculator',
  file: DEFAULT_MANIFEST.defaultFile,
  locked: false,
  count: null,
}
const DEFAULT_FALLBACK_SECTION = DEFAULT_VISIBLE_SECTIONS[0] ?? {
  id: 'farm-tools',
  label: '农场工具',
  items: [DEFAULT_FALLBACK_ITEM],
}

const manifest = ref<FarmToolsManifest>(DEFAULT_MANIFEST)

const route = useRoute()
const selectedArticle = ref(DEFAULT_MANIFEST.defaultFile)
const iframeRef = ref<HTMLIFrameElement | null>(null)
const visibleSections = computed(() => filterAvailableSections(manifest.value.sections))
const selectableMenuItems = computed(() =>
  visibleSections.value.flatMap(section => section.items),
)

function normalizeLocalFile(value: string) {
  const raw = String(value || '').trim()
  if (!raw || raw === '/')
    return 'index.html'
  const stripped = raw.replace(/^\//, '')
  return stripped.endsWith('.html') ? stripped : `${stripped}.html`
}

function isSelectableFile(file: string) {
  return selectableMenuItems.value.some(item => item.file === file)
}

function getDefaultSelectableFile(nextManifest: FarmToolsManifest = manifest.value) {
  const firstSelectable = nextManifest.sections.flatMap(section => section.items).find(item => !item.locked && item.file)
  return firstSelectable?.file || DEFAULT_MANIFEST.defaultFile
}

function normalizeMenuItem(raw: unknown): FarmToolsMenuItem | null {
  const candidate = raw as Partial<FarmToolsMenuItem> | null | undefined
  const title = String(candidate?.title || '').trim()
  if (!title)
    return null

  const locked = Boolean(candidate?.locked)
  const href = String(candidate?.href || '').trim()
  const rawFile = typeof candidate?.file === 'string' && candidate.file.trim() ? candidate.file : href
  const normalizedFile = locked ? null : normalizeLocalFile(rawFile)
  const parsedCount = Number(candidate?.count)

  return {
    icon: String(candidate?.icon || '').trim() || '•',
    title,
    href,
    file: normalizedFile,
    locked,
    count: Number.isFinite(parsedCount) ? parsedCount : null,
  }
}

function normalizeManifest(raw: unknown): FarmToolsManifest {
  const candidate = raw as Partial<FarmToolsManifest> | null | undefined
  const sections = Array.isArray(candidate?.sections)
    ? candidate.sections
        .map((section, sectionIndex) => {
          const nextSection = section as Partial<FarmToolsMenuSection> | null | undefined
          const items = Array.isArray(nextSection?.items)
            ? nextSection.items.map(normalizeMenuItem).filter((item): item is FarmToolsMenuItem => Boolean(item))
            : []

          if (!items.length)
            return null

          return {
            id: String(nextSection?.id || '').trim() || `section-${sectionIndex + 1}`,
            label: String(nextSection?.label || '').trim() || `分组 ${sectionIndex + 1}`,
            items,
          }
        })
        .filter((section): section is FarmToolsMenuSection => Boolean(section))
    : DEFAULT_MANIFEST.sections

  const nextManifest: FarmToolsManifest = {
    defaultFile: normalizeLocalFile(String(candidate?.defaultFile || DEFAULT_MANIFEST.defaultFile)),
    sections: sections.length ? sections : DEFAULT_MANIFEST.sections,
  }

  if (!nextManifest.sections.flatMap(section => section.items).some(item => item.file === nextManifest.defaultFile && !item.locked))
    nextManifest.defaultFile = getDefaultSelectableFile(nextManifest)

  return nextManifest
}

const presetArticle = computed(() => {
  const raw = String(route.meta?.farmToolsPreset || '').trim()
  const normalized = raw ? normalizeLocalFile(raw) : ''
  return normalized && isSelectableFile(normalized) ? normalized : ''
})
const standaloneMode = computed(() => Boolean(route.meta?.farmToolsStandalone && presetArticle.value))
const activeArticle = computed(() => {
  if (presetArticle.value)
    return presetArticle.value
  if (isSelectableFile(selectedArticle.value))
    return selectedArticle.value
  if (isSelectableFile(manifest.value.defaultFile))
    return manifest.value.defaultFile
  return getDefaultSelectableFile()
})
const selectedMenuItem = computed(() =>
  selectableMenuItems.value.find(item => item.file === activeArticle.value)
  ?? selectableMenuItems.value[0]
  ?? DEFAULT_FALLBACK_ITEM,
)
const activeSection = computed(() =>
  visibleSections.value.find(section => section.items.some(item => item.file === activeArticle.value))
  ?? visibleSections.value[0]
  ?? DEFAULT_FALLBACK_SECTION,
)

async function loadManifest() {
  try {
    const response = await fetch('/nc_local_version/manifest.json', { cache: 'no-store' })
    if (!response.ok)
      throw new Error(`manifest fetch failed: ${response.status}`)

    const nextManifest = normalizeManifest(await response.json())
    manifest.value = nextManifest

    if (!presetArticle.value && !isSelectableFile(selectedArticle.value))
      selectedArticle.value = nextManifest.defaultFile
  }
  catch (error) {
    console.warn('加载农场工具菜单清单失败，继续使用内置导航:', error)
    if (!presetArticle.value && !isSelectableFile(selectedArticle.value))
      selectedArticle.value = DEFAULT_MANIFEST.defaultFile
  }
}

// 中屏侧栏折叠状态
const sidebarVisible = ref(false)
function toggleSidebar() {
  sidebarVisible.value = !sidebarVisible.value
}

function selectArticle(articleId: string | null) {
  if (presetArticle.value) {
    sidebarVisible.value = false
    return
  }
  if (!articleId || !isSelectableFile(articleId)) {
    sidebarVisible.value = false
    return
  }
  selectedArticle.value = articleId
  // 中小屏下选中菜单项后自动关闭浮动侧栏
  sidebarVisible.value = false
}

// 🔧 优化 #1：将绝大部分不依赖 isDark 的静态系统样式提取出来
const BASE_STATIC_CSS = `
  html, body { 
    color: var(--text-main) !important;
  }
  
  /* 隐藏原本自带的内部侧边栏与顶部栏，使其作为纯粹的组件嵌入 */
  aside, header, #sidebar-backdrop { display: none !important; }
  
  /* =========== 卡片与全局玻璃质感同步 =========== */
  [class~="bg-white"], [class*="dark:bg-"][class*="slate-800"] { 
    background-color: var(--glass-bg) !important; 
    backdrop-filter: blur(12px) !important;
    border-color: var(--glass-border) !important;
  }
  
  /* =========== 渐变背景统一 =========== */
  /* 所有 Hero 区域渐变（保留渐变但用系统色） */
  .bg-gradient-to-br.from-primary-700,
  .bg-gradient-to-br[class*="from-primary-700"] {
    background-image: linear-gradient(135deg, var(--farm-brand-700-soft-85), var(--farm-brand-soft-70)) !important;
    --tw-gradient-from: transparent !important;
    --tw-gradient-to: transparent !important;
  }
  
  /* =========== 搜索/筛选栏背景 =========== */
  .backdrop-blur {
    background-color: transparent !important;
  }
  
  /* =========== 原色劫持兜底 =========== */
  .text-green-600, .text-green-500, .text-farm-500 { color: var(--farm-brand-500) !important; }
  .bg-green-500, .bg-green-600, .bg-farm-500 { background-color: var(--farm-brand-500) !important; }
  
  /* =========== 表单元素 =========== */
  input:active, input:focus, select:active, select:focus {
    border-color: var(--farm-brand-500) !important;
    outline: none !important;
    box-shadow: 0 0 0 2px var(--farm-brand-soft-20) !important;
  }

  /* =========== 表格 =========== */
  table, th, td { border-color: var(--glass-border) !important; }
  tr:hover td { background-color: var(--farm-brand-soft-05) !important; }
  
  /* =========== Modal 弹窗 =========== */
  .fixed.inset-0[class*="bg-"][class*="black"] {
     backdrop-filter: blur(8px) !important;
     background-color: var(--ui-overlay-backdrop) !important;
  }

  /* =========== 搜索框暗色适配 =========== */
  .border-slate-200 { border-color: var(--glass-border) !important; }
  [class*="dark:border-slate-700"] { border-color: var(--glass-border) !important; }

  /* =========== 隐藏 shadow-inner（土地图片区残留阴影） =========== */
  .shadow-inner { box-shadow: none !important; }

  /* =========== 土地卡片 bg-transparent 确保生效 =========== */
  .land-card, .plant-card {
    background-color: var(--glass-bg) !important;
    backdrop-filter: blur(12px) !important;
  }
  
  /* =========== 🏷️ 徽章 (bonus-tag) 底色 + 文字色柔化 =========== */
  .bonus-tag { backdrop-filter: blur(6px) !important; }
  
  /* =========== 🔗 特殊土地卡片底部信息区文字 =========== */
  .land-card .text-slate-700 { color: var(--text-main) !important; }

  /* =========== 文本颜色继承系统主题 =========== */
  .text-slate-800, [class*="dark:text-slate-200"] { color: var(--text-main) !important; }
  .text-slate-600, .text-slate-500, .text-slate-400,
  [class*="dark:text-slate-400"], [class*="dark:text-slate-500"],
  [class*="dark:text-slate-300"] { color: var(--text-muted) !important; }
  .text-slate-700, [class*="dark:text-slate-300"] { color: var(--text-main) !important; }
  
  /* =========== 🔘 按钮/交互组件 深浅色适配 =========== */
  /* 主按钮（开始计算等）—— 确保白字在任何主题色上可读 */
  .btn-calc {
    color: var(--ui-text-on-brand) !important;
    box-shadow: 0 2px 8px var(--farm-brand-soft-35) !important;
    text-shadow: 0 1px 2px var(--ui-shadow-text);
  }
  .btn-calc:hover { box-shadow: 0 4px 16px var(--farm-brand-soft-45) !important; }
  
  /* 验算按钮 —— 跟随主题色渐变 */
  .btn-verify {
    background: linear-gradient(135deg, var(--farm-brand-400), var(--farm-brand-600)) !important;
    color: var(--ui-text-on-brand) !important;
    box-shadow: 0 2px 8px var(--farm-brand-soft-30) !important;
    text-shadow: 0 1px 2px var(--ui-shadow-text);
  }
  
  /* 排行切换 active / 验算植物 Tab active */
  .rank-tab.active,
  .v-crop-tab.v-active {
    background: var(--farm-brand-500) !important;
    color: var(--ui-text-on-brand) !important;
    border-color: var(--farm-brand-500) !important;
    text-shadow: 0 1px 2px var(--ui-shadow-text);
  }
  
  /* 计算器模式切换 Tab active */
  .calc-mode-tab.active {
    background: var(--farm-brand-500) !important;
    color: var(--ui-text-on-brand) !important;
    text-shadow: 0 1px 2px var(--ui-shadow-text);
    box-shadow: 0 2px 8px var(--farm-brand-soft-25) !important;
  }
  .calc-mode-tab:hover:not(.active) {
    color: var(--farm-brand-600) !important;
    background: var(--farm-brand-soft-08) !important;
  }
  
  /* 开关 Toggle */
  .fert-toggle input[type="checkbox"]:checked { background: var(--farm-brand-500) !important; }
  .fert-toggle input[type="checkbox"]::after { background: var(--ui-text-on-brand) !important; box-shadow: 0 1px 3px var(--ui-shadow-text); }
  
  /* 施肥阶段选择按钮 selected */
  .tc-fert-phase-btn.selected {
    border-color: var(--farm-brand-500) !important;
    background: var(--farm-brand-soft-15) !important;
  }
  
  /* Spinner 加载圈白色可见 */
  .spinner { border-color: color-mix(in srgb, var(--ui-text-on-brand) 30%, transparent) !important; border-top-color: var(--ui-text-on-brand) !important; }
`

// 🔧 优化 #2：持有一个 iframeObserver 引用用于在组件销毁时断开
let iframeObserver: MutationObserver | null = null

// 主题劫持逻辑：在同源策略下，直接注入 CSS 和监控
function syncThemeToIframe() {
  if (!iframeRef.value?.contentDocument)
    return

  try {
    const doc = iframeRef.value.contentDocument
    if (!doc)
      return

    // 如果已经注入过了就不再重复注入 `<style id="yunong-theme-override">`
    let styleEl = doc.getElementById('yunong-theme-override')
    if (!styleEl) {
      styleEl = doc.createElement('style')
      styleEl.id = 'yunong-theme-override'
      doc.head.appendChild(styleEl)

      // 🔥 MutationObserver：监听 iframe <head> 变化
      // 当 Tailwind CDN 异步插入 <style> 标签时，自动将我们的 override style 移到最后
      if (iframeObserver)
        iframeObserver.disconnect()
      iframeObserver = new MutationObserver(() => {
        const lastChild = doc.head.lastElementChild
        if (lastChild && lastChild.id !== 'yunong-theme-override' && styleEl) {
          doc.head.appendChild(styleEl) // 移到最后
        }
      })
      iframeObserver.observe(doc.head, { childList: true })
    }
    else {
      // 每次同步时确保 style 标签在 <head> 最后（覆盖后注入的 Tailwind 样式）
      doc.head.appendChild(styleEl)
    }

    // 探测当前父窗口的系统背景以及各个参数
    const isDark = document.documentElement.classList.contains('dark')
    const computed = getComputedStyle(document.documentElement)

    let cssVars = ''
    const varsToSync = [
      '--ui-brand-100',
      '--ui-brand-200',
      '--ui-brand-300',
      '--ui-brand-400',
      '--ui-brand-500',
      '--ui-brand-600',
      '--ui-brand-700',
      '--ui-brand-800',
      '--ui-brand-900',
      '--color-primary-50',
      '--color-primary-100',
      '--color-primary-200',
      '--color-primary-300',
      '--color-primary-400',
      '--color-primary-500',
      '--color-primary-600',
      '--color-primary-700',
      '--color-primary-800',
      '--color-primary-900',
      '--color-primary-950',
      '--glass-bg',
      '--glass-border',
      '--text-main',
      '--text-muted',
      '--theme-dark-bg',
      '--ui-bg-surface',
      '--ui-bg-surface-raised',
      '--ui-border-subtle',
      '--ui-border-strong',
      '--ui-text-on-brand',
      '--ui-status-success',
      '--ui-status-success-soft',
      '--ui-status-warning',
      '--ui-status-warning-soft',
      '--ui-status-danger',
      '--ui-status-danger-soft',
      '--ui-status-info',
      '--ui-status-info-soft',
      '--ui-shadow-text',
      '--ui-shadow-panel',
      '--ui-shadow-panel-strong',
      '--ui-shadow-inner',
      '--ui-overlay-backdrop',
    ]

    varsToSync.forEach((v) => {
      const val = computed.getPropertyValue(v).trim()
      if (val) {
        cssVars += `${v}: ${val};\n`
      }
      else {
        // 🔧 容错处理：确保取到的值不是空
        if (v === '--glass-bg') {
          cssVars += `${v}: color-mix(in srgb, var(--ui-bg-surface) 72%, transparent);\n`
        }
        else if (v === '--glass-border') {
          cssVars += `${v}: var(--ui-border-subtle);\n`
        }
        else if (v === '--text-main') {
          cssVars += `${v}: var(--ui-text-1);\n`
        }
        else if (v === '--text-muted') {
          cssVars += `${v}: var(--ui-text-2);\n`
        }
        else if (v === '--theme-dark-bg') {
          cssVars += `${v}: var(--ui-bg-canvas);\n`
        }
        else if (v === '--ui-bg-surface') {
          cssVars += `${v}: var(--ui-bg-surface);\n`
        }
        else if (v === '--ui-bg-surface-raised') {
          cssVars += `${v}: var(--ui-bg-surface-raised);\n`
        }
        else if (v === '--ui-border-subtle') {
          cssVars += `${v}: var(--ui-border-subtle);\n`
        }
        else if (v === '--ui-border-strong') {
          cssVars += `${v}: var(--ui-border-strong);\n`
        }
        else if (v === '--ui-text-on-brand') {
          cssVars += `${v}: var(--ui-text-on-brand);\n`
        }
        else if (v === '--ui-status-success') {
          cssVars += `${v}: var(--ui-status-success);\n`
        }
        else if (v === '--ui-status-success-soft') {
          cssVars += `${v}: var(--ui-status-success-soft);\n`
        }
        else if (v === '--ui-status-warning') {
          cssVars += `${v}: var(--ui-status-warning);\n`
        }
        else if (v === '--ui-status-warning-soft') {
          cssVars += `${v}: var(--ui-status-warning-soft);\n`
        }
        else if (v === '--ui-status-danger') {
          cssVars += `${v}: var(--ui-status-danger);\n`
        }
        else if (v === '--ui-status-danger-soft') {
          cssVars += `${v}: var(--ui-status-danger-soft);\n`
        }
        else if (v === '--ui-status-info') {
          cssVars += `${v}: var(--ui-status-info);\n`
        }
        else if (v === '--ui-status-info-soft') {
          cssVars += `${v}: var(--ui-status-info-soft);\n`
        }
        else if (v === '--ui-shadow-text') {
          cssVars += `${v}: var(--ui-shadow-text);\n`
        }
        else if (v === '--ui-shadow-panel') {
          cssVars += `${v}: var(--ui-shadow-panel);\n`
        }
        else if (v === '--ui-shadow-panel-strong') {
          cssVars += `${v}: var(--ui-shadow-panel-strong);\n`
        }
        else if (v === '--ui-shadow-inner') {
          cssVars += `${v}: var(--ui-shadow-inner);\n`
        }
        else if (v === '--ui-overlay-backdrop') {
          cssVars += `${v}: var(--ui-overlay-backdrop);\n`
        }
        else if (v.startsWith('--color-primary-')) {
          // 兜底一个蓝色的 primary 色系，防止空值
          const fallbackColors = {
            '--color-primary-50': '239 246 255',
            '--color-primary-100': '219 234 254',
            '--color-primary-200': '191 219 254',
            '--color-primary-300': '147 197 253',
            '--color-primary-400': '96 165 250',
            '--color-primary-500': '59 130 246',
            '--color-primary-600': '37 99 235',
            '--color-primary-700': '29 78 216',
            '--color-primary-800': '30 64 175',
            '--color-primary-900': '30 58 138',
            '--color-primary-950': '23 37 84',
          }
          cssVars += `${v}: ${fallbackColors[v as keyof typeof fallbackColors]};\n`
        }
      }
    })

    // 🔧 强制给内部 iframe 的 html 标签加上 dark 类，以便触发其内部自带的 tailwind 暗夜模式
    if (isDark) {
      doc.documentElement.classList.add('dark')
    }
    else {
      doc.documentElement.classList.remove('dark')
    }

    // 通用中性色层改为语义 token，降低主题漂移
    const subtleBg = 'var(--ui-bg-surface)'
    const stripeBg = 'var(--ui-bg-surface-raised)'

    // 🔧 仅注入真正受 isDark 影响的动态属性，包括背景色，拒绝白底透传
    styleEl.innerHTML = `
      :root {
        ${cssVars}
        --farm-brand-100: var(--ui-brand-100);
        --farm-brand-200: var(--ui-brand-200);
        --farm-brand-300: var(--ui-brand-300);
        --farm-brand-400: var(--ui-brand-400);
        --farm-brand-500: var(--ui-brand-500);
        --farm-brand-600: var(--ui-brand-600);
        --farm-brand-700: var(--ui-brand-700);
        --farm-brand-800: var(--ui-brand-800);
        --farm-brand-900: var(--ui-brand-900);
        --farm-brand-soft-05: color-mix(in srgb, var(--farm-brand-500) 5%, transparent);
        --farm-brand-soft-06: color-mix(in srgb, var(--farm-brand-500) 6%, transparent);
        --farm-brand-soft-08: color-mix(in srgb, var(--farm-brand-500) 8%, transparent);
        --farm-brand-soft-10: color-mix(in srgb, var(--farm-brand-500) 10%, transparent);
        --farm-brand-soft-12: color-mix(in srgb, var(--farm-brand-500) 12%, transparent);
        --farm-brand-soft-15: color-mix(in srgb, var(--farm-brand-500) 15%, transparent);
        --farm-brand-soft-20: color-mix(in srgb, var(--farm-brand-500) 20%, transparent);
        --farm-brand-soft-25: color-mix(in srgb, var(--farm-brand-500) 25%, transparent);
        --farm-brand-soft-30: color-mix(in srgb, var(--farm-brand-500) 30%, transparent);
        --farm-brand-soft-35: color-mix(in srgb, var(--farm-brand-500) 35%, transparent);
        --farm-brand-soft-45: color-mix(in srgb, var(--farm-brand-500) 45%, transparent);
        --farm-brand-soft-50: color-mix(in srgb, var(--farm-brand-500) 50%, transparent);
        --farm-brand-soft-70: color-mix(in srgb, var(--farm-brand-500) 70%, transparent);
        --farm-brand-soft-85: color-mix(in srgb, var(--farm-brand-500) 85%, transparent);
        --farm-brand-soft-90: color-mix(in srgb, var(--farm-brand-500) 90%, transparent);
        --farm-brand-700-soft-85: color-mix(in srgb, var(--farm-brand-700) 85%, transparent);
        --farm-brand-800-soft-25: color-mix(in srgb, var(--farm-brand-800) 25%, transparent);
        --farm-brand-900-soft-30: color-mix(in srgb, var(--farm-brand-900) 30%, transparent);
        --farm-brand-900-soft-40: color-mix(in srgb, var(--farm-brand-900) 40%, transparent);
        --farm-brand-300-soft-40: color-mix(in srgb, var(--farm-brand-300) 40%, transparent);
        --farm-brand-200-soft-30: color-mix(in srgb, var(--farm-brand-200) 30%, transparent);
        --farm-brand-100-soft-20: color-mix(in srgb, var(--farm-brand-100) 20%, transparent);
      }
      ${BASE_STATIC_CSS}
      
      /* =============== 🔥 终极防白底与系统深度融合补丁 =============== */
      :root, html, body {
        /* 深色模式：用不透明的 --theme-dark-bg 作为画布底色，防止半透明 --glass-bg 混合浏览器默认白色 */
        background: ${isDark ? 'var(--theme-dark-bg, var(--ui-bg-canvas))' : 'var(--glass-bg)'} !important;
        background-color: ${isDark ? 'var(--theme-dark-bg, var(--ui-bg-canvas))' : 'var(--glass-bg)'} !important;
        background-image: none !important;
        color: var(--text-main) !important;
      }
      
      /* 强制将所有文本类的颜色继承系统的字体色彩，不再局限于 dark class 的动态切换失效问题 */
      .text-slate-800, [class*="text-"][class*="gray-800"] {
        color: var(--text-main) !important;
      }
      .text-slate-500, [class*="text-"][class*="gray-500"] {
        color: var(--text-muted) !important;
      }
      
      /* 获取到计算器外层的大型包裹元素并强制剥离所有默认的底色，直接跟身体相同颜色避免断层 */
      #app, main, .home-container, .min-h-screen {
        background-color: transparent !important;
      }

      /* 核心卡片容器：取消自身背景，依赖父级玻璃渲染 */
      .calc-input-panel,
      .calc-mode-tabs,
      .result-card,
      .stat-box,
      .phase-timeline,
      .crop-table,
      .crop-detail-card,
      .sim-card,
      .info-popup-content,
      .tc-input-panel,
      .tc-timeline-card,
      .tc-summary-card {
        background-color: var(--ui-bg-surface) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        border-color: var(--glass-border) !important;
      }

      /* Home entry cards should remain readable in light mode even before hover */
      .entry-card {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--ui-bg-surface-raised) 98%, var(--ui-brand-500) 2%) 0%, color-mix(in srgb, var(--ui-bg-surface) 96%, var(--ui-brand-500) 4%) 100%)'} !important;
        border: 1px solid ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 74%, var(--ui-brand-500) 26%)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 86%, var(--ui-brand-500) 14%)'} !important;
        box-shadow: ${isDark
          ? '0 22px 52px -34px color-mix(in srgb, var(--ui-shadow-panel-strong) 62%, transparent), inset 0 1px 0 color-mix(in srgb, var(--ui-shadow-inner) 78%, transparent)'
          : '0 20px 42px -34px color-mix(in srgb, var(--ui-shadow-panel) 34%, transparent), 0 10px 24px -28px color-mix(in srgb, var(--ui-brand-500) 12%, transparent), inset 0 1px 0 color-mix(in srgb, white 78%, transparent)'} !important;
        color: var(--text-main) !important;
      }
      .entry-card::before {
        opacity: ${isDark ? '0.08' : '0.16'} !important;
      }
      .entry-card:hover {
        border-color: ${isDark
          ? 'color-mix(in srgb, var(--ui-brand-500) 36%, var(--ui-border-subtle) 64%)'
          : 'color-mix(in srgb, var(--ui-brand-500) 26%, var(--ui-border-subtle) 74%)'} !important;
        box-shadow: ${isDark
          ? '0 26px 64px -28px color-mix(in srgb, var(--ui-shadow-panel-strong) 68%, transparent), 0 0 34px color-mix(in srgb, var(--ui-brand-500) 18%, transparent)'
          : '0 24px 58px -28px color-mix(in srgb, var(--ui-shadow-panel) 38%, transparent), 0 0 28px color-mix(in srgb, var(--ui-brand-500) 16%, transparent)'} !important;
      }
      .particles {
        opacity: ${isDark ? '0.88' : '0.62'} !important;
      }
      .home-container {
        max-width: 1160px !important;
        justify-content: flex-start !important;
        gap: 0 !important;
        min-height: max(100vh, 48rem) !important;
        padding: ${isDark ? '2.4rem 1.25rem 2.75rem' : '2.75rem 1.25rem 3rem'} !important;
      }
      .home-container::before {
        content: '' !important;
        position: absolute !important;
        top: 1rem !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: min(100%, 70rem) !important;
        height: 28rem !important;
        border-radius: 2.4rem !important;
        background: ${isDark
          ? 'radial-gradient(circle at 50% 8%, color-mix(in srgb, var(--ui-brand-500) 14%, transparent), transparent 62%)'
          : 'radial-gradient(circle at 50% 6%, color-mix(in srgb, var(--ui-brand-500) 8%, white 6%), transparent 64%)'} !important;
        filter: blur(${isDark ? '8px' : '10px'}) !important;
        opacity: ${isDark ? '0.82' : '0.88'} !important;
        pointer-events: none !important;
        z-index: 0 !important;
      }
      .logo-area {
        position: relative !important;
        width: min(100%, 42rem) !important;
        margin: 0 auto 2.1rem !important;
        padding: ${isDark ? '1.7rem 1.5rem 1.45rem' : '1.85rem 1.6rem 1.5rem'} !important;
        border-radius: 1.75rem !important;
        border: 1px solid ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 74%, var(--ui-brand-500) 26%)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 84%, var(--ui-brand-500) 16%)'} !important;
        background: ${isDark
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--ui-bg-surface-raised) 82%, transparent) 0%, color-mix(in srgb, var(--ui-bg-surface) 76%, transparent) 100%)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--ui-bg-surface-raised) 96%, var(--ui-brand-500) 4%) 0%, color-mix(in srgb, var(--ui-bg-surface) 93%, var(--ui-brand-300) 7%) 100%)'} !important;
        box-shadow: ${isDark
          ? '0 26px 58px -36px color-mix(in srgb, var(--ui-shadow-panel-strong) 62%, transparent), inset 0 1px 0 color-mix(in srgb, var(--ui-shadow-inner) 76%, transparent)'
          : '0 26px 54px -40px color-mix(in srgb, var(--ui-shadow-panel) 34%, transparent), 0 18px 40px -42px color-mix(in srgb, var(--ui-brand-500) 20%, transparent), inset 0 1px 0 color-mix(in srgb, white 84%, transparent)'} !important;
        overflow: hidden !important;
      }
      .logo-area::before {
        content: '' !important;
        position: absolute !important;
        inset: 0 !important;
        background: ${isDark
          ? 'radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--ui-brand-500) 18%, transparent), transparent 58%)'
          : 'radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--ui-brand-500) 12%, white 8%), transparent 60%)'} !important;
        pointer-events: none !important;
      }
      .logo-area > * {
        position: relative !important;
        z-index: 1 !important;
      }
      .logo-icon {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 5.4rem !important;
        height: 5.4rem !important;
        margin: 0 auto 0.95rem !important;
        border-radius: 1.6rem !important;
        background: ${isDark
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--ui-brand-500) 18%, var(--ui-bg-surface-raised) 82%), color-mix(in srgb, var(--ui-brand-300) 10%, var(--ui-bg-surface) 90%))'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--ui-brand-500) 16%, white 84%), color-mix(in srgb, var(--ui-brand-300) 14%, var(--ui-bg-surface-raised) 86%))'} !important;
        border: 1px solid ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 68%, var(--ui-brand-500) 32%)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 76%, var(--ui-brand-500) 24%)'} !important;
        box-shadow: ${isDark
          ? 'inset 0 1px 0 color-mix(in srgb, var(--ui-shadow-inner) 76%, transparent), 0 16px 32px -24px color-mix(in srgb, var(--ui-shadow-panel-strong) 58%, transparent)'
          : 'inset 0 1px 0 color-mix(in srgb, white 84%, transparent), 0 18px 32px -24px color-mix(in srgb, var(--ui-brand-500) 24%, transparent)'} !important;
      }
      .logo-title {
        color: ${isDark ? 'var(--ui-text-1)' : 'color-mix(in srgb, var(--ui-brand-700) 30%, var(--ui-text-1) 70%)'} !important;
        font-size: clamp(2rem, 3vw, 2.55rem) !important;
        line-height: 1.08 !important;
        letter-spacing: 0.03em !important;
        text-shadow: none !important;
      }
      .logo-sub {
        margin-top: 0.78rem !important;
        font-size: 0.98rem !important;
        line-height: 1.65 !important;
        letter-spacing: 0.06em !important;
        color: ${isDark ? 'var(--ui-text-2)' : 'color-mix(in srgb, var(--ui-brand-600) 18%, var(--ui-text-2) 82%)'} !important;
      }
      .footer-text {
        margin-top: 2rem !important;
        align-self: center !important;
        padding: 0.85rem 1.15rem !important;
        border-radius: 999px !important;
        border: 1px solid ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 72%, transparent)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 82%, var(--ui-brand-500) 18%)'} !important;
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface) 80%, transparent)'
          : 'color-mix(in srgb, var(--ui-bg-surface-raised) 94%, var(--ui-brand-500) 6%)'} !important;
        color: var(--text-muted) !important;
        box-shadow: ${isDark
          ? '0 16px 36px -28px color-mix(in srgb, var(--ui-shadow-panel-strong) 52%, transparent)'
          : '0 16px 36px -30px color-mix(in srgb, var(--ui-shadow-panel) 24%, transparent)'} !important;
      }
      .logo-area,
      .cards-grid,
      .footer-text {
        animation: farm-tools-home-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both !important;
      }
      .cards-grid {
        animation-delay: 70ms !important;
      }
      .footer-text {
        animation-delay: 130ms !important;
      }
      @keyframes farm-tools-home-rise {
        0% {
          opacity: 0;
          transform: translateY(18px);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (max-width: 640px) {
        .home-container {
          padding: 1.45rem 0.85rem 2rem !important;
          min-height: auto !important;
        }
        .home-container::before {
          top: 0.4rem !important;
          width: calc(100% - 0.4rem) !important;
          height: 18rem !important;
          border-radius: 1.6rem !important;
        }
        .logo-area {
          width: 100% !important;
          margin-bottom: 1.4rem !important;
          padding: 1.4rem 1rem 1.15rem !important;
          border-radius: 1.35rem !important;
        }
        .logo-icon {
          width: 4.65rem !important;
          height: 4.65rem !important;
          margin-bottom: 0.75rem !important;
          border-radius: 1.35rem !important;
        }
        .logo-sub {
          font-size: 0.9rem !important;
          letter-spacing: 0.03em !important;
        }
        .footer-text {
          width: 100% !important;
          border-radius: 1rem !important;
          text-align: center !important;
        }
      }
      .cards-grid {
        gap: 1.45rem !important;
        align-items: stretch !important;
        position: relative !important;
        z-index: 1 !important;
        margin-top: 0.15rem !important;
      }
      .cards-grid::before {
        content: '' !important;
        position: absolute !important;
        top: -0.95rem !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: min(11rem, 28%) !important;
        height: 1px !important;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ui-brand-500) 26%, var(--ui-border-subtle) 74%), transparent) !important;
        opacity: ${isDark ? '0.86' : '0.74'} !important;
      }
      .cards-grid > .entry-card {
        display: flex !important;
        flex-direction: column !important;
        min-height: 18.5rem !important;
        padding: 1.95rem 1.55rem 4.25rem !important;
      }
      .cards-grid > .entry-card .card-title {
        margin: 0 0 0.68rem !important;
        font-size: 1.22rem !important;
        line-height: 1.28 !important;
        letter-spacing: 0.01em !important;
      }
      .cards-grid > .entry-card .card-desc {
        margin: 0 !important;
        padding-right: 2.65rem !important;
        min-height: 3.15rem !important;
        max-width: 32ch !important;
        line-height: 1.72 !important;
      }
      .cards-grid > .entry-card .card-tags {
        margin-top: auto !important;
        padding-top: 1.15rem !important;
        padding-right: 3.3rem !important;
        gap: 0.48rem !important;
      }
      .cards-grid > .entry-card .card-arrow {
        right: 1.35rem !important;
        bottom: 1.35rem !important;
        width: 2.3rem !important;
        height: 2.3rem !important;
      }
      .cards-grid > .entry-card .card-arrow svg {
        width: 0.95rem !important;
        height: 0.95rem !important;
      }
      @media (max-width: 640px) {
        .cards-grid {
          gap: 1rem !important;
        }
        .cards-grid::before {
          top: -0.75rem !important;
          width: min(8rem, 42%) !important;
        }
        .cards-grid > .entry-card {
          min-height: auto !important;
          padding: 1.55rem 1.2rem 4rem !important;
        }
        .cards-grid > .entry-card .card-desc,
        .cards-grid > .entry-card .card-tags {
          padding-right: 0 !important;
          max-width: none !important;
        }
      }
      .cards-grid > .entry-card:nth-child(1) {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--ui-bg-surface-raised) 91%, var(--ui-status-success-soft) 9%) 0%, color-mix(in srgb, var(--ui-bg-surface) 88%, var(--ui-status-success-soft) 12%) 100%)'} !important;
        border-color: ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 74%, var(--ui-status-success) 26%)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 78%, var(--ui-status-success) 22%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(2) {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--ui-bg-surface-raised) 91%, var(--ui-status-warning-soft) 9%) 0%, color-mix(in srgb, var(--ui-bg-surface) 88%, var(--ui-status-warning-soft) 12%) 100%)'} !important;
        border-color: ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 74%, var(--ui-status-warning) 26%)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 78%, var(--ui-status-warning) 22%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(3) {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--ui-bg-surface-raised) 91%, var(--ui-status-info-soft) 9%) 0%, color-mix(in srgb, var(--ui-bg-surface) 88%, var(--ui-status-info-soft) 12%) 100%)'} !important;
        border-color: ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 74%, var(--ui-status-info) 26%)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 78%, var(--ui-status-info) 22%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(1)::before {
        background: linear-gradient(135deg, color-mix(in srgb, var(--ui-status-success-soft) ${isDark ? '24%' : '32%'}, transparent), transparent 72%) !important;
      }
      .cards-grid > .entry-card:nth-child(2)::before {
        background: linear-gradient(135deg, color-mix(in srgb, var(--ui-status-warning-soft) ${isDark ? '22%' : '30%'}, transparent), transparent 72%) !important;
      }
      .cards-grid > .entry-card:nth-child(3)::before {
        background: linear-gradient(135deg, color-mix(in srgb, var(--ui-status-info-soft) ${isDark ? '24%' : '32%'}, transparent), transparent 72%) !important;
      }
      .cards-grid > .entry-card:nth-child(1):hover {
        border-color: color-mix(in srgb, var(--ui-status-success) 30%, var(--ui-border-subtle) 70%) !important;
        box-shadow: ${isDark
          ? '0 26px 64px -28px color-mix(in srgb, var(--ui-shadow-panel-strong) 68%, transparent), 0 0 34px color-mix(in srgb, var(--ui-status-success) 18%, transparent)'
          : '0 24px 58px -28px color-mix(in srgb, var(--ui-shadow-panel) 38%, transparent), 0 0 28px color-mix(in srgb, var(--ui-status-success) 16%, transparent)'} !important;
      }
      .cards-grid > .entry-card:nth-child(2):hover {
        border-color: color-mix(in srgb, var(--ui-status-warning) 30%, var(--ui-border-subtle) 70%) !important;
        box-shadow: ${isDark
          ? '0 26px 64px -28px color-mix(in srgb, var(--ui-shadow-panel-strong) 68%, transparent), 0 0 34px color-mix(in srgb, var(--ui-status-warning) 18%, transparent)'
          : '0 24px 58px -28px color-mix(in srgb, var(--ui-shadow-panel) 38%, transparent), 0 0 28px color-mix(in srgb, var(--ui-status-warning) 16%, transparent)'} !important;
      }
      .cards-grid > .entry-card:nth-child(3):hover {
        border-color: color-mix(in srgb, var(--ui-status-info) 30%, var(--ui-border-subtle) 70%) !important;
        box-shadow: ${isDark
          ? '0 26px 64px -28px color-mix(in srgb, var(--ui-shadow-panel-strong) 68%, transparent), 0 0 34px color-mix(in srgb, var(--ui-status-info) 18%, transparent)'
          : '0 24px 58px -28px color-mix(in srgb, var(--ui-shadow-panel) 38%, transparent), 0 0 28px color-mix(in srgb, var(--ui-status-info) 16%, transparent)'} !important;
      }
      .cards-grid > .entry-card .card-emoji {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 3.35rem !important;
        height: 3.35rem !important;
        margin-bottom: 1.15rem !important;
        border-radius: 1rem !important;
        border: 1px solid ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 72%, transparent)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 80%, white 20%)'} !important;
        box-shadow: ${isDark
          ? 'inset 0 1px 0 color-mix(in srgb, var(--ui-shadow-inner) 78%, transparent), 0 12px 24px -18px color-mix(in srgb, var(--ui-shadow-panel-strong) 58%, transparent)'
          : 'inset 0 1px 0 color-mix(in srgb, white 82%, transparent), 0 14px 28px -22px color-mix(in srgb, var(--ui-shadow-panel) 26%, transparent)'} !important;
      }
      .cards-grid > .entry-card:nth-child(1) .card-emoji {
        background: ${isDark
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--ui-status-success-soft) 24%, var(--ui-bg-surface-raised) 76%), color-mix(in srgb, var(--ui-status-success-soft) 12%, var(--ui-bg-surface) 88%))'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--ui-status-success-soft) 34%, white 66%), color-mix(in srgb, var(--ui-status-success-soft) 18%, var(--ui-bg-surface-raised) 82%))'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 68%, var(--ui-status-success) 32%) !important;
      }
      .cards-grid > .entry-card:nth-child(2) .card-emoji {
        background: ${isDark
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--ui-status-warning-soft) 24%, var(--ui-bg-surface-raised) 76%), color-mix(in srgb, var(--ui-status-warning-soft) 12%, var(--ui-bg-surface) 88%))'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--ui-status-warning-soft) 34%, white 66%), color-mix(in srgb, var(--ui-status-warning-soft) 18%, var(--ui-bg-surface-raised) 82%))'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 68%, var(--ui-status-warning) 32%) !important;
      }
      .cards-grid > .entry-card:nth-child(3) .card-emoji {
        background: ${isDark
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--ui-status-info-soft) 24%, var(--ui-bg-surface-raised) 76%), color-mix(in srgb, var(--ui-status-info-soft) 12%, var(--ui-bg-surface) 88%))'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--ui-status-info-soft) 34%, white 66%), color-mix(in srgb, var(--ui-status-info-soft) 18%, var(--ui-bg-surface-raised) 82%))'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 68%, var(--ui-status-info) 32%) !important;
      }
      .cards-grid > .entry-card:nth-child(1) .card-title {
        color: ${isDark ? 'color-mix(in srgb, var(--ui-status-success) 64%, var(--text-main) 36%)' : 'color-mix(in srgb, var(--ui-status-success) 40%, var(--text-main) 60%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(2) .card-title {
        color: ${isDark ? 'color-mix(in srgb, var(--ui-status-warning) 64%, var(--text-main) 36%)' : 'color-mix(in srgb, var(--ui-status-warning) 44%, var(--text-main) 56%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(3) .card-title {
        color: ${isDark ? 'color-mix(in srgb, var(--ui-status-info) 64%, var(--text-main) 36%)' : 'color-mix(in srgb, var(--ui-status-info) 42%, var(--text-main) 58%)'} !important;
      }
      .card-tag {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface) 78%, transparent)'
          : 'color-mix(in srgb, var(--ui-brand-500) 6%, var(--ui-bg-surface-raised) 94%)'} !important;
        border: 1px solid ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 78%, transparent)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 82%, var(--ui-brand-500) 18%)'} !important;
        color: ${isDark
          ? 'var(--text-muted)'
          : 'color-mix(in srgb, var(--ui-brand-700) 38%, var(--text-muted) 62%)'} !important;
      }
      .card-arrow {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'color-mix(in srgb, var(--ui-brand-500) 8%, var(--ui-bg-surface-raised) 92%)'} !important;
        border: 1px solid ${isDark
          ? 'color-mix(in srgb, var(--ui-border-subtle) 74%, transparent)'
          : 'color-mix(in srgb, var(--ui-border-subtle) 80%, var(--ui-brand-500) 20%)'} !important;
        color: ${isDark ? 'var(--farm-brand-300)' : 'var(--farm-brand-600)'} !important;
        box-shadow: ${isDark
          ? '0 10px 24px -18px color-mix(in srgb, var(--ui-shadow-panel-strong) 55%, transparent)'
          : '0 10px 24px -18px color-mix(in srgb, var(--ui-shadow-panel) 24%, transparent)'} !important;
      }
      .cards-grid > .entry-card:nth-child(1) .card-tag {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface) 78%, transparent)'
          : 'color-mix(in srgb, var(--ui-status-success-soft) 22%, var(--ui-bg-surface-raised) 78%)'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 70%, var(--ui-status-success) 30%) !important;
        color: ${isDark ? 'var(--text-muted)' : 'color-mix(in srgb, var(--ui-status-success) 48%, var(--text-muted) 52%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(2) .card-tag {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface) 78%, transparent)'
          : 'color-mix(in srgb, var(--ui-status-warning-soft) 20%, var(--ui-bg-surface-raised) 80%)'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 70%, var(--ui-status-warning) 30%) !important;
        color: ${isDark ? 'var(--text-muted)' : 'color-mix(in srgb, var(--ui-status-warning) 46%, var(--text-muted) 54%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(3) .card-tag {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface) 78%, transparent)'
          : 'color-mix(in srgb, var(--ui-status-info-soft) 20%, var(--ui-bg-surface-raised) 80%)'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 70%, var(--ui-status-info) 30%) !important;
        color: ${isDark ? 'var(--text-muted)' : 'color-mix(in srgb, var(--ui-status-info) 48%, var(--text-muted) 52%)'} !important;
      }
      .cards-grid > .entry-card:nth-child(1) .card-arrow {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'color-mix(in srgb, var(--ui-status-success-soft) 22%, var(--ui-bg-surface-raised) 78%)'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 70%, var(--ui-status-success) 30%) !important;
        color: ${isDark ? 'var(--farm-brand-300)' : 'var(--ui-status-success)'} !important;
      }
      .cards-grid > .entry-card:nth-child(2) .card-arrow {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'color-mix(in srgb, var(--ui-status-warning-soft) 22%, var(--ui-bg-surface-raised) 78%)'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 70%, var(--ui-status-warning) 30%) !important;
        color: ${isDark ? 'var(--farm-brand-300)' : 'var(--ui-status-warning)'} !important;
      }
      .cards-grid > .entry-card:nth-child(3) .card-arrow {
        background: ${isDark
          ? 'color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent)'
          : 'color-mix(in srgb, var(--ui-status-info-soft) 22%, var(--ui-bg-surface-raised) 78%)'} !important;
        border-color: color-mix(in srgb, var(--ui-border-subtle) 70%, var(--ui-status-info) 30%) !important;
        color: ${isDark ? 'var(--farm-brand-300)' : 'var(--ui-status-info)'} !important;
      }

      [class*="bg-"][class*="white/60"], [class*="dark:bg-"][class*="slate-800/60"] {
        background-color: var(--ui-bg-surface-raised) !important;
      }

      /* 土地卡片图片区 & 特殊土地状态区域的各种浅色渐变 → 彻底清除渐变 */
      .bg-gradient-to-br[class*="from-red-50"], .bg-gradient-to-br[class*="from-orange-50"],
      .bg-gradient-to-br[class*="from-slate-100"], .bg-gradient-to-br[class*="from-stone-100"],
      .bg-gradient-to-br[class*="from-stone-50"], .bg-gradient-to-br[class*="from-yellow-50"],
      .bg-gradient-to-br[class*="from-gray-50"] {
        background-image: none !important;
        background-color: var(--ui-bg-surface) !important;
        --tw-gradient-from: transparent !important; --tw-gradient-to: transparent !important;
      }

      /* 植物卡片种子缩略图区域 & 网格格子 */
      .bg-gradient-to-br.from-primary-50, .bg-gradient-to-br[class*="from-primary-50"] {
        background-image: none !important;
        background-color: ${isDark ? 'var(--farm-brand-soft-08)' : 'var(--farm-brand-soft-06)'} !important;
        --tw-gradient-from: transparent !important; --tw-gradient-to: transparent !important;
      }

      /* 网格格子 */
      .grid-cell.bg-gradient-to-br, .grid-cell[class*="from-primary-50"] {
        background-image: none !important;
        background-color: ${isDark ? 'var(--farm-brand-soft-10)' : 'var(--farm-brand-soft-08)'} !important;
      }
      
      /* 兜底：所有未被上面匹配的渐变容器，如果包含浅色 from-* 类名 */
      [class*="from-"][class*="-50"], [class*="from-"][class*="-100"]:not([class*="from-primary-700"]) {
        background-image: none !important; background-color: var(--ui-bg-surface) !important;
      }
      /* 🔥 暴力全局覆盖：高特异性复合选择器，确保所有浅色渐变被清除 */
      .bg-gradient-to-br[class*="-50"], .bg-gradient-to-br[class*="-100"]:not([class*="from-primary-700"]),
      .bg-gradient-to-r[class*="-50"], .bg-gradient-to-r[class*="-100"]:not([class*="from-primary-700"]) {
        --tw-gradient-from: transparent !important; --tw-gradient-to: transparent !important; --tw-gradient-stops: transparent !important;
        background-image: none !important; background-color: var(--ui-bg-surface) !important;
      }
      
      /* =========== 属性行的浅色背景条 =========== */
      .bg-primary-50, [class*="bg-primary-50"] { background-color: ${isDark ? 'var(--farm-brand-soft-08)' : 'var(--farm-brand-soft-06)'} !important; }
      .bg-blue-50, [class*="bg-blue-50"] { background-color: color-mix(in srgb, var(--ui-status-info-soft) ${isDark ? '44%' : '32%'}, transparent) !important; }
      .bg-purple-50, [class*="bg-purple-50"] { background-color: color-mix(in srgb, var(--ui-status-info-soft) ${isDark ? '36%' : '28%'}, transparent) !important; }
      .bg-red-50, [class*="bg-red-50"] { background-color: color-mix(in srgb, var(--ui-status-danger-soft) ${isDark ? '42%' : '30%'}, transparent) !important; }
      .bg-green-50, [class*="bg-green-50"] { background-color: color-mix(in srgb, var(--ui-status-success-soft) ${isDark ? '42%' : '30%'}, transparent) !important; }
      .bg-yellow-50, [class*="bg-yellow-50"] { background-color: color-mix(in srgb, var(--ui-status-warning-soft) ${isDark ? '44%' : '32%'}, transparent) !important; }
      .bg-stone-50, .bg-stone-100, [class*="bg-stone-50"], [class*="bg-stone-100"] { background-color: ${subtleBg} !important; }
      
      /* =========== 徽章底色统一 =========== */
      .bg-primary-100, [class*="bg-primary-100"] { background-color: ${isDark ? 'var(--farm-brand-soft-15)' : 'var(--farm-brand-soft-12)'} !important; }
      .bg-red-100 { background-color: color-mix(in srgb, var(--ui-status-danger-soft) ${isDark ? '70%' : '52%'}, transparent) !important; }
      .bg-yellow-100 { background-color: color-mix(in srgb, var(--ui-status-warning-soft) ${isDark ? '70%' : '52%'}, transparent) !important; }
      .bg-slate-200 { background-color: var(--ui-bg-surface-raised) !important; }
      .bg-amber-400 { background-color: var(--farm-brand-soft-90) !important; }
      
      /* =========== 表单元素动态背景 =========== */
      input, select, textarea {
        background: var(--ui-bg-surface-raised) !important;
        border: 1px solid var(--glass-border) !important; color: inherit !important;
      }
      
      /* =========== 表格条纹色 =========== */
      th { background-color: ${stripeBg} !important; color: var(--text-main) !important; }

      /* =========== 🎨 卡片边框色统一软化 =========== */
      .land-card, .plant-card { border-color: var(--ui-border-subtle) !important; }
      /* 特定颜色边框降噪 */
      .border-primary-200, .border-primary-400, [class*="border-primary-"] { border-color: ${isDark ? 'var(--farm-brand-soft-25)' : 'var(--farm-brand-soft-35)'} !important; }
      .border-red-300, [class*="border-red-"] { border-color: color-mix(in srgb, var(--ui-border-subtle) ${isDark ? '62%' : '52%'}, var(--ui-status-danger) ${isDark ? '38%' : '48%'}) !important; }
      .border-yellow-400, [class*="border-yellow-"] { border-color: color-mix(in srgb, var(--ui-border-subtle) ${isDark ? '58%' : '50%'}, var(--ui-status-warning) ${isDark ? '42%' : '50%'}) !important; }
      .border-green-300, [class*="border-green-"] { border-color: color-mix(in srgb, var(--ui-border-subtle) ${isDark ? '62%' : '52%'}, var(--ui-status-success) ${isDark ? '38%' : '48%'}) !important; }
      .border-slate-300, .border-slate-400, [class*="border-slate-3"], [class*="border-slate-4"] { border-color: var(--ui-border-subtle) !important; }
      
      /* =========== 🏷️ 徽章文字色柔化 =========== */
      .bonus-tag.bg-primary-100, .bonus-tag[class*="bg-primary-100"] {
        background-color: ${isDark ? 'var(--farm-brand-soft-15)' : 'var(--farm-brand-soft-12)'} !important;
        color: ${isDark ? 'var(--farm-brand-300)' : 'var(--farm-brand-700)'} !important;
      }
      .bonus-tag.bg-red-100 { background-color: color-mix(in srgb, var(--ui-status-danger-soft) ${isDark ? '70%' : '52%'}, transparent) !important; color: var(--ui-status-danger) !important; }
      .bonus-tag.bg-yellow-100 { background-color: color-mix(in srgb, var(--ui-status-warning-soft) ${isDark ? '70%' : '52%'}, transparent) !important; color: var(--ui-status-warning) !important; }
      .bonus-tag.bg-slate-200 { background-color: var(--ui-bg-surface-raised) !important; color: var(--text-muted) !important; }
      /* 通用 Lv 徽章（amber-400底色的那种） */
      .bg-amber-400 { background-color: ${isDark ? 'var(--farm-brand-soft-70)' : 'var(--farm-brand-soft-85)'} !important; }
      
      /* =========== 📊 属性值文字色降噪 =========== */
      .text-primary-600, .text-primary-700, [class*="text-primary-6"], [class*="text-primary-7"] { color: ${isDark ? 'var(--farm-brand-400)' : 'var(--farm-brand-600)'} !important; }
      .text-blue-600, [class*="text-blue-6"] { color: ${isDark ? 'var(--farm-brand-400)' : 'var(--farm-brand-600)'} !important; }
      .text-purple-600, [class*="text-purple-6"] { color: ${isDark ? 'var(--farm-brand-400)' : 'var(--farm-brand-600)'} !important; }
      .text-red-600, .text-red-700, [class*="text-red-6"], [class*="text-red-7"] { color: var(--ui-status-danger) !important; }
      .text-yellow-700, [class*="text-yellow-7"] { color: var(--ui-status-warning) !important; }
      
      /* =========== 🔲 网格格子边框与文字 =========== */
      .grid-cell { border-color: ${isDark ? 'var(--farm-brand-soft-20)' : 'var(--farm-brand-soft-30)'} !important; }
      .grid-cell[class*="border-amber"], .grid-cell[class*="border-yellow"] { border-color: color-mix(in srgb, var(--ui-border-subtle) ${isDark ? '68%' : '58%'}, var(--ui-status-warning) ${isDark ? '32%' : '42%'}) !important; }
      .grid-cell[class*="border-slate"], .grid-cell[class*="border-gray"] { border-color: var(--ui-border-subtle) !important; }
      .grid-cell .text-primary-700 { color: ${isDark ? 'var(--farm-brand-300)' : 'var(--farm-brand-700)'} !important; }
      .grid-cell .text-primary-600, .grid-cell [class*="text-primary-6"] { color: ${isDark ? 'var(--farm-brand-400)' : 'var(--farm-brand-600)'} !important; }
      .grid-cell [class*="text-amber"], .grid-cell [class*="text-yellow"] { color: var(--ui-status-warning) !important; }
      .grid-cell [class*="text-slate"] { color: var(--text-muted) !important; }
      
      /* 开关 Toggle */
      .fert-toggle input[type="checkbox"] { background: var(--ui-border-strong) !important; }
      
      /* 施肥阶段选择动态字色 */
      .tc-fert-phase-btn.selected { color: ${isDark ? 'var(--farm-brand-300)' : 'var(--farm-brand-700)'} !important; }
      .tc-fert-phase-btn:hover { border-color: ${isDark ? 'var(--farm-brand-400)' : 'var(--farm-brand-300)'} !important; }
      
      /* ⓘ 说明按钮 */
      .info-btn:hover { background: var(--farm-brand-soft-10) !important; color: ${isDark ? 'var(--farm-brand-300)' : 'var(--farm-brand-600)'} !important; }
      .info-btn[data-info-key="smart-fert"] { color: ${isDark ? 'var(--farm-brand-400)' : 'var(--farm-brand-600)'} !important; }
      
      /* =========== 🌙 深色模式下 Hero/Tab 亮度柔化 =========== */
      /* calc-hero 渐变区域：降低渐变不透明度，避免浅色系主题的 primary 色在深底上太亮 */
      .calc-hero, .level-hero, .plant-hero, .land-hero {
        background: ${isDark ? 'linear-gradient(135deg, var(--farm-brand-900-soft-40) 0%, var(--farm-brand-800-soft-25) 50%, transparent 100%)' : 'linear-gradient(135deg, var(--farm-brand-200-soft-30) 0%, var(--farm-brand-100-soft-20) 50%, var(--glass-bg) 100%)'} !important;
        border-bottom-color: ${isDark ? 'var(--farm-brand-soft-15)' : 'var(--farm-brand-300-soft-40)'} !important;
      }
      .calc-hero h1, .level-hero h1, .plant-hero h1, .land-hero h1 {
        color: ${isDark ? 'var(--farm-brand-300)' : 'var(--farm-brand-800)'} !important;
      }
      
      /* Tab 激活态：使用深色系主题色替代原始 primary-500 纯色 */
      .calc-mode-tab.active {
        background: ${isDark ? 'var(--farm-brand-900)' : 'var(--farm-brand-500)'} !important;
        color: ${isDark ? 'var(--farm-brand-200)' : 'var(--ui-text-on-brand)'} !important;
        border-color: ${isDark ? 'var(--farm-brand-soft-30)' : 'var(--farm-brand-500)'} !important;
      }
      .rank-tab.active, .v-crop-tab.v-active, .level-tab.active {
        background: ${isDark ? 'var(--farm-brand-900)' : 'var(--farm-brand-500)'} !important;
        color: ${isDark ? 'var(--farm-brand-200)' : 'var(--ui-text-on-brand)'} !important;
        border-color: ${isDark ? 'var(--farm-brand-soft-30)' : 'var(--farm-brand-500)'} !important;
      }

      /* 计算摘要条 */
      .calc-summary {
        background: ${isDark ? 'var(--farm-brand-900-soft-30)' : 'var(--farm-brand-100-soft-20)'} !important;
        border-color: ${isDark ? 'var(--farm-brand-soft-15)' : 'var(--farm-brand-300-soft-40)'} !important;
        color: ${isDark ? 'var(--text-main)' : 'var(--farm-brand-800)'} !important;
      }
      
      /* 推荐卡左侧彩条降低亮度 */
      .rec-card.card-no-fert {
        border-left-color: ${isDark ? 'var(--farm-brand-soft-50)' : 'var(--farm-brand-500)'} !important;
      }
      
      /* 主按钮在深色模式下使用更深的底色 */
      .btn-calc {
        background: ${isDark ? 'linear-gradient(135deg, var(--farm-brand-800), var(--farm-brand-900))' : 'linear-gradient(135deg, var(--farm-brand-500), var(--farm-brand-600))'} !important;
        color: ${isDark ? 'var(--farm-brand-200)' : 'var(--ui-text-on-brand)'} !important;
        box-shadow: ${isDark ? '0 2px 8px var(--farm-brand-soft-20)' : '0 2px 8px var(--farm-brand-soft-35)'} !important;
      }
      
      /* 验算按钮 */
      .btn-verify {
        background: ${isDark ? 'linear-gradient(135deg, var(--farm-brand-800), var(--farm-brand-900))' : 'linear-gradient(135deg, var(--farm-brand-400), var(--farm-brand-600))'} !important;
        color: ${isDark ? 'var(--farm-brand-200)' : 'var(--ui-text-on-brand)'} !important;
      }
      
      /* 开关激活态柔化 */
      .fert-toggle input[type="checkbox"]:checked { 
        background: ${isDark ? 'var(--farm-brand-800)' : 'var(--farm-brand-500)'} !important;
      }
      
      /* land-info 信息条 */
      .land-info {
        background: ${isDark ? 'var(--farm-brand-900-soft-30)' : 'var(--farm-brand-100-soft-20)'} !important;
        color: ${isDark ? 'var(--farm-brand-300)' : 'var(--farm-brand-600)'} !important;
      }
    `

    // 强制同步深色类
    if (isDark) {
      doc.documentElement.classList.add('dark')
    }
    else {
      doc.documentElement.classList.remove('dark')
    }

    // 🔥 终极兜底：JavaScript DOM 遍历，强制覆盖所有浅色渐变元素的内联样式
    const forceOverrideGradients = () => {
      const lightGradientKeywords = [
        'from-red-50',
        'from-orange-50',
        'from-stone-100',
        'from-stone-50',
        'from-yellow-50',
        'from-gray-50',
        'from-slate-100',
        'from-primary-50',
        'to-primary-100',
        'to-yellow-50',
        'to-orange-50',
        'to-stone-50',
        'to-gray-50',
      ]
      const heroKeywords = ['from-primary-700', 'from-primary-600']

      doc.querySelectorAll('.bg-gradient-to-br, [class*="from-"]').forEach((rawEl) => {
        const el = rawEl as HTMLElement
        const cls = el.className || ''
        // 跳过 Hero 区域渐变
        if (heroKeywords.some(k => cls.includes(k)))
          return
        // 检测是否包含浅色渐变类
        if (lightGradientKeywords.some(k => cls.includes(k))) {
          el.style.setProperty('background-image', 'none', 'important')
          el.style.setProperty('background-color', 'var(--ui-bg-surface)', 'important')
        }
      })
    }
    // 🔧 优化 #3: 缩减延迟同步轮次，从 6 次减轻到 3 次
    forceOverrideGradients()
    setTimeout(forceOverrideGradients, 400)
    setTimeout(forceOverrideGradients, 1200)

    // 🔥 解决白屏闪烁：主题应用完毕后，再解除 iframe 内部的透明遮罩
    doc.documentElement.style.opacity = '1'
  }
  catch (e) {
    console.warn('Iframe 样式劫持失败:', e)
  }
}

function onIframeLoad() {
  syncThemeToIframe()
  // 🔧 优化 #3: 初始重载时缩减多轮定时，仅执行一次后续兜底即可
  setTimeout(() => syncThemeToIframe(), 600)
}

// 监听 html class 属性变化 (主题切换)
let observer: MutationObserver | null = null
onMounted(() => {
  loadManifest()
  observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class') {
        syncThemeToIframe()
      }
    })
  })
  observer.observe(document.documentElement, { attributes: true })
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
  }
  // 🔧 优化 #2: 清理 iframe 内部的 observer 控制器，避免内存泄漏
  if (iframeObserver) {
    iframeObserver.disconnect()
    iframeObserver = null
  }
})
</script>

<template>
  <div class="farm-tools-page ui-page-shell ui-page-density-relaxed h-full min-h-0 w-full flex flex-col overflow-hidden">
    <div v-if="!standaloneMode" class="farm-tools-mobile-toolbar ui-mobile-sticky-panel ui-mobile-action-panel lg:hidden">
      <div class="farm-tools-mobile-toolbar-head">
        <button
          class="farm-tools-menu-trigger"
          :title="sidebarVisible ? '收起目录' : '展开目录'"
          @click="toggleSidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 transition-transform duration-200" :class="{ 'rotate-180': !sidebarVisible }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          <span>{{ sidebarVisible ? '收起目录' : '打开目录' }}</span>
        </button>
        <div class="farm-tools-mobile-toolbar-current">
          <div class="farm-tools-mobile-toolbar-eyebrow">
            {{ activeSection.label }}
          </div>
          <div class="farm-tools-mobile-toolbar-title">
            <span class="farm-tools-mobile-toolbar-icon" aria-hidden="true">{{ selectedMenuItem.icon }}</span>
            <span>{{ selectedMenuItem.title }}</span>
          </div>
        </div>
        <div v-if="selectedMenuItem.count !== null" class="farm-tools-mobile-toolbar-count">
          {{ selectedMenuItem.count }}
        </div>
      </div>
    </div>

    <div class="farm-tools-shell h-full min-h-0 w-full flex gap-4">
      <div
        v-if="!standaloneMode && sidebarVisible"
        class="farm-tools-backdrop fixed inset-0 z-20 backdrop-blur-sm lg:hidden"
        @click="sidebarVisible = false"
      />

      <aside
        v-if="!standaloneMode"
        class="farm-tools-sidebar h-full shrink-0 flex-col rounded-2xl shadow-sm transition-all duration-300 lg:flex"
        :class="[
          sidebarVisible ? 'flex fixed inset-y-4 left-4 z-30 lg:static lg:inset-auto' : 'hidden lg:flex',
        ]"
      >
        <div class="farm-tools-sidebar-head">
          <div class="farm-tools-sidebar-brand">
            <span class="farm-tools-sidebar-brand-icon" aria-hidden="true">🌾</span>
            <div class="min-w-0">
              <div class="farm-tools-sidebar-title">
                农场百科工具
              </div>
              <div class="farm-tools-sidebar-subtitle">
                本地镜像 · 随时同步
              </div>
            </div>
          </div>
        </div>

        <nav class="farm-tools-sidebar-nav">
          <section
            v-for="section in visibleSections"
            :key="section.id"
            class="farm-tools-sidebar-section"
          >
            <div class="farm-tools-section-label">
              {{ section.label }}
            </div>

            <div class="farm-tools-section-list">
              <button
                v-for="item in section.items"
                :key="`${section.id}-${item.file}-${item.title}`"
                type="button"
                class="farm-tools-nav-item"
                :class="[
                  activeArticle === item.file ? 'farm-tools-nav-item--active' : 'farm-tools-nav-item--idle',
                ]"
                @click="selectArticle(item.file)"
              >
                <span class="farm-tools-nav-indicator" />
                <span class="farm-tools-nav-icon" aria-hidden="true">{{ item.icon }}</span>
                <span class="farm-tools-nav-copy">
                  <span class="farm-tools-nav-title">{{ item.title }}</span>
                </span>
                <span v-if="item.count !== null" class="farm-tools-nav-meta">{{ item.count }}</span>
              </button>
            </div>
          </section>
        </nav>
      </aside>

      <main class="farm-tools-main glass-panel relative m-0 h-full min-w-0 flex flex-1 flex-col overflow-hidden rounded-2xl p-0">
        <iframe
          ref="iframeRef"
          :src="`/nc_local_version/${activeArticle}`"
          class="h-full w-full flex-1 border-none bg-transparent outline-none"
          @load="onIframeLoad"
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
.farm-tools-shell {
  align-items: stretch;
  gap: var(--ui-page-gap-current);
}

.farm-tools-sidebar {
  width: min(19rem, calc(100vw - 2rem));
  max-width: calc(100vw - 2rem);
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 97%, transparent) 0%,
    color-mix(in srgb, var(--ui-bg-surface) 94%, transparent) 100%
  );
  color: var(--ui-text-1);
  box-shadow:
    0 18px 44px -28px color-mix(in srgb, var(--ui-shadow-panel) 40%, transparent),
    inset 0 1px 0 var(--ui-shadow-inner);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.dark .farm-tools-sidebar {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 84%, transparent) 0%,
    color-mix(in srgb, var(--ui-bg-surface) 78%, transparent) 100%
  );
  box-shadow:
    0 22px 58px -30px color-mix(in srgb, var(--ui-shadow-panel-strong) 55%, transparent),
    inset 0 1px 0 var(--ui-shadow-inner);
}

.farm-tools-sidebar-head {
  padding: 1.25rem 1.2rem 1rem;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-brand-500) 6%, transparent) 0%, transparent 100%);
}

.farm-tools-sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.farm-tools-sidebar-brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.9rem;
  font-size: 1.35rem;
  color: color-mix(in srgb, var(--ui-brand-600) 78%, var(--ui-text-1) 22%);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ui-brand-500) 16%, var(--ui-bg-surface-raised) 84%),
    color-mix(in srgb, var(--ui-brand-300) 12%, var(--ui-bg-surface) 88%)
  );
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--ui-shadow-inner) 70%, transparent),
    0 12px 26px -20px color-mix(in srgb, var(--ui-brand-500) 32%, transparent);
}

.farm-tools-sidebar-title {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--ui-text-1);
}

.farm-tools-sidebar-subtitle {
  margin-top: 0.28rem;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ui-text-3);
}

.dark .farm-tools-sidebar-subtitle {
  color: color-mix(in srgb, var(--ui-text-3) 86%, var(--ui-text-2) 14%);
}

.farm-tools-sidebar-nav {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.95rem 0.75rem 1rem;
}

.farm-tools-sidebar-nav::-webkit-scrollbar {
  width: 5px;
}

.farm-tools-sidebar-nav::-webkit-scrollbar-track {
  background: transparent;
}

.farm-tools-sidebar-nav::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ui-text-3) 36%, transparent);
  border-radius: 999px;
}

.farm-tools-sidebar-section + .farm-tools-sidebar-section {
  margin-top: 1rem;
}

.farm-tools-section-label {
  padding: 0 0.7rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ui-text-3);
}

.farm-tools-section-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.farm-tools-main {
  min-width: 0;
}

.farm-tools-mobile-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 1.25rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 94%, transparent) 0%,
    color-mix(in srgb, var(--ui-bg-surface) 90%, transparent) 100%
  );
  box-shadow:
    0 12px 24px -24px color-mix(in srgb, var(--ui-shadow-panel) 40%, transparent),
    inset 0 1px 0 var(--ui-shadow-inner);
}

.farm-tools-mobile-toolbar-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}

.farm-tools-mobile-toolbar-current {
  min-width: 0;
  flex: 1 1 auto;
}

.farm-tools-mobile-toolbar-eyebrow {
  color: var(--ui-text-3);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.farm-tools-mobile-toolbar-title {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.3rem;
  min-width: 0;
  color: var(--ui-text-1);
  font-size: 0.95rem;
  line-height: 1.4;
  font-weight: 700;
}

.farm-tools-mobile-toolbar-icon {
  font-size: 1.05rem;
  line-height: 1;
}

.farm-tools-mobile-toolbar-title span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.farm-tools-mobile-toolbar-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.1rem;
  height: 2.1rem;
  padding: 0 0.7rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-brand-500) 12%, var(--ui-bg-surface-raised) 88%);
  color: color-mix(in srgb, var(--ui-brand-700) 72%, var(--ui-text-1) 28%);
  border: 1px solid color-mix(in srgb, var(--ui-brand-500) 22%, var(--ui-border-subtle) 78%);
  font-size: 0.82rem;
  font-weight: 700;
}

@media (min-width: 1024px) {
  .farm-tools-sidebar {
    width: 19rem;
    max-width: none;
  }
}

.glass-panel {
  box-shadow:
    0 8px 32px 0 var(--ui-shadow-panel),
    inset 0 1px 0 var(--ui-shadow-inner);
}

.dark .glass-panel {
  box-shadow:
    0 8px 32px 0 var(--ui-shadow-panel-strong),
    inset 0 1px 0 var(--ui-shadow-inner);
}

iframe {
  color-scheme: light dark;
}

.farm-tools-menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0.625rem 0.875rem;
  border-radius: 0.95rem;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 72%, var(--ui-brand-500) 28%);
  background: color-mix(in srgb, var(--ui-brand-500) 8%, var(--ui-bg-surface-raised) 92%);
  color: var(--ui-text-1);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.farm-tools-menu-trigger:hover {
  background: color-mix(in srgb, var(--ui-brand-500) 12%, var(--ui-bg-surface-raised) 88%);
  box-shadow: 0 0 12px color-mix(in srgb, var(--ui-brand-500) 18%, transparent);
}

.dark .farm-tools-menu-trigger {
  background: color-mix(in srgb, var(--ui-brand-500) 12%, var(--ui-bg-surface-raised) 88%);
}

.dark .farm-tools-menu-trigger:hover {
  background: color-mix(in srgb, var(--ui-brand-500) 16%, var(--ui-bg-surface-raised) 84%);
}

.farm-tools-backdrop {
  background: var(--ui-overlay-backdrop) !important;
}

.farm-tools-nav-item {
  display: flex;
  align-items: center;
  gap: 0.72rem;
  width: 100%;
  padding: 0.72rem 0.8rem;
  border-radius: 0.95rem;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    opacity 160ms ease;
}

.farm-tools-nav-indicator {
  flex: 0 0 4px;
  align-self: stretch;
  border-radius: 999px;
  background: transparent;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.farm-tools-nav-icon {
  flex: 0 0 auto;
  font-size: 1rem;
  line-height: 1;
}

.farm-tools-nav-copy {
  min-width: 0;
  flex: 1 1 auto;
}

.farm-tools-nav-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--ui-text-1);
}

.farm-tools-nav-meta {
  flex: 0 0 auto;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ui-text-3);
  padding: 0.18rem 0.46rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 80%, transparent);
}

.farm-tools-nav-item--idle {
  background: color-mix(in srgb, var(--ui-bg-surface) 54%, transparent);
  border-color: color-mix(in srgb, var(--ui-border-subtle) 42%, transparent);
}

.farm-tools-nav-item--idle:hover {
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 94%, transparent);
  border-color: color-mix(in srgb, var(--ui-border-subtle) 64%, var(--ui-brand-500) 36%);
}

.farm-tools-nav-item--active {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ui-brand-500) 12%, var(--ui-bg-surface-raised) 88%),
    color-mix(in srgb, var(--ui-brand-300) 9%, var(--ui-bg-surface) 91%)
  );
  border-color: color-mix(in srgb, var(--ui-brand-500) 24%, var(--ui-border-subtle) 76%);
  box-shadow:
    0 16px 30px -24px color-mix(in srgb, var(--ui-brand-500) 34%, transparent),
    inset 0 1px 0 var(--ui-shadow-inner);
}

.farm-tools-nav-item--active .farm-tools-nav-indicator {
  background: var(--ui-brand-500);
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-brand-500) 44%, transparent);
}

.farm-tools-nav-item--active .farm-tools-nav-title {
  color: color-mix(in srgb, var(--ui-brand-700) 72%, var(--ui-text-1) 28%);
}

.farm-tools-nav-item--active .farm-tools-nav-meta {
  color: color-mix(in srgb, var(--ui-brand-600) 64%, var(--ui-text-2) 36%);
  background: color-mix(in srgb, var(--ui-brand-500) 10%, var(--ui-bg-surface-raised) 90%);
  border-color: color-mix(in srgb, var(--ui-brand-500) 18%, var(--ui-border-subtle) 82%);
}
</style>
