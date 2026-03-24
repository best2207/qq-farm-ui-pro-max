<script setup lang="ts">
import type { HelpArticle, HelpArticleOutlineItem, ResolvedHelpArticle } from '@/data/help-articles'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HelpArticleBody from '@/components/help/HelpArticleBody.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useCopyInteraction } from '@/composables/use-copy-interaction'
import {
  developmentProgress,
  getHelpAudienceLabel,
  getHelpFreshnessLabel,
  getHelpFreshnessTone,
  getHelpGovernanceStatusLabel,
  getHelpGovernanceStatusTone,
  helpArticles,
  helpCategories,
  helpReleaseNotes,
  helpReleaseSyncStatus,
  loadHelpSearchIndex,
  resolveHelpArticle,
} from '@/data/help-articles'
import { useAppStore } from '@/stores/app'

type HelpAudienceFilter = 'all' | 'recommended' | 'all-users' | 'operator' | 'admin'

const appStore = useAppStore()
const route = useRoute()
const router = useRouter()
const { copyText } = useCopyInteraction({
  successTitle: '帮助文档已复制',
  failureMessage: '复制失败，请手动复制',
})

const ARTICLE_QUERY_KEY = 'article'
const AUDIENCE_QUERY_KEY = 'audience'
const SECTION_QUERY_KEY = 'section'
const searchQuery = ref('')
const selectedArticleId = ref(helpArticles[0]?.id || '')
const expandedCategory = ref(helpCategories[0]?.name || '')
const selectedAudienceFilter = ref<HelpAudienceFilter>('recommended')
const selectedSectionId = ref('')
const currentUserRole = ref<'admin' | 'user'>('user')
const currentArticleContent = ref<ResolvedHelpArticle | null>(null)
const currentArticleLoading = ref(false)
const searchIndexState = ref<'idle' | 'loading' | 'ready'>('idle')
const searchIndexedArticles = ref<Record<string, ResolvedHelpArticle>>({})
const articleBodyReadyTick = ref(0)
const isSidebarSummaryExpanded = ref(false)
const navRef = ref<HTMLElement | null>(null)

function findArticle(articleId: string) {
  return helpArticles.find(article => article.id === articleId) || null
}

function readCurrentUserRole() {
  if (typeof window === 'undefined')
    return 'user'

  try {
    const currentUser = JSON.parse(window.localStorage.getItem('current_user') || 'null')
    return currentUser?.role === 'admin' ? 'admin' : 'user'
  }
  catch {
    return 'user'
  }
}

function normalizeArticleQuery(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const articleId = String(raw || '').trim()
  if (articleId && helpArticles.some(article => article.id === articleId))
    return articleId
  return helpArticles[0]?.id || ''
}

function normalizeAudienceQuery(value: unknown): HelpAudienceFilter {
  const raw = String(Array.isArray(value) ? value[0] : value || '').trim()
  if (['all', 'recommended', 'all-users', 'operator', 'admin'].includes(raw))
    return raw as HelpAudienceFilter
  return 'recommended'
}

function normalizeSectionQuery(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim()
}

function syncSelectedArticle(articleId: string, options: { updateRoute?: boolean, clearSearch?: boolean, sectionId?: string } = {}) {
  const article = findArticle(articleId)
  if (!article)
    return

  selectedArticleId.value = article.id
  expandedCategory.value = article.category
  selectedSectionId.value = typeof options.sectionId === 'string' ? options.sectionId : ''

  if (options.clearSearch !== false)
    searchQuery.value = ''

  if (options.updateRoute !== false) {
    const rawQueryArticle = Array.isArray(route.query[ARTICLE_QUERY_KEY])
      ? route.query[ARTICLE_QUERY_KEY][0]
      : route.query[ARTICLE_QUERY_KEY]
    const rawQuerySection = Array.isArray(route.query[SECTION_QUERY_KEY])
      ? route.query[SECTION_QUERY_KEY][0]
      : route.query[SECTION_QUERY_KEY]
    if (String(rawQueryArticle || '').trim() !== article.id || String(rawQuerySection || '').trim() !== selectedSectionId.value) {
      void router.replace({
        query: {
          ...route.query,
          [ARTICLE_QUERY_KEY]: article.id,
          [SECTION_QUERY_KEY]: selectedSectionId.value || undefined,
        },
      })
    }
  }
}

function syncAudienceFilter(filter: HelpAudienceFilter, options: { updateRoute?: boolean } = {}) {
  selectedAudienceFilter.value = filter

  if (options.updateRoute !== false) {
    const rawQueryAudience = Array.isArray(route.query[AUDIENCE_QUERY_KEY])
      ? route.query[AUDIENCE_QUERY_KEY][0]
      : route.query[AUDIENCE_QUERY_KEY]
    if (String(rawQueryAudience || '').trim() !== filter) {
      void router.replace({
        query: {
          ...route.query,
          [AUDIENCE_QUERY_KEY]: filter,
        },
      })
    }
  }
}

function matchesAudienceFilter(article: HelpArticle, filter: HelpAudienceFilter) {
  if (filter === 'all')
    return true
  if (filter === 'all-users')
    return article.audience === 'all'
  if (filter === 'recommended')
    return currentUserRole.value === 'admin' ? true : article.audience !== 'admin'
  return article.audience === filter
}

watch(() => route.query[ARTICLE_QUERY_KEY], (nextArticleId) => {
  const normalized = normalizeArticleQuery(nextArticleId)
  if (!normalized)
    return
  if (selectedArticleId.value !== normalized)
    syncSelectedArticle(normalized, { updateRoute: false, clearSearch: false })
}, { immediate: true })

watch(() => route.query[AUDIENCE_QUERY_KEY], (nextAudience) => {
  const normalized = normalizeAudienceQuery(nextAudience)
  if (selectedAudienceFilter.value !== normalized)
    syncAudienceFilter(normalized, { updateRoute: false })
}, { immediate: true })

watch(() => route.query[SECTION_QUERY_KEY], (nextSection) => {
  const normalized = normalizeSectionQuery(nextSection)
  if (selectedSectionId.value !== normalized)
    selectedSectionId.value = normalized
}, { immediate: true })

const currentArticle = computed<HelpArticle | null>(() => {
  return findArticle(selectedArticleId.value)
})

function getIndexedArticle(article: HelpArticle | null) {
  if (!article)
    return null
  if (currentArticleContent.value?.id === article.id)
    return currentArticleContent.value
  return searchIndexedArticles.value[article.id] || null
}

function getArticleSearchCorpus(article: HelpArticle) {
  return getIndexedArticle(article)?.searchText || article.metadataSearchText
}

const articleOutline = computed<HelpArticleOutlineItem[]>(() => currentArticleContent.value?.outline || [])
const isSearching = computed(() => searchQuery.value.trim().length > 0)
const isSearchIndexLoading = computed(() => searchIndexState.value === 'loading')
const siteTitle = computed(() => appStore.siteTitle)
const supportQqGroup = computed(() => appStore.supportQqGroup)
const supportQqGroupLink = computed(() => `tencent://message/?uin=${supportQqGroup.value}&Site=&Menu=yes`)
const latestReleaseNotes = computed(() => helpReleaseNotes.slice(0, 3))

const publishedArticles = computed(() => {
  return helpArticles.filter(article => article.reviewStatus === 'published')
})

const filteredArticles = computed(() => {
  return publishedArticles.value.filter(article => matchesAudienceFilter(article, selectedAudienceFilter.value))
})

const audienceFilters = computed(() => {
  const items: Array<{ value: HelpAudienceFilter, label: string, description: string }> = [
    { value: 'recommended', label: '推荐视角', description: '按当前登录角色过滤掉明显无关的文档。' },
    { value: 'all', label: '全部文档', description: '显示所有帮助文档。' },
    { value: 'all-users', label: '全部用户', description: '只看所有人都适用的内容。' },
    { value: 'operator', label: '运营 / 多账号', description: '聚焦流程、批量运营和多账号管理。' },
    { value: 'admin', label: '管理员', description: '聚焦后台、部署、更新和权限治理。' },
  ]

  return items.map(item => ({
    ...item,
    count: publishedArticles.value.filter(article => matchesAudienceFilter(article, item.value)).length,
  }))
})

const activeAudienceFilter = computed(() => {
  return audienceFilters.value.find(item => item.value === selectedAudienceFilter.value) || audienceFilters.value[0]
})

const currentRoleLabel = computed(() => {
  return currentUserRole.value === 'admin' ? '管理员' : '普通用户'
})

const coveragePercent = computed(() => {
  const totalArticles = Math.max(developmentProgress.totalArticles, 1)
  return Math.round((developmentProgress.completedArticles / totalArticles) * 100)
})

function getRecommendationRoles() {
  const roles = new Set(['all'])

  if (selectedAudienceFilter.value === 'admin') {
    roles.add('admin')
    return [...roles]
  }

  if (selectedAudienceFilter.value === 'operator') {
    roles.add('operator')
    return [...roles]
  }

  if (selectedAudienceFilter.value === 'all-users')
    return [...roles]

  if (currentUserRole.value === 'admin') {
    roles.add('admin')
    if (selectedAudienceFilter.value === 'all' || currentArticle.value?.audience === 'operator')
      roles.add('operator')
    return [...roles]
  }

  roles.add('operator')
  return [...roles]
}

const mustReadRecommendations = computed(() => {
  const roles = getRecommendationRoles()
  const currentId = currentArticle.value?.id
  const currentCategory = currentArticle.value?.category

  return filteredArticles.value
    .filter(article => article.id !== currentId)
    .map((article) => {
      const matchedProfile = article.mustReadProfiles.find(profile => roles.includes(profile.role))
      if (!matchedProfile)
        return null

      let score = matchedProfile.role === 'all' ? 6 : 9
      if (article.freshness === 'current')
        score += 3
      else if (article.freshness === 'recent')
        score += 1
      if (currentCategory && article.category === currentCategory)
        score += 2
      if (article.id === 'troubleshooting' || article.id === 'release-highlights')
        score += 1

      return {
        article,
        reason: matchedProfile.reason,
        score,
      }
    })
    .filter((item): item is { article: HelpArticle, reason: string, score: number } => !!item)
    .sort((a, b) => b.score - a.score || b.article.updatedAt.localeCompare(a.article.updatedAt) || a.article.title.localeCompare(b.article.title, 'zh-CN'))
    .slice(0, 4)
})

const featuredRecommendations = computed(() => mustReadRecommendations.value.slice(0, 3))

const categoryCards = computed(() => {
  return helpCategories
    .map(category => ({
      ...category,
      expanded: expandedCategory.value === category.name,
      items: filteredArticles.value.filter(article => article.category === category.name),
    }))
    .filter(category => category.items.length > 0)
})

function scoreArticle(article: HelpArticle, keywords: string[]) {
  let score = 0
  const title = article.title.toLowerCase()
  const summary = article.summary.toLowerCase()
  const category = article.category.toLowerCase()
  const tags = article.tags.map(tag => tag.toLowerCase())
  const searchCorpus = getArticleSearchCorpus(article)

  for (const keyword of keywords) {
    if (title.includes(keyword))
      score += 10
    if (summary.includes(keyword))
      score += 6
    if (category.includes(keyword))
      score += 4
    if (tags.some(tag => tag.includes(keyword)))
      score += 5
    if (searchCorpus.includes(keyword))
      score += 2
  }

  return score
}

function buildSearchExcerpt(article: HelpArticle, keywords: string[]) {
  const indexedArticle = getIndexedArticle(article)
  const text = indexedArticle?.plainText?.replace(/\s+/g, ' ').trim() || ''
  if (!text)
    return article.summary

  const firstKeyword = keywords.find(keyword => getArticleSearchCorpus(article).includes(keyword)) || ''
  if (!firstKeyword)
    return article.summary

  const index = text.toLowerCase().indexOf(firstKeyword)
  if (index < 0)
    return article.summary

  const start = Math.max(0, index - 32)
  const end = Math.min(text.length, index + 88)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

const searchResults = computed(() => {
  const keywords = searchQuery.value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (!keywords.length)
    return []

  return filteredArticles.value
    .map(article => ({
      article,
      score: scoreArticle(article, keywords),
      excerpt: buildSearchExcerpt(article, keywords),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title, 'zh-CN'))
    .slice(0, 12)
})

function toggleCategory(categoryName: string) {
  expandedCategory.value = expandedCategory.value === categoryName ? '' : categoryName
}

function toggleLibraryHierarchy() {
  expandedCategory.value = expandedCategory.value
    ? ''
    : (currentArticle.value?.category || categoryCards.value[0]?.name || '')
}

function toggleSidebarSummary() {
  isSidebarSummaryExpanded.value = !isSidebarSummaryExpanded.value
}

async function syncActiveNavItemIntoView(behavior: ScrollBehavior = 'smooth') {
  if (isSearching.value)
    return

  await nextTick()

  const nav = navRef.value
  if (!nav)
    return

  const activeItem = nav.querySelector<HTMLElement>('.help-nav-item--active')
  const activeGroup = nav.querySelector<HTMLElement>('.help-nav-group__button--active')
  const target = activeItem || activeGroup
  if (!target)
    return

  const navRect = nav.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = targetRect.top - navRect.top + nav.scrollTop
  const nextTop = Math.max(0, targetTop - (nav.clientHeight / 2) + (targetRect.height / 2))

  nav.scrollTo({
    top: nextTop,
    behavior,
  })
}

function copyCurrentPlainText() {
  const article = currentArticleContent.value
  if (!article)
    return
  void copyText(article.plainText, `${article.title} 已复制为纯文本`, {
    detail: '可直接粘贴到群消息、工单或备忘录中。',
  })
}

function copyCurrentMarkdown() {
  const article = currentArticleContent.value
  if (!article)
    return
  void copyText(article.markdown.trim(), `${article.title} Markdown 已复制`, {
    detail: '原始 Markdown 内容已写入系统剪贴板。',
  })
}

async function scrollToSection(sectionId: string, behavior: ScrollBehavior = 'smooth') {
  if (!sectionId)
    return false

  await nextTick()

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = document.getElementById(sectionId)
    if (target) {
      target.scrollIntoView({ behavior, block: 'start' })
      return true
    }
    await new Promise(resolve => window.requestAnimationFrame(() => resolve(undefined)))
  }

  return false
}

function jumpToOutline(item: HelpArticleOutlineItem) {
  const article = currentArticle.value
  if (!article)
    return

  syncSelectedArticle(article.id, {
    clearSearch: false,
    sectionId: item.id,
  })
  void scrollToSection(item.id)
}

function getAudienceTone(article: HelpArticle | null) {
  if (!article)
    return 'neutral'
  if (article.audience === 'admin')
    return 'warning'
  if (article.audience === 'operator')
    return 'info'
  return 'success'
}

function openReleaseHighlights() {
  syncSelectedArticle('release-highlights')
}

function getGovernanceCadence(article: HelpArticle | null) {
  if (!article)
    return '按版本维护'

  if (article.freshness === 'current')
    return '7 天复核'
  if (article.category === '运维部署' || article.category === '故障排查')
    return '14 天复核'
  return '30 天复核'
}

function buildGovernanceTemplate(type: 'outdated' | 'suggestion') {
  const article = currentArticle.value
  if (!article)
    return ''

  const issueLabel = type === 'outdated' ? '文档疑似过期' : '文档补充建议'
  return [
    `# ${issueLabel}`,
    '',
    `- 治理单号: ${article.governance.trackingKey}`,
    `- 文章: ${article.title}`,
    `- 文章 ID: ${article.id}`,
    `- 分类: ${article.category}`,
    `- 当前帮助中心版本: ${developmentProgress.version}`,
    `- 文档更新时间: ${article.updatedAt}`,
    `- 当前阅读视角: ${activeAudienceFilter.value?.label || '推荐视角'}`,
    `- 负责人: ${article.governance.owner}`,
    `- 最近复核人: ${article.governance.lastReviewedBy}`,
    `- 最近复核时间: ${article.governance.lastReviewedAt}`,
    `- 当前治理状态: ${getHelpGovernanceStatusLabel(article.governance.status)}`,
    '',
    '## 问题描述',
    '- 这里填写你看到的差异、遗漏或不清楚的地方',
    '',
    '## 建议修订',
    '- 这里填写建议的新口径、要补的步骤或要补的截图/命令',
  ].join('\n')
}

function copyGovernanceTemplate(type: 'outdated' | 'suggestion') {
  const template = buildGovernanceTemplate(type)
  if (!template)
    return

  void copyText(template, type === 'outdated' ? '过期反馈模板已复制' : '补充建议模板已复制', {
    detail: '可以直接粘贴到群消息、工单或文档修订记录里。',
  })
}

function copyGovernanceTaskTemplate() {
  const article = currentArticle.value
  if (!article)
    return

  const template = [
    '# 帮助中心治理任务',
    '',
    `- 治理单号: ${article.governance.trackingKey}`,
    `- 文档标题: ${article.title}`,
    `- 文档 ID: ${article.id}`,
    `- 当前状态: 待确认`,
    `- 当前治理状态: ${getHelpGovernanceStatusLabel(article.governance.status)}`,
    `- 负责人: ${article.governance.owner}`,
    `- 维护组: ${article.governance.ownerTeam}`,
    `- 最近复核人: ${article.governance.lastReviewedBy}`,
    `- 最近复核时间: ${article.governance.lastReviewedAt}`,
    `- 建议动作: ${article.governance.nextAction}`,
    '',
    '## 触发原因',
    '- 填写这次为什么需要复核或补文档',
    '',
    '## 处理清单',
    '- [ ] 复核真实页面 / 命令 / 日志链路',
    '- [ ] 更新帮助文档正文与相关跳转',
    '- [ ] 回归验证搜索、复制与上下文入口',
    '- [ ] 更新治理状态与最近复核人',
  ].join('\n')

  void copyText(template, '治理任务模板已复制', {
    detail: '可以直接粘贴到工单、Issue 或修订记录里继续跟踪。',
  })
}

function copyCurrentArticleLink() {
  const article = currentArticle.value
  if (!article)
    return

  const target = router.resolve({
    path: '/help',
    query: {
      article: article.id,
      audience: selectedAudienceFilter.value,
      section: selectedSectionId.value || undefined,
    },
  })

  const url = typeof window !== 'undefined'
    ? new URL(target.href, window.location.origin).toString()
    : target.href

  void copyText(url, '文章链接已复制', {
    detail: '分享给团队时会保留当前文章和阅读视角。',
  })
}

function handleStorageChange(event: StorageEvent) {
  if (event.key === 'current_user')
    currentUserRole.value = readCurrentUserRole()
}

function handleArticleBodyReady(articleId: string) {
  if (currentArticle.value?.id === articleId)
    articleBodyReadyTick.value += 1
}

let currentArticleRequestId = 0

async function ensureCurrentArticleLoaded(articleId: string) {
  const requestId = ++currentArticleRequestId
  currentArticleLoading.value = true
  if (currentArticleContent.value?.id !== articleId)
    currentArticleContent.value = null
  const resolved = await resolveHelpArticle(articleId)
  if (requestId !== currentArticleRequestId)
    return

  currentArticleContent.value = resolved
  if (resolved) {
    searchIndexedArticles.value = {
      ...searchIndexedArticles.value,
      [resolved.id]: resolved,
    }
  }
  currentArticleLoading.value = false
}

async function ensureSearchIndexLoaded() {
  if (searchIndexState.value !== 'idle')
    return

  searchIndexState.value = 'loading'
  const resolvedArticles = await loadHelpSearchIndex(publishedArticles.value.map(article => article.id))
  const nextMap = { ...searchIndexedArticles.value }
  for (const article of resolvedArticles)
    nextMap[article.id] = article

  searchIndexedArticles.value = nextMap
  searchIndexState.value = 'ready'
}

watch(() => currentArticle.value?.id, (articleId) => {
  if (!articleId) {
    currentArticleContent.value = null
    currentArticleLoading.value = false
    return
  }

  void ensureCurrentArticleLoaded(articleId)
}, { immediate: true })

watch(searchQuery, (value) => {
  if (value.trim())
    void ensureSearchIndexLoaded()
})

watch(
  () => [currentArticleContent.value?.id, selectedSectionId.value, articleBodyReadyTick.value],
  async ([articleId, sectionId]) => {
    if (!articleId || !sectionId)
      return
    await scrollToSection(String(sectionId), 'auto')
  },
)

watch(filteredArticles, (articles) => {
  if (!articles.length)
    return

  const firstArticle = articles[0]
  if (firstArticle && !articles.some(article => article.id === selectedArticleId.value))
    syncSelectedArticle(firstArticle.id, { clearSearch: false })
}, { immediate: true })

watch(
  () => [selectedArticleId.value, expandedCategory.value, isSearching.value],
  ([, , searching], [, , previousSearching]) => {
    if (searching)
      return
    void syncActiveNavItemIntoView(previousSearching ? 'auto' : 'smooth')
  },
  { flush: 'post' },
)

onMounted(() => {
  appStore.fetchUIConfig()
  currentUserRole.value = readCurrentUserRole()
  window.addEventListener('storage', handleStorageChange)
  const normalized = normalizeArticleQuery(route.query[ARTICLE_QUERY_KEY])
  const normalizedSection = normalizeSectionQuery(route.query[SECTION_QUERY_KEY])
  const rawAudience = Array.isArray(route.query[AUDIENCE_QUERY_KEY])
    ? route.query[AUDIENCE_QUERY_KEY][0]
    : route.query[AUDIENCE_QUERY_KEY]
  const normalizedAudience = normalizeAudienceQuery(route.query[AUDIENCE_QUERY_KEY])
  if (normalized) {
    syncSelectedArticle(normalized, {
      clearSearch: false,
      updateRoute: false,
      sectionId: normalizedSection,
    })
  }
  if (String(rawAudience || '').trim() && String(rawAudience || '').trim() !== normalizedAudience)
    syncAudienceFilter(normalizedAudience)
  else
    syncAudienceFilter(normalizedAudience, { updateRoute: false })
  void syncActiveNavItemIntoView('auto')
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined')
    window.removeEventListener('storage', handleStorageChange)
})
</script>

<template>
  <div class="help-center-page ui-page-shell ui-page-density-reading h-full min-h-0 w-full flex flex-col overflow-hidden">
    <div class="help-center-shell h-full min-h-0 w-full flex flex-col gap-4 xl:grid xl:grid-cols-[18.75rem_minmax(0,1fr)] xl:gap-5">
      <aside class="help-sidebar glass-panel min-h-0 overflow-hidden rounded-[1.75rem] p-[0.875rem] shadow-sm">
        <div class="help-sidebar-top">
          <div class="help-sidebar-brand">
            <BaseBadge surface="meta" tone="brand" class="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] uppercase">
              Docs
            </BaseBadge>
            <div class="help-sidebar-brand__heading">
              <h2 class="help-sidebar-brand__title">
                {{ siteTitle }} 文档库
              </h2>
              <span class="help-sidebar-brand__version">v{{ developmentProgress.version }}</span>
            </div>
          </div>
        </div>

        <section class="help-library-panel">
          <div class="help-library-panel__header">
            <label class="help-search" for="help-search-input">
              <div class="i-carbon-search help-search__icon" />
              <input
                id="help-search-input"
                v-model="searchQuery"
                class="help-search__input"
                type="text"
                placeholder="搜索功能、配置、命令..."
              >
              <button
                v-if="searchQuery"
                type="button"
                class="help-search__clear"
                @click="searchQuery = ''"
              >
                <div class="i-carbon-close text-sm" />
              </button>
            </label>

            <div class="help-sidebar-section-label">
              <span>文档目录</span>
              <div class="help-sidebar-section-tools">
                <span class="help-sidebar-meta-pill">{{ filteredArticles.length }} 篇</span>
                <button type="button" class="help-sidebar-section-toggle" @click="toggleSidebarSummary">
                  {{ isSidebarSummaryExpanded ? '收起详情' : '详情' }}
                </button>
                <button type="button" class="help-sidebar-section-toggle" @click="toggleLibraryHierarchy">
                  {{ expandedCategory ? '收起' : '展开' }}
                </button>
              </div>
            </div>

            <div class="help-sidebar-summary-inline">
              <span>{{ filteredArticles.length }} 篇 · {{ developmentProgress.version }} · {{ coveragePercent }}%</span>
              <span>同步 {{ developmentProgress.lastUpdated }}</span>
            </div>

            <div class="help-sidebar-summary" :class="{ 'help-sidebar-summary--expanded': isSidebarSummaryExpanded }">
              <span class="help-sidebar-summary__chip">{{ filteredArticles.length }} 篇文档</span>
              <span class="help-sidebar-summary__chip">覆盖 {{ developmentProgress.version }}</span>
              <span class="help-sidebar-summary__chip">同步 {{ developmentProgress.lastUpdated }}</span>
              <span class="help-sidebar-summary__chip">完成度 {{ coveragePercent }}%</span>
            </div>
          </div>

          <nav ref="navRef" class="help-nav min-h-0 flex-1 overflow-y-auto pr-1">
            <div
              v-for="category in categoryCards"
              :key="category.name"
              class="help-nav-group"
            >
              <button
                type="button"
                class="help-nav-group__button"
                :class="{ 'help-nav-group__button--active': category.expanded }"
                :data-help-category="category.name"
                @click="toggleCategory(category.name)"
              >
                <div class="flex items-center gap-3">
                  <div class="text-lg" :class="category.icon" />
                  <div class="min-w-0">
                    <div class="help-nav-group__title">
                      {{ category.name }}
                    </div>
                    <div v-if="category.expanded" class="help-nav-group__desc">
                      {{ category.description }}
                    </div>
                  </div>
                </div>
                <div class="help-nav-group__trailing">
                  <div class="help-nav-group__count">
                    {{ category.items.length }}
                  </div>
                  <div class="i-carbon-chevron-down help-nav-group__chevron" :class="{ 'help-nav-group__chevron--active': category.expanded }" />
                </div>
              </button>

              <transition
                enter-active-class="transition-all duration-250 ease-out overflow-hidden"
                enter-from-class="opacity-0 max-h-0 -translate-y-1"
                enter-to-class="opacity-100 max-h-[32rem] translate-y-0"
                leave-active-class="transition-all duration-200 ease-in overflow-hidden"
                leave-from-class="opacity-100 max-h-[32rem] translate-y-0"
                leave-to-class="opacity-0 max-h-0 -translate-y-1"
              >
                <div v-if="category.expanded" class="help-nav-items">
                  <button
                    v-for="article in category.items"
                    :key="article.id"
                    type="button"
                    class="help-nav-item"
                    :class="{ 'help-nav-item--active': selectedArticleId === article.id && !isSearching }"
                    :data-help-article-id="article.id"
                    @click="syncSelectedArticle(article.id)"
                  >
                    <div class="text-base" :class="article.icon" />
                    <span class="truncate">{{ article.title }}</span>
                  </button>
                </div>
              </transition>
            </div>
          </nav>
        </section>
      </aside>

      <main class="help-main min-h-0 min-w-0 flex flex-col gap-4 xl:gap-5">
        <section class="help-hero glass-panel overflow-hidden rounded-[1.9rem] p-5 shadow-sm">
          <div class="help-hero__glow help-hero__glow--primary" />
          <div class="help-hero__glow help-hero__glow--secondary" />

          <div class="help-hero__header">
            <div class="help-hero__intro min-w-0">
              <div class="help-hero__badges">
                <template v-if="isSearching">
                  <BaseBadge surface="meta" tone="brand" class="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] uppercase">
                    Search
                  </BaseBadge>
                  <span class="help-hero__meta-chip">结果 {{ searchResults.length }} 篇</span>
                  <span v-if="isSearchIndexLoading" class="help-hero__meta-chip">正文索引加载中</span>
                  <span class="help-hero__meta-chip">{{ activeAudienceFilter?.label }}</span>
                  <span class="help-hero__meta-chip">覆盖版本 {{ developmentProgress.version }}</span>
                </template>
                <template v-else>
                  <BaseBadge surface="meta" tone="brand" class="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.18em] uppercase">
                    {{ currentArticle?.category || '帮助中心' }}
                  </BaseBadge>
                  <BaseBadge
                    surface="meta"
                    :tone="getAudienceTone(currentArticle) as any"
                    class="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase"
                  >
                    {{ currentArticle ? getHelpAudienceLabel(currentArticle.audience) : '全部用户' }}
                  </BaseBadge>
                  <BaseBadge
                    v-if="currentArticle"
                    surface="meta"
                    :tone="getHelpFreshnessTone(currentArticle) as any"
                    class="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase"
                  >
                    {{ getHelpFreshnessLabel(currentArticle) }}
                  </BaseBadge>
                  <span class="help-hero__meta-chip">适用版本 {{ currentArticle?.version || developmentProgress.version }}</span>
                  <span class="help-hero__meta-chip">{{ activeAudienceFilter?.label }}</span>
                </template>
              </div>

              <h1 class="help-hero__title">
                {{ isSearching ? `搜索 “${searchQuery.trim()}”` : (currentArticle?.title || '帮助中心') }}
              </h1>

              <p class="help-hero__summary">
                {{ isSearching ? '按标题、摘要、标签、正文与命令关键字返回最相关的帮助文档。' : (currentArticle?.summary || '请选择左侧文章开始阅读。') }}
              </p>

              <section class="help-hero__audience-toolbar">
                <div class="help-hero__audience-meta">
                  <span class="help-hero__audience-label">阅读视角</span>
                  <span class="help-sidebar-meta-pill">当前角色 · {{ currentRoleLabel }}</span>
                  <span class="help-hero__audience-copy">{{ activeAudienceFilter?.description }}</span>
                </div>

                <div class="help-hero__audience-chips">
                  <button
                    v-for="filter in audienceFilters"
                    :key="filter.value"
                    type="button"
                    class="help-hero__audience-chip"
                    :class="{ 'help-hero__audience-chip--active': selectedAudienceFilter === filter.value }"
                    @click="syncAudienceFilter(filter.value)"
                  >
                    <span>{{ filter.label }}</span>
                    <span class="help-audience-chip__count">{{ filter.count }}</span>
                  </button>
                </div>
              </section>
            </div>
          </div>

          <div
            v-if="!isSearching && currentArticle"
            class="help-hero__utility-grid"
          >
            <section class="help-hero__utility-card help-hero__utility-card--status">
              <div class="help-hero__routes-label">
                文档状态
              </div>
              <dl class="help-hero__status-grid">
                <div class="help-hero__status-item">
                  <dt>更新于</dt>
                  <dd>{{ currentArticle.updatedAt }}</dd>
                </div>
                <div class="help-hero__status-item">
                  <dt>治理状态</dt>
                  <dd>{{ getHelpGovernanceStatusLabel(currentArticle.governance.status) }}</dd>
                </div>
                <div class="help-hero__status-item">
                  <dt>复核频率</dt>
                  <dd>{{ getGovernanceCadence(currentArticle) }}</dd>
                </div>
                <div class="help-hero__status-item">
                  <dt>负责人</dt>
                  <dd>{{ currentArticle.governance.owner }}</dd>
                </div>
              </dl>
            </section>

            <section class="help-hero__utility-card">
              <div class="help-hero__routes-label">
                文档操作
              </div>
              <div class="help-hero__actions">
                <BaseButton
                  variant="secondary"
                  size="sm"
                  icon-class="i-carbon-copy-file"
                  :disabled="currentArticleLoading || !currentArticleContent"
                  @click="copyCurrentPlainText"
                >
                  复制纯文本
                </BaseButton>
                <BaseButton
                  variant="secondary"
                  size="sm"
                  icon-class="i-carbon-code"
                  :disabled="currentArticleLoading || !currentArticleContent"
                  @click="copyCurrentMarkdown"
                >
                  复制 Markdown
                </BaseButton>
                <BaseButton
                  variant="ghost"
                  size="sm"
                  icon-class="i-carbon-chat"
                  :href="supportQqGroupLink"
                >
                  支持群 {{ supportQqGroup }}
                </BaseButton>
              </div>
            </section>

            <section v-if="currentArticle.relatedRoutes?.length" class="help-hero__utility-card">
              <div class="help-hero__routes-label">
                关联页面
              </div>
              <div class="help-hero__routes">
                <BaseButton
                  v-for="relatedRoute in currentArticle.relatedRoutes"
                  :key="`${currentArticle.id}-${relatedRoute.to}`"
                  variant="secondary"
                  size="sm"
                  :to="relatedRoute.to"
                  class="help-route-chip"
                >
                  {{ relatedRoute.label }}
                </BaseButton>
              </div>
            </section>
          </div>
        </section>

        <section v-if="isSearching" class="glass-panel min-h-0 flex-1 rounded-[1.9rem] p-5 shadow-sm lg:p-6">
          <div v-if="searchResults.length" class="help-search-results">
            <button
              v-for="item in searchResults"
              :key="item.article.id"
              type="button"
              class="help-result-card"
              @click="syncSelectedArticle(item.article.id)"
            >
              <div class="help-result-card__icon">
                <div class="text-xl" :class="item.article.icon" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="help-result-card__meta">
                  <BaseBadge surface="meta" tone="brand" class="rounded-full px-2 py-0.5 text-[10px] font-bold">
                    {{ item.article.category }}
                  </BaseBadge>
                  <span class="help-result-card__audience">{{ getHelpAudienceLabel(item.article.audience) }}</span>
                  <span class="help-result-card__freshness">{{ getHelpFreshnessLabel(item.article) }}</span>
                </div>
                <h3 class="help-result-card__title">
                  {{ item.article.title }}
                </h3>
                <p class="help-result-card__summary">
                  {{ item.excerpt }}
                </p>
              </div>
              <div class="i-carbon-arrow-right text-lg opacity-50" />
            </button>
          </div>
          <div v-else class="help-empty">
            <div class="i-carbon-search-locate help-empty__icon" />
            <p class="help-empty__title">
              没有找到匹配的帮助文档
            </p>
            <p class="help-empty__copy">
              可以尝试搜索页面名、设置项、命令名，或先从左侧分类进入对应模块。
            </p>
          </div>
        </section>

        <section v-else class="help-content-grid min-h-0 flex-1">
          <aside v-if="articleOutline.length" class="glass-panel help-outline-panel hidden xl:flex xl:flex-col xl:rounded-[1.75rem] xl:p-4 xl:shadow-sm">
            <div class="help-outline-panel__title">
              本文目录
            </div>
            <div class="help-outline-panel__copy">
              点击后会滚动到对应段落。
            </div>
            <div class="help-outline-list">
              <button
                v-for="item in articleOutline"
                :key="item.id"
                type="button"
                class="help-outline-item"
                :class="[
                  item.level === 3 ? 'help-outline-item--nested' : item.level === 4 ? 'help-outline-item--deep' : '',
                  selectedSectionId === item.id ? 'help-outline-item--active' : '',
                ]"
                @click="jumpToOutline(item)"
              >
                {{ item.text }}
              </button>
            </div>
          </aside>

          <div class="glass-panel help-article-panel min-h-0 rounded-[1.9rem] p-5 shadow-sm lg:p-6">
            <div class="help-article-shell">
              <div v-if="currentArticleLoading && !currentArticleContent" class="help-article-loading">
                <div class="i-svg-spinners-ring-resize text-2xl" />
                <span>正在加载文档内容...</span>
              </div>

              <div class="help-article-prose-shell">
                <HelpArticleBody :article="currentArticleContent" @ready="handleArticleBodyReady" />
              </div>

              <div v-if="currentArticle?.timeline?.length || currentArticle" class="help-article-lower-grid">
                <section v-if="currentArticle?.timeline?.length" class="help-article-detail-card help-article-timeline">
                  <div class="help-article-timeline__header">
                    <div>
                      <div class="help-article-timeline__title">
                        最近改动
                      </div>
                      <p class="help-article-timeline__copy">
                        这篇文档为什么会按现在的口径来写，可以从这里快速回看。
                      </p>
                    </div>
                  </div>
                  <div class="help-article-timeline__list">
                    <div
                      v-for="item in currentArticle.timeline"
                      :key="`${currentArticle.id}-${item.date}-${item.title}`"
                      class="help-article-timeline__item"
                    >
                      <div class="help-article-timeline__rail" />
                      <div class="help-article-timeline__body">
                        <div class="help-article-timeline__meta">
                          <span>{{ item.date }}</span>
                          <span v-if="item.version">版本 {{ item.version }}</span>
                        </div>
                        <div class="help-article-timeline__item-title">
                          {{ item.title }}
                        </div>
                        <p class="help-article-timeline__detail">
                          {{ item.detail }}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section v-if="currentArticle" class="help-article-detail-card help-governance-panel">
                  <div class="help-governance-panel__header">
                    <div>
                      <div class="help-governance-panel__title">
                        文档治理
                      </div>
                      <p class="help-governance-panel__copy">
                        发现口径过期、步骤缺失或需要补截图时，可以直接复制模板发给团队。
                      </p>
                    </div>
                    <BaseBadge
                      surface="meta"
                      :tone="getHelpFreshnessTone(currentArticle) as any"
                      class="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase"
                    >
                      {{ getHelpFreshnessLabel(currentArticle) }}
                    </BaseBadge>
                  </div>

                  <div class="help-governance-panel__meta">
                    <span>负责人 {{ currentArticle.governance.owner }}</span>
                    <span>最近复核人 {{ currentArticle.governance.lastReviewedBy }}</span>
                    <span>最近复核 {{ currentArticle.governance.lastReviewedAt }}</span>
                    <span>复核频率 {{ getGovernanceCadence(currentArticle) }}</span>
                    <span>待处理状态 {{ getHelpGovernanceStatusLabel(currentArticle.governance.status) }}</span>
                  </div>

                  <div class="help-governance-panel__next">
                    <BaseBadge
                      surface="meta"
                      :tone="getHelpGovernanceStatusTone(currentArticle.governance.status) as any"
                      class="rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase"
                    >
                      {{ getHelpGovernanceStatusLabel(currentArticle.governance.status) }}
                    </BaseBadge>
                    <span>{{ currentArticle.governance.nextAction }}</span>
                  </div>

                  <div class="help-governance-panel__actions">
                    <BaseButton
                      variant="secondary"
                      size="sm"
                      icon-class="i-carbon-warning-alt"
                      @click="copyGovernanceTemplate('outdated')"
                    >
                      复制过期反馈
                    </BaseButton>
                    <BaseButton
                      variant="secondary"
                      size="sm"
                      icon-class="i-carbon-edit"
                      @click="copyGovernanceTemplate('suggestion')"
                    >
                      复制补充建议
                    </BaseButton>
                    <BaseButton
                      variant="secondary"
                      size="sm"
                      icon-class="i-carbon-task"
                      @click="copyGovernanceTaskTemplate"
                    >
                      复制治理任务
                    </BaseButton>
                    <BaseButton
                      variant="ghost"
                      size="sm"
                      icon-class="i-carbon-link"
                      @click="copyCurrentArticleLink"
                    >
                      复制本文链接
                    </BaseButton>
                  </div>
                </section>
              </div>

              <div
                v-if="currentArticle"
                class="help-article-support-grid"
                :class="{ 'help-article-support-grid--single': !featuredRecommendations.length }"
              >
                <button type="button" class="help-sync-card help-sync-card--article" @click="openReleaseHighlights">
                  <div class="help-sync-card__header">
                    <BaseBadge :tone="helpReleaseSyncStatus.tone as any" surface="meta" class="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.14em] uppercase">
                      Release
                    </BaseBadge>
                    <span class="help-sync-card__hint">点击查看版本演进</span>
                  </div>
                  <div class="help-sync-card__title">
                    {{ helpReleaseSyncStatus.title }}
                  </div>
                  <p class="help-sync-card__copy">
                    {{ helpReleaseSyncStatus.detail }}
                  </p>
                  <div class="help-sync-card__notes">
                    <span
                      v-for="releaseNote in latestReleaseNotes"
                      :key="releaseNote.version"
                      class="help-sync-note"
                    >
                      {{ releaseNote.version }} · {{ releaseNote.date }}
                    </span>
                  </div>
                </button>

                <section v-if="featuredRecommendations.length" class="help-must-read-card help-must-read-card--article">
                  <div class="help-must-read-card__header">
                    <span>继续阅读</span>
                    <span class="help-sidebar-meta-pill">{{ activeAudienceFilter?.label }}</span>
                  </div>
                  <p class="help-must-read-card__copy">
                    结合当前主题和阅读视角，建议继续看这几篇。
                  </p>
                  <div class="help-must-read-list">
                    <button
                      v-for="item in featuredRecommendations"
                      :key="item.article.id"
                      type="button"
                      class="help-must-read-item"
                      @click="syncSelectedArticle(item.article.id)"
                    >
                      <div class="help-must-read-item__meta">
                        <BaseBadge surface="meta" tone="brand" class="rounded-full px-2 py-0.5 text-[10px] font-bold">
                          {{ item.article.category }}
                        </BaseBadge>
                        <span class="help-must-read-item__freshness">{{ getHelpFreshnessLabel(item.article) }}</span>
                      </div>
                      <div class="help-must-read-item__title">
                        {{ item.article.title }}
                      </div>
                      <p class="help-must-read-item__reason">
                        {{ item.reason }}
                      </p>
                    </button>
                  </div>
                </section>
              </div>

              <footer v-if="currentArticle" class="help-article-footer">
                <div class="help-article-footer__meta">
                  <span>更新于 {{ currentArticle.updatedAt }}</span>
                  <span>时效 {{ getHelpFreshnessLabel(currentArticle) }}</span>
                  <span>版本 {{ currentArticle.version }}</span>
                  <span>作者 {{ currentArticle.author }}</span>
                </div>
              </footer>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.help-center-page {
  color: var(--ui-text-1);
}

.help-sidebar,
.help-library-panel,
.help-hero,
.help-article-panel,
.help-outline-panel,
.help-progress-card,
.help-sync-card,
.help-must-read-card,
.help-result-card {
  border: 1px solid var(--ui-border-subtle);
}

.help-sidebar {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.42rem;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--ui-brand-soft-12) 88%, transparent), transparent 48%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--ui-bg-surface-raised) 94%, transparent),
      color-mix(in srgb, var(--ui-bg-surface) 92%, transparent)
    );
}

.help-sidebar-top {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.help-sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.62rem;
  min-width: 0;
  padding: 0 0.1rem;
}

.help-sidebar-brand__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  min-width: 0;
  width: 100%;
}

.help-progress-card__meta,
.help-nav-group__desc,
.help-hero__summary,
.help-result-card__summary,
.help-outline-panel__copy,
.help-empty__copy {
  color: var(--ui-text-2);
}

.help-sidebar-brand__version {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 1.35rem;
  padding: 0.14rem 0.52rem;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 92%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface) 90%, transparent);
  color: var(--ui-text-2);
  font-size: 0.66rem;
  font-weight: 800;
}

.help-sidebar-brand__title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.96rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.help-search {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 1rem;
  padding: 0.5rem 0.66rem;
  background: color-mix(in srgb, var(--ui-bg-surface) 94%, transparent);
  transition:
    border-color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease,
    transform var(--ui-motion-fast) ease;
}

.help-search:focus-within {
  border-color: color-mix(in srgb, var(--ui-brand-500) 36%, var(--ui-border-subtle) 64%);
  background: color-mix(in srgb, var(--ui-brand-soft-12) 68%, var(--ui-bg-surface) 32%);
  transform: translateY(-1px);
}

.help-search__icon,
.help-search__clear {
  color: var(--ui-text-2);
}

.help-search__input {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--ui-text-1);
  font-size: 0.84rem;
  font-weight: 600;
  outline: none;
}

.help-search__clear {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.help-progress-card,
.help-sync-card,
.help-must-read-card {
  border-radius: 1.2rem;
  padding: 0.95rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 91%, transparent),
    color-mix(in srgb, var(--ui-bg-surface) 95%, transparent)
  );
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

.help-sidebar-meta-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.55rem;
  padding: 0.2rem 0.65rem;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 92%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface) 88%, transparent);
  color: var(--ui-text-2);
  font-size: 0.7rem;
  font-weight: 800;
  line-height: 1.2;
}

.help-sidebar-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0 0.1rem;
  color: var(--ui-text-2);
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.help-sidebar-section-tools {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.help-sidebar-section-toggle {
  appearance: none;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 92%, transparent);
  border-radius: 999px;
  padding: 0.24rem 0.62rem;
  background: color-mix(in srgb, var(--ui-bg-surface) 90%, transparent);
  color: var(--ui-text-2);
  font-size: 0.68rem;
  font-weight: 800;
  cursor: pointer;
  transition:
    border-color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease,
    color var(--ui-motion-fast) ease;
}

.help-sidebar-section-toggle:hover {
  border-color: color-mix(in srgb, var(--ui-brand-500) 28%, var(--ui-border-subtle) 72%);
  background: color-mix(in srgb, var(--ui-brand-soft-12) 72%, var(--ui-bg-surface) 28%);
  color: var(--ui-text-1);
}

.help-sidebar-summary-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.28rem 0.65rem;
  padding: 0 0.1rem;
  color: var(--ui-text-2);
  font-size: 0.68rem;
  font-weight: 700;
  line-height: 1.35;
}

.help-sidebar-summary {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.45rem;
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  overflow-x: auto;
  padding: 0 0 0.05rem;
  scrollbar-width: none;
  pointer-events: none;
  transform: translateY(-0.15rem);
  transition:
    max-height var(--ui-motion-fast) ease,
    opacity var(--ui-motion-fast) ease,
    transform var(--ui-motion-fast) ease;
}

.help-library-panel__header:hover .help-sidebar-summary,
.help-library-panel__header:focus-within .help-sidebar-summary,
.help-sidebar-summary--expanded {
  max-height: 3rem;
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.help-sidebar-summary__chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  min-height: 1.45rem;
  padding: 0.16rem 0.52rem;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 92%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface) 90%, transparent);
  color: var(--ui-text-2);
  font-size: 0.65rem;
  font-weight: 800;
}

.help-sync-card__hint,
.help-sync-card__copy,
.help-result-card__freshness,
.help-hero__audience-copy {
  color: var(--ui-text-2);
}

.help-hero__audience-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 1rem;
}

.help-hero__audience-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.6rem;
}

.help-hero__audience-label {
  color: var(--ui-text-1);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.help-hero__audience-copy,
.help-sync-card__hint,
.help-sync-card__copy,
.help-result-card__freshness {
  font-size: 0.8rem;
  line-height: 1.55;
}

.help-hero__audience-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.help-hero__audience-chip {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  border: 1px solid transparent;
  border-radius: 0.95rem;
  min-height: 2.02rem;
  padding: 0.42rem 0.66rem;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 88%, transparent);
  color: var(--ui-text-1);
  font-size: 0.72rem;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--ui-motion-fast) ease,
    border-color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease;
}

.help-hero__audience-chip:hover,
.help-hero__audience-chip--active {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--ui-brand-500) 28%, var(--ui-border-subtle) 72%);
  background: color-mix(in srgb, var(--ui-brand-soft-12) 72%, var(--ui-bg-surface) 28%);
}

.help-hero__audience-chip span:first-child {
  min-width: 0;
  line-height: 1.35;
}

.help-audience-chip__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.2rem;
  height: 1.2rem;
  padding: 0 0.28rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface) 92%, transparent);
  font-size: 0.66rem;
}

.help-library-panel {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.42rem;
  border-radius: 1.25rem;
  padding: 0.68rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 91%, transparent),
    color-mix(in srgb, var(--ui-bg-surface) 95%, transparent)
  );
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

.help-library-panel__header {
  display: flex;
  flex-direction: column;
  gap: 0.34rem;
}

.help-progress-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.65rem;
}

.help-progress-card__summary {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}

.help-progress-card__label {
  color: var(--ui-text-2);
  font-size: 0.73rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.help-progress-card__totals {
  color: var(--ui-text-1);
  font-size: 0.96rem;
  font-weight: 900;
}

.help-progress-card__percent {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 3rem;
  min-height: 2rem;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-brand-soft-12) 76%, transparent);
  color: color-mix(in srgb, var(--ui-brand-700) 72%, var(--ui-text-1) 28%);
  font-size: 0.82rem;
  font-weight: 900;
}

.help-progress-card__track {
  height: 0.48rem;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 92%, transparent);
}

.help-progress-card__value {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--ui-brand-500), var(--ui-brand-700));
}

.help-progress-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.6rem 0 0;
  font-size: 0.74rem;
}

.help-progress-card__meta strong {
  color: var(--ui-text-1);
  font-size: 0.76rem;
  font-weight: 800;
}

.help-sync-card {
  appearance: none;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-brand-soft-12) 44%, var(--ui-bg-surface-raised) 56%),
    color-mix(in srgb, var(--ui-bg-surface) 94%, transparent)
  );
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--ui-motion-fast) ease,
    border-color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease;
}

.help-sync-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--ui-brand-500) 28%, var(--ui-border-subtle) 72%);
}

.help-sync-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.help-sync-card__title {
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1.4;
}

.help-sync-card__copy {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.48;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.help-sync-card__notes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.help-sync-note {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 999px;
  padding: 0.24rem 0.55rem;
  background: color-mix(in srgb, var(--ui-bg-surface) 92%, transparent);
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--ui-text-1);
}

.help-must-read-card {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.help-must-read-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.77rem;
  font-weight: 800;
}

.help-must-read-card__header span:last-child,
.help-must-read-card__copy,
.help-must-read-item__freshness,
.help-must-read-item__reason,
.help-article-timeline__copy,
.help-article-timeline__meta,
.help-article-timeline__detail {
  color: var(--ui-text-2);
}

.help-must-read-card__copy {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
}

.help-must-read-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.help-must-read-item {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 0.95rem;
  padding: 0.75rem 0.8rem;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 88%, transparent);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--ui-motion-fast) ease,
    border-color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease;
}

.help-must-read-item:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--ui-brand-500) 24%, var(--ui-border-subtle) 76%);
  background: color-mix(in srgb, var(--ui-brand-soft-12) 68%, transparent);
}

.help-must-read-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.help-must-read-item__title,
.help-article-timeline__title,
.help-article-timeline__item-title {
  color: var(--ui-text-1);
}

.help-must-read-item__title {
  font-size: 0.85rem;
  font-weight: 800;
  line-height: 1.4;
}

.help-must-read-item__reason {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.48;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.help-nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  padding-top: 0.05rem;
  padding-right: 0.25rem;
  scrollbar-gutter: stable;
}

.help-nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.help-nav-group + .help-nav-group {
  padding-top: 0.35rem;
  border-top: 1px solid color-mix(in srgb, var(--ui-border-subtle) 82%, transparent);
}

.help-nav-group__button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 0.92rem;
  padding: 0.68rem 0.8rem;
  background: color-mix(in srgb, var(--ui-bg-surface) 92%, transparent);
  color: var(--ui-text-1);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--ui-motion-fast) ease,
    border-color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease;
}

.help-nav-group__button::before {
  content: '';
  position: absolute;
  top: 0.7rem;
  bottom: 0.7rem;
  left: 0.42rem;
  width: 0.16rem;
  border-radius: 999px;
  background: transparent;
  transition: background-color var(--ui-motion-fast) ease;
}

.help-nav-group__button:hover,
.help-nav-group__button--active {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--ui-brand-500) 28%, var(--ui-border-subtle) 72%);
  background: color-mix(in srgb, var(--ui-brand-soft-12) 72%, var(--ui-bg-surface) 28%);
}

.help-nav-group__button--active::before {
  background: linear-gradient(180deg, var(--ui-brand-500), var(--ui-brand-700));
}

.help-nav-group__title {
  font-size: 0.88rem;
  font-weight: 800;
}

.help-nav-group__desc {
  margin-top: 0.14rem;
  font-size: 0.7rem;
  line-height: 1.4;
}

.help-nav-group__trailing {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.help-nav-group__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.72rem;
  height: 1.72rem;
  padding: 0 0.42rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 88%, transparent);
  font-size: 0.72rem;
  font-weight: 800;
}

.help-nav-group__chevron {
  color: var(--ui-text-2);
  font-size: 0.95rem;
  transition:
    transform var(--ui-motion-fast) ease,
    color var(--ui-motion-fast) ease;
}

.help-nav-group__chevron--active {
  transform: rotate(180deg);
  color: var(--ui-text-1);
}

.help-nav-items {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  padding-left: 0.72rem;
}

.help-nav-items::before {
  content: '';
  position: absolute;
  top: 0.15rem;
  bottom: 0.15rem;
  left: 0.1rem;
  width: 1px;
  background: color-mix(in srgb, var(--ui-border-subtle) 82%, transparent);
}

.help-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.58rem;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 0.82rem;
  padding: 0.52rem 0.7rem;
  background: transparent;
  color: var(--ui-text-2);
  font-size: 0.82rem;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--ui-motion-fast) ease,
    color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease;
}

.help-nav-item::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -0.54rem;
  width: 0.42rem;
  height: 1px;
  background: color-mix(in srgb, var(--ui-border-subtle) 82%, transparent);
  transform: translateY(-50%);
}

.help-nav-item:hover,
.help-nav-item--active {
  border-color: color-mix(in srgb, var(--ui-brand-500) 24%, var(--ui-border-subtle) 76%);
  background: color-mix(in srgb, var(--ui-brand-soft-12) 68%, transparent);
  color: var(--ui-text-1);
}

.help-nav-item--active {
  box-shadow:
    0 10px 24px color-mix(in srgb, var(--ui-brand-500) 10%, transparent),
    inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

.help-nav-item--active::before {
  background: color-mix(in srgb, var(--ui-brand-500) 68%, var(--ui-border-subtle) 32%);
}

.help-main {
  min-width: 0;
  overflow-y: auto;
  padding-right: 0.15rem;
  scrollbar-gutter: stable;
}

.help-hero {
  position: relative;
  isolation: isolate;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 94%, transparent),
    color-mix(in srgb, var(--ui-bg-surface) 90%, transparent)
  );
}

.help-hero__glow {
  position: absolute;
  border-radius: 999px;
  filter: blur(42px);
  pointer-events: none;
  opacity: 0.8;
}

.help-hero__glow--primary {
  top: -2.6rem;
  right: -1rem;
  width: 12rem;
  height: 12rem;
  background: color-mix(in srgb, var(--ui-brand-500) 16%, transparent);
}

.help-hero__glow--secondary {
  left: -2rem;
  bottom: -4rem;
  width: 10rem;
  height: 10rem;
  background: color-mix(in srgb, var(--ui-status-success) 14%, transparent);
}

.help-hero__header,
.help-hero__utility-grid {
  position: relative;
  z-index: 1;
}

.help-hero__header {
  min-width: 0;
}

.help-hero__intro {
  min-width: 0;
  max-width: 60rem;
}

.help-hero__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  margin-bottom: 0.85rem;
}

.help-hero__meta-chip,
.help-result-card__audience,
.help-result-card__freshness {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.7rem;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface) 92%, transparent);
  color: var(--ui-text-2);
  font-size: 0.74rem;
  font-weight: 700;
}

.help-hero__title {
  margin: 0;
  font-size: clamp(1.7rem, 1.55rem + 0.55vw, 2.2rem);
  font-weight: 950;
  letter-spacing: -0.04em;
}

.help-hero__summary {
  margin: 0.9rem 0 0;
  font-size: 0.95rem;
  line-height: 1.75;
}

.help-hero__utility-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 0.95rem;
  margin-top: 1.15rem;
}

.help-hero__utility-grid--single {
  grid-template-columns: minmax(0, 1fr);
}

.help-hero__utility-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.95rem 1rem;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 92%, transparent);
  border-radius: 1.2rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 90%, transparent),
    color-mix(in srgb, var(--ui-bg-surface) 94%, transparent)
  );
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

.help-hero__utility-card--status {
  gap: 0.85rem;
}

.help-hero__status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 0;
}

.help-hero__status-item {
  min-width: 0;
  padding: 0.7rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 92%, transparent);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--ui-bg-surface) 86%, transparent);
}

.help-hero__status-item dt {
  color: var(--ui-text-2);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.help-hero__status-item dd {
  margin: 0.35rem 0 0;
  color: var(--ui-text-1);
  font-size: 0.82rem;
  font-weight: 800;
  line-height: 1.45;
}

.help-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  justify-content: flex-start;
}

.help-hero__routes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: flex-start;
}

.help-hero__routes-label {
  color: var(--ui-text-2);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.help-route-chip {
  backdrop-filter: blur(10px);
}

.help-search-results {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.help-result-card {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  width: 100%;
  border-radius: 1.35rem;
  padding: 1rem;
  background: color-mix(in srgb, var(--ui-bg-surface) 94%, transparent);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--ui-motion-fast) ease,
    border-color var(--ui-motion-fast) ease,
    box-shadow var(--ui-motion-fast) ease;
}

.help-result-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--ui-brand-500) 28%, var(--ui-border-subtle) 72%);
  box-shadow: 0 18px 30px color-mix(in srgb, var(--ui-shadow-panel) 22%, transparent);
}

.help-result-card__icon {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--ui-brand-soft-12) 84%, transparent);
  color: color-mix(in srgb, var(--ui-brand-700) 74%, var(--ui-text-1) 26%);
}

.help-result-card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.55rem;
}

.help-result-card__title {
  margin: 0;
  color: var(--ui-text-1);
  font-size: 1.02rem;
  font-weight: 850;
}

.help-result-card__summary {
  margin: 0.45rem 0 0;
  font-size: 0.9rem;
  line-height: 1.7;
}

.help-empty {
  display: grid;
  place-items: center;
  min-height: 18rem;
  text-align: center;
}

.help-empty__icon {
  font-size: 3.4rem;
  color: color-mix(in srgb, var(--ui-brand-500) 68%, var(--ui-text-2) 32%);
}

.help-empty__title {
  margin: 1rem 0 0.35rem;
  color: var(--ui-text-1);
  font-size: 1.08rem;
  font-weight: 900;
}

.help-content-grid {
  min-height: 0;
}

.help-article-panel {
  min-width: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 95%, transparent),
    color-mix(in srgb, var(--ui-bg-surface) 92%, transparent)
  );
}

.help-article-shell {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.help-article-prose-shell {
  min-width: 0;
}

.help-article-lower-grid,
.help-article-support-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.help-article-support-grid--single {
  grid-template-columns: minmax(0, 1fr);
}

.help-article-detail-card,
.help-sync-card--article,
.help-must-read-card--article {
  min-width: 0;
  height: 100%;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 92%, transparent);
  border-radius: 1.25rem;
  padding: 1rem 1.05rem;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--ui-bg-surface-raised) 90%, transparent),
    color-mix(in srgb, var(--ui-bg-surface) 95%, transparent)
  );
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}

.help-article-loading {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 1rem;
  color: var(--ui-text-2);
  font-size: 0.84rem;
  font-weight: 700;
}

.help-article-timeline {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.help-article-timeline__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.help-article-timeline__title {
  font-size: 1rem;
  font-weight: 900;
}

.help-article-timeline__copy {
  margin: 0.4rem 0 0;
  font-size: 0.82rem;
  line-height: 1.6;
}

.help-article-timeline__list {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin-top: 1rem;
}

.help-article-timeline__item {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr);
  gap: 0.85rem;
}

.help-article-timeline__rail {
  position: relative;
  width: 1rem;
}

.help-article-timeline__rail::before {
  content: '';
  position: absolute;
  top: 0.35rem;
  left: 0.42rem;
  bottom: -1rem;
  width: 1px;
  background: color-mix(in srgb, var(--ui-border-subtle) 88%, transparent);
}

.help-article-timeline__rail::after {
  content: '';
  position: absolute;
  top: 0.2rem;
  left: 0.18rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--ui-brand-500);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-brand-soft-12) 70%, transparent);
}

.help-article-timeline__item:last-child .help-article-timeline__rail::before {
  display: none;
}

.help-article-timeline__body {
  min-width: 0;
}

.help-article-timeline__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.76rem;
  font-weight: 700;
}

.help-article-timeline__item-title {
  margin-top: 0.28rem;
  font-size: 0.92rem;
  font-weight: 800;
  line-height: 1.45;
}

.help-article-timeline__detail {
  margin: 0.3rem 0 0;
  font-size: 0.84rem;
  line-height: 1.65;
}

.help-governance-panel {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.help-governance-panel__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.help-governance-panel__title {
  color: var(--ui-text-1);
  font-size: 1rem;
  font-weight: 900;
}

.help-governance-panel__copy,
.help-governance-panel__meta {
  color: var(--ui-text-2);
}

.help-governance-panel__copy {
  margin: 0.4rem 0 0;
  font-size: 0.82rem;
  line-height: 1.6;
}

.help-governance-panel__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.1rem;
  margin-top: 0.9rem;
  font-size: 0.78rem;
  font-weight: 700;
}

.help-governance-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 1rem;
}

.help-governance-panel__next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 0.85rem;
  margin-top: 0.85rem;
  color: var(--ui-text-2);
  font-size: 0.8rem;
  font-weight: 700;
}

.help-article-footer {
  margin-top: 0.15rem;
}

.help-article-footer__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem 1.2rem;
}

.help-article-footer__meta span {
  display: inline-flex;
  align-items: center;
  min-height: 1.7rem;
  padding: 0.3rem 0.72rem;
  border: 1px solid color-mix(in srgb, var(--ui-border-subtle) 90%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-bg-surface) 88%, transparent);
  color: var(--ui-text-2);
  font-size: 0.78rem;
  font-weight: 700;
}

.help-outline-panel {
  min-height: 0;
  position: sticky;
  top: 0;
  align-self: start;
  max-height: calc(100vh - 2rem);
  overflow: hidden;
  background: color-mix(in srgb, var(--ui-bg-surface) 94%, transparent);
}

.help-outline-panel__title {
  color: var(--ui-text-1);
  font-size: 0.96rem;
  font-weight: 900;
}

.help-outline-list {
  min-height: 0;
  margin-top: 1rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.help-outline-item {
  border: 0;
  border-radius: 0.9rem;
  padding: 0.65rem 0.8rem;
  background: transparent;
  color: var(--ui-text-2);
  font-size: 0.86rem;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition:
    color var(--ui-motion-fast) ease,
    background-color var(--ui-motion-fast) ease;
}

.help-outline-item:hover {
  background: color-mix(in srgb, var(--ui-brand-soft-12) 70%, transparent);
  color: var(--ui-text-1);
}

.help-outline-item--active {
  background: color-mix(in srgb, var(--ui-brand-soft-12) 88%, var(--ui-bg-surface-raised) 12%);
  color: var(--ui-brand-700);
}

.help-outline-item--nested {
  padding-left: 1.3rem;
}

.help-outline-item--deep {
  padding-left: 1.8rem;
}

@media (min-width: 1280px) {
  .help-content-grid {
    display: grid;
    grid-template-columns: minmax(13.5rem, 14.5rem) minmax(0, 1fr);
    gap: 1.4rem;
    align-items: start;
  }
}

@media (max-width: 1279px) {
  .help-center-page {
    overflow: auto;
  }

  .help-center-shell,
  .help-main,
  .help-content-grid,
  .help-article-panel {
    min-height: auto;
  }

  .help-main {
    overflow: visible;
    padding-right: 0;
  }

  .help-article-panel {
    overflow: visible;
  }

  .help-hero__utility-grid {
    grid-template-columns: 1fr;
  }

  .help-article-lower-grid,
  .help-article-support-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .help-hero__audience-meta {
    align-items: flex-start;
  }

  .help-hero__audience-copy {
    flex-basis: 100%;
  }

  .help-hero__audience-chips {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .help-hero__audience-chip {
    width: 100%;
  }

  .help-hero {
    padding: 1rem;
  }

  .help-hero__status-grid {
    grid-template-columns: 1fr;
  }

  .help-hero__utility-card {
    padding: 0.85rem 0.9rem;
  }

  .help-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .help-hero__actions :deep(.ui-btn) {
    width: 100%;
  }

  .help-article-detail-card,
  .help-sync-card--article,
  .help-must-read-card--article {
    padding: 0.9rem;
  }
}
</style>
