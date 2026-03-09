/* eslint-disable no-alert */

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useToastStore } from '@/stores/toast'

interface BatchOption {
  value: string
  label: string
}

interface CardLogSnapshot {
  code?: string
  batchNo?: string | null
  batchName?: string | null
  type?: string
  days?: number | null
  description?: string
  source?: string
  channel?: string
  note?: string
  createdBy?: string | null
  enabled?: boolean
  usedBy?: string | null
  usedAt?: number | null
  expiresAt?: number | null
  createdAt?: number | null
  updatedAt?: number | null
}

interface CardLog {
  id: number
  action: string
  operator: string | null
  targetUsername: string | null
  remark: string | null
  beforeSnapshot: CardLogSnapshot | null
  afterSnapshot: CardLogSnapshot | null
  createdAt: number | null
}

interface Card {
  id?: number
  code: string
  batchNo: string | null
  batchName: string | null
  description: string
  type: string
  typeChar: string
  days: number | null
  source: string
  channel: string
  note: string
  createdBy: string | null
  enabled: boolean
  usedBy: string | null
  usedAt: number | null
  createdAt: number
  updatedAt: number | null
  expiresAt: number | null
  status: string
  statusLabel: string
  statusTone: string
  isUsed: boolean
  isExpired: boolean
  canDelete: boolean
  canToggleEnabled: boolean
  canEditType: boolean
}

interface CardsSummary {
  total: number
  unused: number
  disabled: number
  used: number
  usedActive: number
  usedExpiring: number
  usedExpired: number
  usedForever: number
  trial: number
  permanent: number
  batches: number
}

interface FilterOptions {
  sources: string[]
  creators: string[]
  batches: BatchOption[]
}

const toast = useToastStore()

const CARD_TYPE_OPTIONS = [
  { value: 'D', label: '天卡', defaultDays: 1 },
  { value: 'W', label: '周卡', defaultDays: 7 },
  { value: 'M', label: '月卡', defaultDays: 30 },
  { value: 'F', label: '永久卡', defaultDays: null },
  { value: 'T', label: '体验卡', defaultDays: 1 },
]

const CARD_SOURCE_LABELS: Record<string, string> = {
  manual: '手动生成',
  trial_public: '公开体验卡',
  trial_renew: '体验卡续费',
  admin_grant: '管理员发放',
  campaign: '活动投放',
  compensation: '补偿发放',
  import: '批量导入',
  custom: '自定义来源',
  system: '系统生成',
}

const ACTION_LABELS: Record<string, string> = {
  create: '生成卡密',
  update: '更新卡密',
  delete: '删除卡密',
  register_use: '注册使用',
  renew_use: '续费使用',
}

const statusFilterOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'unused', label: '待使用' },
  { value: 'disabled', label: '已禁用' },
  { value: 'used', label: '已使用' },
  { value: 'used_active', label: '已使用生效中' },
  { value: 'used_expiring', label: '即将到期' },
  { value: 'used_expired', label: '已过期' },
  { value: 'used_forever', label: '永久生效' },
]

const generateSourceOptions = [
  { value: 'manual', label: '手动生成' },
  { value: 'admin_grant', label: '管理员发放' },
  { value: 'campaign', label: '活动投放' },
  { value: 'compensation', label: '补偿发放' },
  { value: 'import', label: '批量导入' },
  { value: 'custom', label: '自定义来源' },
]

const pageSizeOptions = [
  { value: 10, label: '10 条/页' },
  { value: 20, label: '20 条/页' },
  { value: 50, label: '50 条/页' },
  { value: 100, label: '100 条/页' },
]

function createEmptySummary(): CardsSummary {
  return {
    total: 0,
    unused: 0,
    disabled: 0,
    used: 0,
    usedActive: 0,
    usedExpiring: 0,
    usedExpired: 0,
    usedForever: 0,
    trial: 0,
    permanent: 0,
    batches: 0,
  }
}

const cards = ref<Card[]>([])
const summary = ref<CardsSummary>(createEmptySummary())
const filterOptions = ref<FilterOptions>({
  sources: [],
  creators: [],
  batches: [],
})
const loading = ref(false)
const detailLoading = ref(false)
const actionLoading = ref(false)
const batchActionLoading = ref(false)
const actionError = ref('')

const selectedCards = ref<string[]>([])
const page = ref(1)
const pageSize = ref(20)

const filters = ref({
  keyword: '',
  type: 'all',
  status: 'all',
  source: 'all',
  batchNo: 'all',
  createdBy: 'all',
})

const showGenerateModal = ref(false)
const showEditModal = ref(false)
const showDetailModal = ref(false)
const editingCard = ref<Card | null>(null)
const detailCard = ref<Card | null>(null)
const detailLogs = ref<CardLog[]>([])
const generatedCards = ref<Card[]>([])

const newCard = ref({
  description: '',
  type: 'M',
  days: 30,
  count: 1,
  batchName: '',
  source: 'manual',
  channel: '',
  note: '',
})

const editCardForm = ref({
  description: '',
  type: 'M',
  days: 30,
  batchNo: '',
  batchName: '',
  source: 'manual',
  channel: '',
  note: '',
  enabled: true,
})

const cardTypeSelectOptions = CARD_TYPE_OPTIONS.map(option => ({
  value: option.value,
  label: option.defaultDays ? `${option.label} (${option.defaultDays}天)` : option.label,
}))

const sourceFilterSelectOptions = computed(() => {
  const values = new Set<string>(generateSourceOptions.map(option => String(option.value)))
  filterOptions.value.sources.forEach(source => values.add(source))
  return [
    { value: 'all', label: '全部来源' },
    ...Array.from(values).sort().map(source => ({
      value: source,
      label: formatCardSource(source),
    })),
  ]
})

const batchFilterSelectOptions = computed(() => {
  return [
    { value: 'all', label: '全部批次' },
    ...filterOptions.value.batches,
  ]
})

const creatorFilterSelectOptions = computed(() => {
  return [
    { value: 'all', label: '全部创建人' },
    ...filterOptions.value.creators.map(name => ({ value: name, label: name })),
  ]
})

const filteredCards = computed(() => {
  const keyword = filters.value.keyword.trim().toLowerCase()

  return cards.value.filter((card) => {
    const keywordMatched = !keyword || [
      card.code,
      card.description,
      card.batchNo || '',
      card.batchName || '',
      card.source || '',
      card.channel || '',
      card.note || '',
      card.createdBy || '',
      card.usedBy || '',
    ].some(value => String(value).toLowerCase().includes(keyword))

    const typeMatched = filters.value.type === 'all' || card.type === filters.value.type
    const statusMatched = matchStatus(card, filters.value.status)
    const sourceMatched = filters.value.source === 'all' || card.source === filters.value.source
    const batchMatched = filters.value.batchNo === 'all' || card.batchNo === filters.value.batchNo
    const creatorMatched = filters.value.createdBy === 'all' || card.createdBy === filters.value.createdBy

    return keywordMatched && typeMatched && statusMatched && sourceMatched && batchMatched && creatorMatched
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredCards.value.length / Number(pageSize.value || 20))))

const pagedCards = computed(() => {
  const start = (page.value - 1) * Number(pageSize.value || 20)
  return filteredCards.value.slice(start, start + Number(pageSize.value || 20))
})

const visibleCodes = computed(() => pagedCards.value.map(card => card.code))
const allVisibleSelected = computed(() => visibleCodes.value.length > 0 && visibleCodes.value.every(code => selectedCards.value.includes(code)))

watch(() => newCard.value.type, (nextType) => {
  const option = CARD_TYPE_OPTIONS.find(item => item.value === nextType)
  if (option && option.defaultDays !== null) {
    newCard.value.days = option.defaultDays
  }
})

watch(() => editCardForm.value.type, (nextType) => {
  const option = CARD_TYPE_OPTIONS.find(item => item.value === nextType)
  if (option && option.defaultDays !== null && editingCard.value?.canEditType) {
    editCardForm.value.days = option.defaultDays
  }
})

watch(filters, () => {
  page.value = 1
  selectedCards.value = []
}, { deep: true })

watch(pageSize, () => {
  page.value = 1
  selectedCards.value = []
})

watch(totalPages, (nextTotalPages) => {
  if (page.value > nextTotalPages) {
    page.value = nextTotalPages
  }
})

onMounted(async () => {
  await loadCards()
})

async function loadCards() {
  loading.value = true
  try {
    const res = await api.get('/api/cards')
    cards.value = res.data.cards || []
    summary.value = { ...createEmptySummary(), ...(res.data.summary || {}) }
    filterOptions.value = {
      sources: res.data.filterOptions?.sources || [],
      creators: res.data.filterOptions?.creators || [],
      batches: res.data.filterOptions?.batches || [],
    }
  }
  finally {
    loading.value = false
  }
}

function matchStatus(card: Card, status: string) {
  if (status === 'all')
    return true
  if (status === 'used')
    return card.isUsed
  return card.status === status
}

function resetFilters() {
  filters.value = {
    keyword: '',
    type: 'all',
    status: 'all',
    source: 'all',
    batchNo: 'all',
    createdBy: 'all',
  }
}

function toggleSelectAllVisible() {
  if (allVisibleSelected.value) {
    selectedCards.value = selectedCards.value.filter(code => !visibleCodes.value.includes(code))
    return
  }

  const merged = new Set([...selectedCards.value, ...visibleCodes.value])
  selectedCards.value = Array.from(merged)
}

function openGenerateModal() {
  newCard.value = {
    description: '',
    type: 'M',
    days: 30,
    count: 1,
    batchName: '',
    source: 'manual',
    channel: '',
    note: '',
  }
  generatedCards.value = []
  actionError.value = ''
  showGenerateModal.value = true
}

function openEditModal(card: Card) {
  editingCard.value = card
  editCardForm.value = {
    description: card.description || '',
    type: card.type,
    days: card.days || 30,
    batchNo: card.batchNo || '',
    batchName: card.batchName || '',
    source: card.source || 'manual',
    channel: card.channel || '',
    note: card.note || '',
    enabled: card.enabled,
  }
  actionError.value = ''
  showEditModal.value = true
}

async function openDetailModal(card: Card) {
  showDetailModal.value = true
  detailLoading.value = true
  detailCard.value = card
  detailLogs.value = []

  try {
    const res = await api.get(`/api/cards/${card.code}`)
    detailCard.value = res.data.card || card
    detailLogs.value = res.data.logs || []
  }
  finally {
    detailLoading.value = false
  }
}

async function generateCards() {
  actionLoading.value = true
  actionError.value = ''

  try {
    const res = await api.post('/api/cards', {
      description: newCard.value.description,
      type: newCard.value.type,
      days: newCard.value.type === 'F' ? null : Number(newCard.value.days),
      count: Number(newCard.value.count),
      batchName: newCard.value.batchName,
      source: newCard.value.source,
      channel: newCard.value.channel,
      note: newCard.value.note,
    })

    generatedCards.value = res.data.cards || []
    await loadCards()
    toast.success(`已生成 ${generatedCards.value.length} 张卡密`)
  }
  catch (error: any) {
    actionError.value = error.response?.data?.error || error.message || '生成失败'
  }
  finally {
    actionLoading.value = false
  }
}

async function saveEdit() {
  if (!editingCard.value)
    return

  actionLoading.value = true
  actionError.value = ''

  try {
    const res = await api.put(`/api/cards/${editingCard.value.code}`, {
      description: editCardForm.value.description,
      type: editCardForm.value.type,
      days: editCardForm.value.type === 'F' ? null : Number(editCardForm.value.days),
      batchNo: editCardForm.value.batchNo,
      batchName: editCardForm.value.batchName,
      source: editCardForm.value.source,
      channel: editCardForm.value.channel,
      note: editCardForm.value.note,
      enabled: editCardForm.value.enabled,
    })

    showEditModal.value = false
    toast.success('卡密更新成功')
    await loadCards()

    if (detailCard.value?.code === editingCard.value.code) {
      const nextDetailCard = res.data.card || detailCard.value
      if (nextDetailCard) {
        detailCard.value = nextDetailCard
        await openDetailModal(nextDetailCard)
      }
    }
  }
  catch (error: any) {
    actionError.value = error.response?.data?.error || error.message || '保存失败'
  }
  finally {
    actionLoading.value = false
  }
}

async function deleteCard(code: string) {
  if (!window.confirm('确定要删除这张卡密吗？已使用卡密不可删除。'))
    return

  try {
    await api.delete(`/api/cards/${code}`)
    selectedCards.value = selectedCards.value.filter(item => item !== code)
    toast.success('卡密删除成功')
    await loadCards()
  }
  catch (error) {
    console.error('删除卡密失败:', error)
  }
}

async function batchSetEnabled(enabled: boolean) {
  if (selectedCards.value.length === 0)
    return

  batchActionLoading.value = true
  try {
    const res = await api.post('/api/cards/batch-update', {
      codes: selectedCards.value,
      updates: { enabled },
    })

    const updatedCount = res.data.updatedCount || 0
    const skipped = res.data.skipped || []
    toast[skipped.length ? 'warning' : 'success'](`${enabled ? '启用' : '禁用'}完成，成功 ${updatedCount} 张${skipped.length ? `，跳过 ${skipped.length} 张` : ''}`)
    selectedCards.value = []
    await loadCards()
  }
  finally {
    batchActionLoading.value = false
  }
}

async function batchDelete() {
  if (selectedCards.value.length === 0)
    return

  if (!window.confirm(`确定删除选中的 ${selectedCards.value.length} 张卡密吗？已使用卡密会自动跳过。`))
    return

  batchActionLoading.value = true
  try {
    const res = await api.post('/api/cards/batch-delete', {
      codes: selectedCards.value,
    })

    const deletedCount = res.data.deletedCount || 0
    const skipped = res.data.skipped || []
    toast[skipped.length ? 'warning' : 'success'](`批量删除完成，成功 ${deletedCount} 张${skipped.length ? `，跳过 ${skipped.length} 张` : ''}`)
    selectedCards.value = []
    await loadCards()
  }
  finally {
    batchActionLoading.value = false
  }
}

function changePage(offset: number) {
  const nextPage = Math.min(totalPages.value, Math.max(1, page.value + offset))
  page.value = nextPage
}

async function copyText(text: string, message: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.left = '-999999px'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    toast.success(message)
  }
  catch (error) {
    console.error('复制失败:', error)
    toast.error('复制失败，请手动复制')
  }
}

function copyToText(code: string) {
  copyText(code, '卡密已复制')
}

function copyAllGenerated() {
  const content = generatedCards.value.map(card => card.code).join('\n')
  copyText(content, '本次生成卡密已全部复制')
}

function formatCardType(type: string) {
  return CARD_TYPE_OPTIONS.find(option => option.value === type)?.label || type
}

function formatCardSource(source: string) {
  return CARD_SOURCE_LABELS[source] || source || '未设置'
}

function formatDateTime(timestamp: number | null | undefined) {
  if (!timestamp)
    return '-'

  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatExpiry(card: Card | CardLogSnapshot | null) {
  if (!card)
    return '-'
  if (card.type === 'F' || card.expiresAt == null)
    return '永久'
  return formatDateTime(card.expiresAt)
}

function formatLogAction(action: string) {
  return ACTION_LABELS[action] || action
}

function formatSnapshot(snapshot: CardLogSnapshot | null) {
  if (!snapshot)
    return '-'

  const parts = [
    snapshot.type ? `类型 ${formatCardType(snapshot.type)}` : '',
    snapshot.days != null ? `时长 ${snapshot.days}天` : '',
    snapshot.source ? `来源 ${formatCardSource(snapshot.source)}` : '',
    snapshot.enabled !== undefined ? `可兑换 ${snapshot.enabled ? '是' : '否'}` : '',
    snapshot.usedBy ? `用户 ${snapshot.usedBy}` : '',
    snapshot.expiresAt != null ? `到期 ${formatExpiry(snapshot)}` : '',
  ].filter(Boolean)

  return parts.join(' | ') || '-'
}

function toneClass(tone: string) {
  switch (tone) {
    case 'blue':
      return 'bg-blue-100/70 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    case 'green':
      return 'bg-primary-100/70 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
    case 'amber':
      return 'bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    case 'red':
      return 'bg-red-100/80 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    case 'purple':
      return 'bg-purple-100/80 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    default:
      return 'bg-gray-100/80 text-gray-700 dark:bg-white/10 dark:text-gray-300'
  }
}
</script>

<template>
  <div class="space-y-6 p-6">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="glass-text-main text-2xl font-bold">
          卡密管理
        </h1>
        <p class="glass-text-muted mt-1 text-sm">
          提供卡密统计、筛选、批量操作、批次管理和使用历史追踪
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <BaseButton variant="outline" size="sm" :loading="loading" @click="loadCards">
          刷新列表
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="openGenerateModal">
          生成卡密
        </BaseButton>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <div class="glass-panel rounded-2xl p-4 shadow-sm">
        <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
          总卡密
        </p>
        <p class="glass-text-main mt-3 text-3xl font-semibold">
          {{ summary.total }}
        </p>
        <p class="glass-text-muted mt-2 text-xs">
          当前筛选后 {{ filteredCards.length }} 条
        </p>
      </div>
      <div class="glass-panel rounded-2xl p-4 shadow-sm">
        <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
          待使用 / 禁用
        </p>
        <p class="glass-text-main mt-3 text-3xl font-semibold">
          {{ summary.unused }}
        </p>
        <p class="glass-text-muted mt-2 text-xs">
          禁用 {{ summary.disabled }} 张
        </p>
      </div>
      <div class="glass-panel rounded-2xl p-4 shadow-sm">
        <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
          已使用
        </p>
        <p class="glass-text-main mt-3 text-3xl font-semibold">
          {{ summary.used }}
        </p>
        <p class="glass-text-muted mt-2 text-xs">
          生效中 {{ summary.usedActive }} / 即将到期 {{ summary.usedExpiring }}
        </p>
      </div>
      <div class="glass-panel rounded-2xl p-4 shadow-sm">
        <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
          过期 / 永久
        </p>
        <p class="glass-text-main mt-3 text-3xl font-semibold">
          {{ summary.usedExpired }}
        </p>
        <p class="glass-text-muted mt-2 text-xs">
          永久生效 {{ summary.usedForever }} / 永久卡 {{ summary.permanent }}
        </p>
      </div>
      <div class="glass-panel rounded-2xl p-4 shadow-sm">
        <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
          批次 / 体验卡
        </p>
        <p class="glass-text-main mt-3 text-3xl font-semibold">
          {{ summary.batches }}
        </p>
        <p class="glass-text-muted mt-2 text-xs">
          体验卡 {{ summary.trial }} 张
        </p>
      </div>
    </div>

    <div class="glass-panel rounded-2xl p-5 shadow-md">
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <BaseInput
          v-model="filters.keyword"
          label="搜索"
          placeholder="卡密 / 描述 / 用户 / 批次 / 备注"
          clearable
        />
        <BaseSelect
          v-model="filters.type"
          label="卡密类型"
          :options="[{ value: 'all', label: '全部类型' }, ...cardTypeSelectOptions]"
        />
        <BaseSelect
          v-model="filters.status"
          label="状态"
          :options="statusFilterOptions"
        />
        <BaseSelect
          v-model="filters.source"
          label="来源"
          :options="sourceFilterSelectOptions"
        />
        <BaseSelect
          v-model="filters.batchNo"
          label="批次"
          :options="batchFilterSelectOptions"
        />
        <BaseSelect
          v-model="filters.createdBy"
          label="创建人"
          :options="creatorFilterSelectOptions"
        />
      </div>

      <div class="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-2">
          <BaseButton variant="outline" size="sm" @click="resetFilters">
            重置筛选
          </BaseButton>
          <BaseSelect
            v-model="pageSize"
            label="每页数量"
            :options="pageSizeOptions"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span class="glass-text-muted text-sm">
            已选 {{ selectedCards.length }} 张
          </span>
          <BaseButton
            variant="outline"
            size="sm"
            :disabled="selectedCards.length === 0"
            :loading="batchActionLoading"
            @click="batchSetEnabled(true)"
          >
            批量启用
          </BaseButton>
          <BaseButton
            variant="outline"
            size="sm"
            :disabled="selectedCards.length === 0"
            :loading="batchActionLoading"
            @click="batchSetEnabled(false)"
          >
            批量禁用
          </BaseButton>
          <BaseButton
            variant="danger"
            size="sm"
            :disabled="selectedCards.length === 0"
            :loading="batchActionLoading"
            @click="batchDelete"
          >
            批量删除
          </BaseButton>
        </div>
      </div>
    </div>

    <div class="glass-panel overflow-hidden rounded-2xl shadow-md">
      <div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 class="glass-text-main text-lg font-semibold">
            卡密列表
          </h2>
          <p class="glass-text-muted mt-1 text-xs">
            支持查看批次、来源、状态、到期信息和使用轨迹
          </p>
        </div>
        <span class="glass-text-muted text-sm">
          第 {{ page }} / {{ totalPages }} 页
        </span>
      </div>

      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-white/10">
          <thead class="bg-black/5 dark:bg-white/5">
            <tr>
              <th class="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  class="h-4 w-4 rounded border-black/10 bg-black/5 text-primary-600 dark:border-white/20 dark:bg-black/40 focus:ring-primary-500"
                  @change="toggleSelectAllVisible"
                >
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                卡密 / 批次
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                描述 / 备注
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                类型 / 时长
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                来源 / 渠道
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                状态
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                使用情况
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                创建信息
              </th>
              <th class="glass-text-muted px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>

          <tbody class="divide-y divide-white/10">
            <tr v-if="loading">
              <td colspan="9" class="glass-text-muted px-4 py-10 text-center text-sm">
                正在加载卡密列表...
              </td>
            </tr>

            <tr
              v-for="card in pagedCards"
              :key="card.code"
              class="transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              :class="selectedCards.includes(card.code) ? 'bg-primary-500/10' : ''"
            >
              <td class="px-4 py-4 align-top">
                <input
                  v-model="selectedCards"
                  type="checkbox"
                  :value="card.code"
                  class="h-4 w-4 rounded border-black/10 bg-black/5 text-primary-600 dark:border-white/20 dark:bg-black/40 focus:ring-primary-500"
                >
              </td>

              <td class="px-4 py-4 align-top">
                <div class="flex items-start gap-2">
                  <div>
                    <code class="glass-text-main rounded-lg bg-black/5 px-2 py-1 text-xs font-mono dark:bg-white/10">
                      {{ card.code }}
                    </code>
                    <div class="glass-text-muted mt-2 text-xs">
                      <span v-if="card.batchName || card.batchNo">{{ card.batchName || '未命名批次' }}</span>
                      <span v-else>单卡</span>
                    </div>
                    <div v-if="card.batchNo" class="glass-text-muted mt-1 text-[11px] font-mono">
                      {{ card.batchNo }}
                    </div>
                  </div>
                  <button class="text-gray-400 hover:text-primary-500" title="复制卡密" @click="copyToText(card.code)">
                    <div class="i-carbon-copy text-lg" />
                  </button>
                </div>
              </td>

              <td class="px-4 py-4 align-top">
                <div class="glass-text-main text-sm">
                  {{ card.description || '-' }}
                </div>
                <div class="glass-text-muted mt-2 max-w-[240px] text-xs leading-5">
                  {{ card.note || '无备注' }}
                </div>
              </td>

              <td class="px-4 py-4 align-top">
                <div class="glass-text-main text-sm font-medium">
                  {{ formatCardType(card.type) }}
                </div>
                <div class="glass-text-muted mt-2 text-xs">
                  {{ card.type === 'F' ? '永久有效' : `${card.days} 天` }}
                </div>
              </td>

              <td class="px-4 py-4 align-top">
                <div class="glass-text-main text-sm">
                  {{ formatCardSource(card.source) }}
                </div>
                <div class="glass-text-muted mt-2 text-xs">
                  {{ card.channel || '未设置渠道' }}
                </div>
              </td>

              <td class="px-4 py-4 align-top">
                <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="toneClass(card.statusTone)">
                  {{ card.statusLabel }}
                </span>
                <div class="glass-text-muted mt-2 text-xs">
                  {{ card.canToggleEnabled ? (card.enabled ? '可兑换' : '不可兑换') : '已进入历史记录' }}
                </div>
              </td>

              <td class="px-4 py-4 align-top text-sm">
                <div v-if="card.usedBy" class="space-y-1">
                  <div class="glass-text-main">
                    {{ card.usedBy }}
                  </div>
                  <div class="glass-text-muted text-xs">
                    使用于 {{ formatDateTime(card.usedAt) }}
                  </div>
                  <div class="glass-text-muted text-xs">
                    到期 {{ formatExpiry(card) }}
                  </div>
                </div>
                <div v-else class="glass-text-muted text-xs">
                  未使用
                </div>
              </td>

              <td class="px-4 py-4 align-top text-sm">
                <div class="glass-text-main">
                  {{ card.createdBy || '未记录' }}
                </div>
                <div class="glass-text-muted mt-2 text-xs">
                  创建 {{ formatDateTime(card.createdAt) }}
                </div>
                <div class="glass-text-muted mt-1 text-xs">
                  更新 {{ formatDateTime(card.updatedAt) }}
                </div>
              </td>

              <td class="px-4 py-4 align-top">
                <div class="flex flex-wrap gap-2">
                  <BaseButton variant="text" size="sm" @click="openDetailModal(card)">
                    详情
                  </BaseButton>
                  <BaseButton variant="text" size="sm" @click="openEditModal(card)">
                    编辑
                  </BaseButton>
                  <BaseButton
                    variant="text"
                    size="sm"
                    :disabled="!card.canDelete"
                    @click="deleteCard(card.code)"
                  >
                    删除
                  </BaseButton>
                </div>
              </td>
            </tr>

            <tr v-if="!loading && pagedCards.length === 0">
              <td colspan="9" class="px-4 py-12 text-center">
                <div class="i-carbon-license-draft mx-auto text-4xl text-gray-400" />
                <p class="glass-text-main mt-3 text-sm">
                  当前筛选条件下没有卡密
                </p>
                <p class="glass-text-muted mt-2 text-xs">
                  可以调整筛选条件，或者直接生成新的卡密批次
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-col gap-3 border-t border-white/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="glass-text-muted text-sm">
          共 {{ filteredCards.length }} 张卡密，当前显示 {{ pagedCards.length }} 张
        </div>

        <div class="flex items-center gap-2">
          <BaseButton variant="outline" size="sm" :disabled="page <= 1" @click="changePage(-1)">
            上一页
          </BaseButton>
          <span class="glass-text-main min-w-[88px] text-center text-sm">
            {{ page }} / {{ totalPages }}
          </span>
          <BaseButton variant="outline" size="sm" :disabled="page >= totalPages" @click="changePage(1)">
            下一页
          </BaseButton>
        </div>
      </div>
    </div>

    <ConfirmModal
      v-model:show="showGenerateModal"
      title="生成卡密"
      confirm-text="开始生成"
      cancel-text="取消"
      :show-cancel="true"
      :loading="actionLoading"
      @confirm="generateCards"
      @cancel="showGenerateModal = false"
    >
      <div class="space-y-4 text-left">
        <BaseInput
          v-model="newCard.description"
          label="描述"
          placeholder="例如：3月活动月卡 / 用户补偿卡"
        />
        <div class="grid gap-4 md:grid-cols-2">
          <BaseSelect v-model="newCard.type" label="卡密类型" :options="cardTypeSelectOptions" />
          <BaseInput v-model="newCard.count" type="number" label="生成数量" />
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <BaseInput
            v-if="newCard.type !== 'F'"
            v-model="newCard.days"
            type="number"
            label="生效天数"
          />
          <BaseInput v-model="newCard.batchName" label="批次名称" placeholder="例如：春季活动第一批" />
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <BaseSelect v-model="newCard.source" label="来源" :options="generateSourceOptions" />
          <BaseInput v-model="newCard.channel" label="渠道" placeholder="例如：QQ群 / 官网活动页" />
        </div>
        <BaseTextarea v-model="newCard.note" label="备注" placeholder="记录投放说明、适用场景、限制条件" :rows="4" />

        <div v-if="generatedCards.length > 0" class="rounded-2xl bg-primary-500/10 p-4">
          <div class="mb-3 flex items-center justify-between">
            <div>
              <p class="text-sm text-primary-700 font-semibold dark:text-primary-300">
                已生成 {{ generatedCards.length }} 张卡密
              </p>
              <p class="glass-text-muted mt-1 text-xs">
                这批卡密已自动归入同一批次，便于后续筛选和批量管理
              </p>
            </div>
            <BaseButton variant="text" size="sm" @click="copyAllGenerated">
              复制全部
            </BaseButton>
          </div>
          <div class="max-h-48 space-y-2 overflow-y-auto rounded-xl bg-black/5 p-3 dark:bg-white/5">
            <div
              v-for="card in generatedCards"
              :key="card.code"
              class="flex items-center justify-between gap-3 rounded-lg px-2 py-1"
            >
              <code class="glass-text-main text-xs font-mono">{{ card.code }}</code>
              <button class="text-gray-400 hover:text-primary-500" @click="copyToText(card.code)">
                <div class="i-carbon-copy text-base" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="actionError" class="text-sm text-red-500">
          {{ actionError }}
        </div>
      </div>
    </ConfirmModal>

    <ConfirmModal
      v-model:show="showEditModal"
      title="编辑卡密"
      confirm-text="保存修改"
      cancel-text="取消"
      :show-cancel="true"
      :loading="actionLoading"
      @confirm="saveEdit"
      @cancel="showEditModal = false"
    >
      <div v-if="editingCard" class="space-y-4 text-left">
        <div class="rounded-xl bg-black/5 p-3 text-xs dark:bg-white/5">
          <div class="glass-text-muted">
            卡密编码
          </div>
          <code class="glass-text-main mt-2 block font-mono">{{ editingCard.code }}</code>
        </div>
        <BaseInput v-model="editCardForm.description" label="描述" placeholder="卡密用途说明" />
        <div class="grid gap-4 md:grid-cols-2">
          <BaseSelect
            v-model="editCardForm.type"
            label="卡密类型"
            :options="cardTypeSelectOptions"
            :disabled="!editingCard.canEditType"
          />
          <BaseInput
            v-if="editCardForm.type !== 'F'"
            v-model="editCardForm.days"
            type="number"
            label="生效天数"
            :disabled="!editingCard.canEditType"
          />
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <BaseInput v-model="editCardForm.batchNo" label="批次号" placeholder="可手动归并批次" />
          <BaseInput v-model="editCardForm.batchName" label="批次名称" placeholder="例如：首发补偿批次" />
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <BaseSelect v-model="editCardForm.source" label="来源" :options="generateSourceOptions" />
          <BaseInput v-model="editCardForm.channel" label="渠道" placeholder="例如：公众号 / 社群" />
        </div>
        <BaseTextarea v-model="editCardForm.note" label="备注" placeholder="记录投放目的、异常说明、人工备注" :rows="4" />
        <label class="flex items-center gap-3 text-sm">
          <input
            v-model="editCardForm.enabled"
            type="checkbox"
            class="h-4 w-4 rounded border-black/10 text-primary-600 focus:ring-primary-500 dark:border-white/20"
            :disabled="!editingCard.canToggleEnabled"
          >
          <span class="glass-text-main">允许兑换</span>
        </label>
        <p v-if="!editingCard.canToggleEnabled || !editingCard.canEditType" class="text-xs text-amber-500">
          已使用卡密只允许修改管理信息，不允许改类型、时长或重新启用。
        </p>
        <div v-if="actionError" class="text-sm text-red-500">
          {{ actionError }}
        </div>
      </div>
    </ConfirmModal>

    <Teleport to="body">
      <div v-if="showDetailModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="showDetailModal = false" />

        <div class="glass-panel relative max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-3xl shadow-2xl">
          <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div>
              <h3 class="glass-text-main text-xl font-semibold">
                卡密详情
              </h3>
              <p class="glass-text-muted mt-1 text-xs">
                查看卡密的批次信息、使用信息和操作历史
              </p>
            </div>
            <button class="rounded-full p-2 text-gray-400 hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200" @click="showDetailModal = false">
              <div class="i-carbon-close text-xl" />
            </button>
          </div>

          <div class="max-h-[calc(88vh-72px)] overflow-y-auto px-6 py-6">
            <div v-if="detailLoading" class="glass-text-muted py-12 text-center text-sm">
              正在加载卡密详情...
            </div>

            <div v-else-if="detailCard" class="space-y-6">
              <div class="grid gap-4 lg:grid-cols-3">
                <div class="glass-panel rounded-2xl p-4">
                  <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
                    基础信息
                  </p>
                  <div class="glass-text-main mt-4 space-y-3 text-sm">
                    <div>
                      <span class="glass-text-muted">卡密：</span>
                      <code class="ml-2 rounded bg-black/5 px-2 py-1 font-mono dark:bg-white/10">{{ detailCard.code }}</code>
                    </div>
                    <div>
                      <span class="glass-text-muted">类型：</span>
                      <span class="ml-2">{{ formatCardType(detailCard.type) }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">时长：</span>
                      <span class="ml-2">{{ detailCard.type === 'F' ? '永久有效' : `${detailCard.days} 天` }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">描述：</span>
                      <span class="ml-2">{{ detailCard.description || '-' }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">备注：</span>
                      <span class="ml-2">{{ detailCard.note || '-' }}</span>
                    </div>
                  </div>
                </div>

                <div class="glass-panel rounded-2xl p-4">
                  <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
                    归属与来源
                  </p>
                  <div class="glass-text-main mt-4 space-y-3 text-sm">
                    <div>
                      <span class="glass-text-muted">状态：</span>
                      <span class="ml-2 rounded-full px-2 py-1 text-xs font-medium" :class="toneClass(detailCard.statusTone)">
                        {{ detailCard.statusLabel }}
                      </span>
                    </div>
                    <div>
                      <span class="glass-text-muted">批次：</span>
                      <span class="ml-2">{{ detailCard.batchName || detailCard.batchNo || '-' }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">批次号：</span>
                      <span class="ml-2 font-mono">{{ detailCard.batchNo || '-' }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">来源：</span>
                      <span class="ml-2">{{ formatCardSource(detailCard.source) }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">渠道：</span>
                      <span class="ml-2">{{ detailCard.channel || '-' }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">创建人：</span>
                      <span class="ml-2">{{ detailCard.createdBy || '-' }}</span>
                    </div>
                  </div>
                </div>

                <div class="glass-panel rounded-2xl p-4">
                  <p class="glass-text-muted text-xs uppercase tracking-[0.2em]">
                    使用信息
                  </p>
                  <div class="glass-text-main mt-4 space-y-3 text-sm">
                    <div>
                      <span class="glass-text-muted">兑换状态：</span>
                      <span class="ml-2">{{ detailCard.canToggleEnabled ? (detailCard.enabled ? '可兑换' : '不可兑换') : '历史卡密' }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">使用用户：</span>
                      <span class="ml-2">{{ detailCard.usedBy || '-' }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">使用时间：</span>
                      <span class="ml-2">{{ formatDateTime(detailCard.usedAt) }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">到期时间：</span>
                      <span class="ml-2">{{ formatExpiry(detailCard) }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">创建时间：</span>
                      <span class="ml-2">{{ formatDateTime(detailCard.createdAt) }}</span>
                    </div>
                    <div>
                      <span class="glass-text-muted">更新时间：</span>
                      <span class="ml-2">{{ formatDateTime(detailCard.updatedAt) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="glass-panel rounded-2xl p-5">
                <div class="flex items-center justify-between">
                  <div>
                    <h4 class="glass-text-main text-lg font-semibold">
                      操作历史
                    </h4>
                    <p class="glass-text-muted mt-1 text-xs">
                      记录生成、编辑、删除、注册使用、续费使用等关键动作
                    </p>
                  </div>
                  <span class="glass-text-muted text-sm">
                    共 {{ detailLogs.length }} 条
                  </span>
                </div>

                <div v-if="detailLogs.length === 0" class="glass-text-muted py-10 text-center text-sm">
                  暂无操作历史
                </div>

                <div v-else class="mt-4 space-y-3">
                  <div
                    v-for="log in detailLogs"
                    :key="log.id"
                    class="rounded-2xl border border-white/10 bg-black/5 p-4 dark:bg-white/5"
                  >
                    <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="rounded-full bg-black/10 px-2 py-1 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-200">
                          {{ formatLogAction(log.action) }}
                        </span>
                        <span class="glass-text-main text-sm">{{ log.operator || '系统' }}</span>
                        <span v-if="log.targetUsername" class="glass-text-muted text-xs">
                          目标用户：{{ log.targetUsername }}
                        </span>
                      </div>
                      <span class="glass-text-muted text-xs">
                        {{ formatDateTime(log.createdAt) }}
                      </span>
                    </div>

                    <p v-if="log.remark" class="glass-text-main mt-3 text-sm">
                      {{ log.remark }}
                    </p>

                    <div class="mt-3 grid gap-3 lg:grid-cols-2">
                      <div class="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                        <p class="glass-text-muted text-xs">
                          变更前
                        </p>
                        <p class="glass-text-main mt-2 text-xs leading-5">
                          {{ formatSnapshot(log.beforeSnapshot) }}
                        </p>
                      </div>
                      <div class="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                        <p class="glass-text-muted text-xs">
                          变更后
                        </p>
                        <p class="glass-text-main mt-2 text-xs leading-5">
                          {{ formatSnapshot(log.afterSnapshot) }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
