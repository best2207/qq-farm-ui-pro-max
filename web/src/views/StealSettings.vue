<script setup lang="ts">
import type { CropAtlasEntry } from '@/utils/crop-atlas'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { useSettingStore } from '@/stores/setting'
import { useToastStore } from '@/stores/toast'
import { loadCropAtlasEntries, normalizeCropSelectionIds } from '@/utils/crop-atlas'
import { localizeRuntimeText } from '@/utils/runtime-text'

const accountStore = useAccountStore()
const friendStore = useFriendStore()
const settingStore = useSettingStore()
const toast = useToastStore()

const { currentAccountId, accounts } = storeToRefs(accountStore)
const { friends: liveFriends, cachedFriends, loading: friendsLoading } = storeToRefs(friendStore)
const { settings, loading: settingsLoading } = storeToRefs(settingStore)

const avatarErrorKeys = ref<Set<string>>(new Set())
const plantImageErrorKeys = ref<Set<number>>(new Set())
const plantImageFallbackIndex = ref<Record<number, number>>({})

interface FriendRiskProfile {
  friendGid: number
  friendUin?: string
  friendOpenId?: string
  friendName: string
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high' | string
  strategyState?: string
  tags?: string[]
  lastHitReason?: string
  lastHitAt?: number
}

interface FriendRiskSummary {
  total: number
  low: number
  medium: number
  high: number
  topProfiles: FriendRiskProfile[]
}

interface FriendStealStat {
  friendGid: number
  friendName: string
  friendUin?: string
  friendOpenId?: string
  stealCount: number
  landCount: number
  lastMode?: string
  lastPlantNames?: string[]
  lastStealAt?: number
}

interface FriendStealOverview {
  totalFriends: number
  totalStealCount: number
  totalLandCount: number
  topFriends: FriendStealStat[]
}

function getSafeImageUrl(url: string) {
  const normalized = String(url || '').trim()
  if (!normalized)
    return ''
  if (normalized.startsWith('http://'))
    return normalized.replace('http://', 'https://')
  return normalized
}

function getFriendSelectionId(friend: any) {
  const candidates = [friend?.gid, friend?.friendGid, friend?.id]
  for (const candidate of candidates) {
    const resolved = Number(candidate || 0)
    if (Number.isFinite(resolved) && resolved > 0)
      return resolved
  }
  return 0
}

function getFriendDisplayName(friend: any) {
  const direct = String(friend?.name || friend?.remark || friend?.nick || friend?.userName || '').trim()
  if (direct)
    return direct
  const gid = getFriendSelectionId(friend)
  return gid > 0 ? `GID:${gid}` : '未命名好友'
}

function getFriendSecondaryLabel(friend: any) {
  const gid = String(getFriendSelectionId(friend) || '')
  const uin = String(friend?.uin || '').trim()
  if (uin && /^\d+$/.test(uin) && uin !== gid)
    return `QQ ${uin}`
  const openId = String(friend?.openId || friend?.open_id || '').trim()
  if (openId && openId !== gid)
    return `标识 ${openId}`
  const numericGid = getFriendSelectionId(friend)
  return numericGid > 0 ? `GID ${numericGid}` : '--'
}

const resolvedFriends = computed(() => {
  const merged = new Map<number, any>()
  for (const source of [liveFriends.value, cachedFriends.value]) {
    for (const friend of Array.isArray(source) ? source : []) {
      const gid = getFriendSelectionId(friend)
      if (!gid)
        continue
      const prev = merged.get(gid) || {}
      merged.set(gid, {
        ...prev,
        ...friend,
        gid,
        id: friend?.id ?? prev.id ?? gid,
        uin: String(friend?.uin || prev.uin || '').trim(),
        name: getFriendDisplayName({ ...prev, ...friend, gid }),
        avatarUrl: String(friend?.avatarUrl || friend?.avatar_url || prev.avatarUrl || '').trim(),
      })
    }
  }
  return Array.from(merged.values())
})

function getFriendAvatar(friend: any) {
  const direct = getSafeImageUrl(friend?.avatarUrl || friend?.avatar_url || '')
  if (direct)
    return direct
  const gid = String(getFriendSelectionId(friend) || '')
  const idCandidate = String(friend?.id || '').trim()
  const rawUin = String(friend?.uin || '').trim()
  const uin = rawUin && /^\d+$/.test(rawUin) && rawUin !== gid
    ? rawUin
    : (idCandidate && /^\d+$/.test(idCandidate) && idCandidate !== gid ? idCandidate : '')
  if (uin)
    return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return ''
}

function getFriendAvatarKey(friend: any) {
  const key = String(getFriendSelectionId(friend) || friend?.uin || friend?.id || '').trim()
  return key || String(friend?.name || '').trim()
}

function canShowFriendAvatar(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return false
  return !!getFriendAvatar(friend) && !avatarErrorKeys.value.has(key)
}

function handleFriendAvatarError(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return
  avatarErrorKeys.value.add(key)
}

const saving = ref(false)

const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

const localSettings = ref({
  automation: {
    stealFilterEnabled: false,
    stealFilterMode: 'blacklist' as 'blacklist' | 'whitelist',
    stealFilterPlantIds: [] as number[],
    stealFriendFilterEnabled: false,
    stealFriendFilterMode: 'blacklist' as 'blacklist' | 'whitelist',
    stealFriendFilterIds: [] as number[],
    skipStealRadishEnabled: false,
  } as Record<string, any>,
  friendRiskConfig: {
    enabled: true,
    passiveDetectEnabled: true,
    passiveWindowSec: 180,
    passiveDailyThreshold: 3,
    markScoreThreshold: 50,
    autoDeprioritize: false,
    eventRetentionDays: 30,
  },
  specialCareFriendIds: [] as number[],
  experimentalFeatures: {
    focusStealEnabled: false,
  },
})

const cropEntries = ref<CropAtlasEntry[]>([])
const riskInsightsLoading = ref(false)
const riskInsightsUpdatedAt = ref(0)
const friendRiskProfiles = ref<FriendRiskProfile[]>([])
const friendRiskSummary = ref<FriendRiskSummary>({
  total: 0,
  low: 0,
  medium: 0,
  high: 0,
  topProfiles: [],
})
const friendStealOverview = ref<FriendStealOverview>({
  totalFriends: 0,
  totalStealCount: 0,
  totalLandCount: 0,
  topFriends: [],
})
const friendStealStats = ref<FriendStealStat[]>([])

// === UI State ===
const activeTab = ref<'friends' | 'plants'>('friends')
const searchQuery = ref('')
const selectedAccount = ref<string>(currentAccountId.value || '')
const selectedAccountRecord = computed(() =>
  accounts.value.find(a => String(a?.id || a?.uin || '') === String(selectedAccount.value || '')),
)
const showFriendsLoading = computed(() => friendsLoading.value && resolvedFriends.value.length === 0)
const footerSelectionSummary = computed(() => activeTab.value === 'friends'
  ? `当前名单 ${localSettings.value.automation.stealFriendFilterIds.length}/${resolvedFriends.value.length || 0}`
  : `当前作物 ${localSettings.value.automation.stealFilterPlantIds.length}/${cropEntries.value.length || 0}`)
const specialCareSet = computed(() => new Set(localSettings.value.specialCareFriendIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)))
const friendRiskProfileMap = computed(() => {
  const map = new Map<number, FriendRiskProfile>()
  for (const profile of friendRiskProfiles.value) {
    const gid = Number(profile.friendGid || 0)
    if (gid > 0)
      map.set(gid, profile)
  }
  return map
})
const strategySummaryCards = computed(() => [
  {
    key: 'risk-total',
    label: '风险好友',
    value: `${friendRiskSummary.value.total} 人`,
    hint: `高风险 ${friendRiskSummary.value.high} / 中风险 ${friendRiskSummary.value.medium}`,
  },
  {
    key: 'special-care',
    label: '特别关照名单',
    value: `${localSettings.value.specialCareFriendIds.length} 人`,
    hint: localSettings.value.experimentalFeatures.focusStealEnabled ? '重点偷取实验模式已启用' : '当前仅做名单管理',
  },
  {
    key: 'steal-friends',
    label: '命中过的好友',
    value: `${friendStealOverview.value.totalFriends} 人`,
    hint: `累计偷取 ${friendStealOverview.value.totalStealCount} 次 / 地块 ${friendStealOverview.value.totalLandCount}`,
  },
  {
    key: 'passive-window',
    label: '被动识别窗口',
    value: `${localSettings.value.friendRiskConfig.passiveWindowSec}s`,
    hint: `日阈值 ${localSettings.value.friendRiskConfig.passiveDailyThreshold} 次，标记阈值 ${localSettings.value.friendRiskConfig.markScoreThreshold} 分`,
  },
])

function normalizeNumberList(value: unknown) {
  if (!Array.isArray(value))
    return []
  return value
    .map(item => Math.max(0, Number.parseInt(String(item), 10) || 0))
    .filter(item => item > 0)
}

function sanitizeFriendRiskConfig(input: any) {
  const source = input && typeof input === 'object' ? input : {}
  return {
    enabled: source.enabled !== false,
    passiveDetectEnabled: source.passiveDetectEnabled !== false,
    passiveWindowSec: Math.max(30, Number.parseInt(String(source.passiveWindowSec ?? 180), 10) || 180),
    passiveDailyThreshold: Math.max(1, Number.parseInt(String(source.passiveDailyThreshold ?? 3), 10) || 3),
    markScoreThreshold: Math.max(10, Number.parseInt(String(source.markScoreThreshold ?? 50), 10) || 50),
    autoDeprioritize: !!source.autoDeprioritize,
    eventRetentionDays: Math.max(1, Number.parseInt(String(source.eventRetentionDays ?? 30), 10) || 30),
  }
}

function syncLocalSettings() {
  if (settings.value && settings.value.automation) {
    const s = settings.value.automation as any
    // 后端返回的 plantIds/friendIds 为字符串，先统一转为数字
    localSettings.value.automation = {
      stealFilterEnabled: s.stealFilterEnabled ?? false,
      stealFilterMode: s.stealFilterMode ?? 'blacklist',
      stealFilterPlantIds: (s.stealFilterPlantIds || []).map((id: any) => Number(id)),
      stealFriendFilterEnabled: s.stealFriendFilterEnabled ?? false,
      stealFriendFilterMode: s.stealFriendFilterMode ?? 'blacklist',
      stealFriendFilterIds: (s.stealFriendFilterIds || []).map((id: any) => Number(id)),
      skipStealRadishEnabled: s.skipStealRadishEnabled ?? false,
    }
    localSettings.value.friendRiskConfig = sanitizeFriendRiskConfig(settings.value.friendRiskConfig)
    localSettings.value.specialCareFriendIds = normalizeNumberList(settings.value.specialCareFriendIds)
    localSettings.value.experimentalFeatures = {
      focusStealEnabled: !!settings.value.experimentalFeatures?.focusStealEnabled,
    }
  }
}

function getFriendRiskProfile(friend: any) {
  const gid = getFriendSelectionId(friend)
  return friendRiskProfileMap.value.get(gid) || null
}

function isSpecialCareFriend(friend: any) {
  return specialCareSet.value.has(getFriendSelectionId(friend))
}

function toggleSpecialCareFriend(friend: any) {
  const gid = getFriendSelectionId(friend)
  if (!gid)
    return
  const next = new Set(localSettings.value.specialCareFriendIds)
  if (next.has(gid))
    next.delete(gid)
  else
    next.add(gid)
  localSettings.value.specialCareFriendIds = Array.from(next)
}

function formatRiskLevelLabel(level?: string) {
  if (level === 'high')
    return '高风险'
  if (level === 'medium')
    return '中风险'
  return '低风险'
}

function getRiskToneClasses(level?: string) {
  if (level === 'high')
    return 'border-[color:color-mix(in_srgb,var(--ui-status-danger)_40%,var(--ui-border-subtle))] bg-[color:color-mix(in_srgb,var(--ui-status-danger)_10%,var(--ui-bg-surface-raised))] text-[color:color-mix(in_srgb,var(--ui-status-danger)_84%,var(--ui-text-1))]'
  if (level === 'medium')
    return 'border-[color:color-mix(in_srgb,var(--ui-status-warning)_40%,var(--ui-border-subtle))] bg-[color:color-mix(in_srgb,var(--ui-status-warning)_10%,var(--ui-bg-surface-raised))] text-[color:color-mix(in_srgb,var(--ui-status-warning)_82%,var(--ui-text-1))]'
  return 'border-[color:color-mix(in_srgb,var(--ui-status-info)_32%,var(--ui-border-subtle))] bg-[color:color-mix(in_srgb,var(--ui-status-info)_10%,var(--ui-bg-surface-raised))] text-[color:color-mix(in_srgb,var(--ui-status-info)_82%,var(--ui-text-1))]'
}

function formatRiskReason(reason?: string) {
  const raw = String(reason || '').trim()
  if (raw === 'organic_window_steal')
    return '施肥后短时被偷'
  if (raw === 'repeat_daily_steal')
    return '单日高频偷取'
  if (raw === 'passive_steal')
    return '被动命中访客偷取'
  return raw || '暂无'
}

function formatDateTime(value?: number) {
  const timestamp = Number(value || 0)
  if (!timestamp)
    return '--'
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  catch {
    return '--'
  }
}

async function loadRiskInsights(accountId: string) {
  if (!accountId) {
    friendRiskProfiles.value = []
    friendRiskSummary.value = { total: 0, low: 0, medium: 0, high: 0, topProfiles: [] }
    friendStealOverview.value = { totalFriends: 0, totalStealCount: 0, totalLandCount: 0, topFriends: [] }
    friendStealStats.value = []
    return
  }
  riskInsightsLoading.value = true
  try {
    const [riskSummaryRes, riskProfilesRes, stealStatsRes] = await Promise.all([
      api.get('/api/friend-risk/summary', { headers: { 'x-account-id': accountId } }),
      api.get('/api/friend-risk/profiles', { headers: { 'x-account-id': accountId }, params: { limit: 12 } }),
      api.get('/api/friend-steal-stats', { headers: { 'x-account-id': accountId }, params: { limit: 12 } }),
    ])
    friendRiskSummary.value = riskSummaryRes.data?.ok
      ? {
          total: Number(riskSummaryRes.data.data?.total || 0),
          low: Number(riskSummaryRes.data.data?.low || 0),
          medium: Number(riskSummaryRes.data.data?.medium || 0),
          high: Number(riskSummaryRes.data.data?.high || 0),
          topProfiles: Array.isArray(riskSummaryRes.data.data?.topProfiles) ? riskSummaryRes.data.data.topProfiles : [],
        }
      : { total: 0, low: 0, medium: 0, high: 0, topProfiles: [] }
    friendRiskProfiles.value = riskProfilesRes.data?.ok && Array.isArray(riskProfilesRes.data?.data)
      ? riskProfilesRes.data.data
      : []
    friendStealOverview.value = stealStatsRes.data?.ok
      ? {
          totalFriends: Number(stealStatsRes.data.data?.overview?.totalFriends || 0),
          totalStealCount: Number(stealStatsRes.data.data?.overview?.totalStealCount || 0),
          totalLandCount: Number(stealStatsRes.data.data?.overview?.totalLandCount || 0),
          topFriends: Array.isArray(stealStatsRes.data.data?.overview?.topFriends) ? stealStatsRes.data.data.overview.topFriends : [],
        }
      : { totalFriends: 0, totalStealCount: 0, totalLandCount: 0, topFriends: [] }
    friendStealStats.value = stealStatsRes.data?.ok && Array.isArray(stealStatsRes.data?.data?.list)
      ? stealStatsRes.data.data.list
      : []
    riskInsightsUpdatedAt.value = Date.now()
  }
  catch (error) {
    console.error('获取风险画像与统计失败:', error)
  }
  finally {
    riskInsightsLoading.value = false
  }
}

async function loadData() {
  const accountId = String(selectedAccount.value || '').trim()
  if (!accountId)
    return

  if (currentAccountId.value !== accountId) {
    await accountStore.setCurrentAccount({ id: accountId } as any)
  }

  avatarErrorKeys.value.clear()
  plantImageErrorKeys.value.clear()
  plantImageFallbackIndex.value = {}
  cropEntries.value = []
  liveFriends.value = []
  cachedFriends.value = []

  try {
    await settingStore.fetchSettings(accountId)
    syncLocalSettings()
  }
  catch (error) {
    console.error('获取偷菜设置失败:', error)
  }

  try {
    await friendStore.fetchCachedFriends(accountId)
    if (!cachedFriends.value.length) {
      await friendStore.fetchFriends(accountId)
    }
    else if (selectedAccountRecord.value?.running) {
      // 在线账号优先展示缓存，再后台补一轮实时好友，修正昵称/头像/openId
      void friendStore.fetchFriends(accountId)
    }
  }
  catch (error) {
    console.error('获取好友列表失败:', error)
  }

  try {
    const atlasEntries = await loadCropAtlasEntries({
      accountId,
      sort: 'level',
    })
    cropEntries.value = atlasEntries
    localSettings.value.automation.stealFilterPlantIds = normalizeCropSelectionIds(
      localSettings.value.automation.stealFilterPlantIds,
      atlasEntries,
    )
  }
  catch (error) {
    console.error('获取作物分析数据失败:', error)
  }

  await loadRiskInsights(accountId)
}

onMounted(() => {
  if (!selectedAccount.value && accounts.value.length > 0) {
    selectedAccount.value = String(accounts.value[0]?.id || accounts.value[0]?.uin || '')
  }
  loadData()
})

watch(() => accounts.value, (nextAccounts) => {
  if (!selectedAccount.value && nextAccounts.length > 0) {
    selectedAccount.value = String(nextAccounts[0]?.id || nextAccounts[0]?.uin || '')
  }
})

watch(() => selectedAccount.value, () => {
  searchQuery.value = ''
  loadData()
})

// 【修复闪烁】监听 accountId 字符串值而非 currentAccount 对象引用
watch(() => currentAccountId.value, (newId) => {
  if (newId && newId !== selectedAccount.value) {
    selectedAccount.value = newId
  }
})

// === Plants Logic ===

const filteredPlants = computed(() => {
  if (!cropEntries.value.length)
    return []
  let res = [...cropEntries.value]
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    res = res.filter(crop => String(crop?.name || '').toLowerCase().includes(q))
  }
  return res
})

function getPlantSelectionId(crop: CropAtlasEntry) {
  return Number(crop?.plantId || 0)
}

function isPlantSelected(crop: CropAtlasEntry) {
  return localSettings.value.automation.stealFilterPlantIds.includes(getPlantSelectionId(crop))
}

function togglePlant(crop: CropAtlasEntry) {
  const plantId = getPlantSelectionId(crop)
  if (!plantId)
    return
  const arr = localSettings.value.automation.stealFilterPlantIds
  const idx = arr.indexOf(plantId)
  if (idx > -1) {
    arr.splice(idx, 1)
  }
  else {
    arr.push(plantId)
  }
}

// 批量设置植物选中状态
function selectAllPlants() {
  const currentSet = new Set(localSettings.value.automation.stealFilterPlantIds)
  filteredPlants.value.forEach(crop => currentSet.add(getPlantSelectionId(crop)))
  localSettings.value.automation.stealFilterPlantIds = Array.from(currentSet)
}

function clearAllPlants() {
  const currentSet = new Set(localSettings.value.automation.stealFilterPlantIds)
  filteredPlants.value.forEach(crop => currentSet.delete(getPlantSelectionId(crop)))
  localSettings.value.automation.stealFilterPlantIds = Array.from(currentSet)
}

function invertAllPlants() {
  const currentArr = localSettings.value.automation.stealFilterPlantIds
  const filteredIds = filteredPlants.value.map(crop => getPlantSelectionId(crop))
  const newArr = currentArr.filter((id: number) => !filteredIds.includes(id))
  filteredIds.forEach((id: number) => {
    if (!currentArr.includes(id))
      newArr.push(id)
  })
  localSettings.value.automation.stealFilterPlantIds = newArr
}

// === Friends Logic ===

const filteredFriends = computed(() => {
  if (!resolvedFriends.value.length)
    return []
  let res = [...resolvedFriends.value]
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    res = res.filter((f) => {
      const keywords = [
        getFriendDisplayName(f),
        getFriendSecondaryLabel(f),
        String(f?.remark || ''),
        String(f?.nick || ''),
      ]
      return keywords.some(keyword => keyword.toLowerCase().includes(q))
    })
  }
  return res
})

function isFriendSelected(id: number) {
  return localSettings.value.automation.stealFriendFilterIds.includes(id)
}

function toggleFriend(id: number) {
  const arr = localSettings.value.automation.stealFriendFilterIds
  const idx = arr.indexOf(id)
  if (idx > -1) {
    arr.splice(idx, 1)
  }
  else {
    arr.push(id)
  }
}

function selectAllFriends() {
  const currentSet = new Set(localSettings.value.automation.stealFriendFilterIds)
  filteredFriends.value.forEach(f => currentSet.add(getFriendSelectionId(f)))
  localSettings.value.automation.stealFriendFilterIds = Array.from(currentSet)
}

function clearAllFriends() {
  const currentSet = new Set(localSettings.value.automation.stealFriendFilterIds)
  filteredFriends.value.forEach(f => currentSet.delete(getFriendSelectionId(f)))
  localSettings.value.automation.stealFriendFilterIds = Array.from(currentSet)
}

function invertAllFriends() {
  const currentArr = localSettings.value.automation.stealFriendFilterIds
  const filteredIds = filteredFriends.value.map(f => getFriendSelectionId(f))
  const newArr = currentArr.filter((id: number) => !filteredIds.includes(id))
  filteredIds.forEach((id: number) => {
    if (!currentArr.includes(id))
      newArr.push(id)
  })
  localSettings.value.automation.stealFriendFilterIds = newArr
}

function getPlantImageCandidates(crop: CropAtlasEntry) {
  const seedId = Number(crop?.seedId || 0)
  return [
    getSafeImageUrl(crop?.image || ''),
    seedId > 0 ? `https://qzonestyle.gtimg.cn/qzone/sngapp/app/appstore/app_100371286/crop/${seedId}.png` : '',
  ].filter((item, index, list) => !!item && list.indexOf(item) === index)
}

function getPlantImage(crop: CropAtlasEntry) {
  const seedId = Number(crop?.seedId || 0)
  const fallbackIndex = plantImageFallbackIndex.value[seedId] || 0
  return getPlantImageCandidates(crop)[fallbackIndex] || ''
}

function canShowPlantImage(crop: CropAtlasEntry) {
  const seedId = Number(crop?.seedId || 0)
  return !!getPlantImage(crop) && !plantImageErrorKeys.value.has(seedId)
}

function handlePlantImageError(crop: CropAtlasEntry, event: Event) {
  const seedId = Number(crop?.seedId || 0)
  if (!seedId)
    return
  const candidates = getPlantImageCandidates(crop)
  const currentIndex = plantImageFallbackIndex.value[seedId] || 0
  if (currentIndex < candidates.length - 1) {
    plantImageFallbackIndex.value = {
      ...plantImageFallbackIndex.value,
      [seedId]: currentIndex + 1,
    }
    const nextImage = candidates[currentIndex + 1]
    if (event.target instanceof HTMLImageElement && nextImage) {
      event.target.src = nextImage
      return
    }
  }
  plantImageErrorKeys.value.add(seedId)
}

// === Save Logic ===

async function saveAccountSettings() {
  if (!selectedAccount.value)
    return

  saving.value = true
  try {
    // We must merge with existing full settings so we don't wipe other automation configs
    const fullSettingsToSave = JSON.parse(JSON.stringify(settings.value))
    if (!fullSettingsToSave.automation)
      fullSettingsToSave.automation = {}

    Object.assign(fullSettingsToSave.automation, localSettings.value.automation)
    fullSettingsToSave.friendRiskConfig = sanitizeFriendRiskConfig(localSettings.value.friendRiskConfig)
    fullSettingsToSave.specialCareFriendIds = normalizeNumberList(localSettings.value.specialCareFriendIds)
    fullSettingsToSave.experimentalFeatures = {
      focusStealEnabled: !!localSettings.value.experimentalFeatures.focusStealEnabled,
    }

    const res = await settingStore.saveSettings(selectedAccount.value, fullSettingsToSave)
    if (res.ok) {
      await loadRiskInsights(String(selectedAccount.value || '').trim())
      toast.success('偷菜与风险策略配置已保存')
      showAlert('偷菜设置已成功同步至云端')
    }
    else {
      showAlert(`保存失败: ${localizeRuntimeText(res.error || '未知错误')}`, 'danger')
    }
  }
  finally {
    saving.value = false
  }
}

async function resetRiskProfile(profile: FriendRiskProfile) {
  const accountId = String(selectedAccount.value || '').trim()
  const gid = Number(profile?.friendGid || 0)
  if (!accountId || !gid)
    return
  try {
    const { data } = await api.post(`/api/friend-risk/${gid}/reset`, {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(String(data?.error || '清除失败'))
    await loadRiskInsights(accountId)
    toast.success(`已清除 ${profile.friendName} 的风险标记`)
  }
  catch (error: any) {
    console.error('清除风险标记失败:', error)
    toast.error(String(error?.response?.data?.error || error?.message || '清除风险标记失败'))
  }
}

function getStealTabClasses(active: boolean) {
  return active
    ? 'steal-tab steal-tab-active'
    : 'steal-tab steal-tab-idle'
}

function getStealBulkButtonClasses(kind: 'brand' | 'neutral' | 'danger') {
  return `steal-bulk-button steal-bulk-button-${kind}`
}

function getFriendCardClasses(selected: boolean) {
  return selected
    ? 'steal-list-card steal-friend-active'
    : 'steal-list-card steal-list-card-idle'
}

function getFriendCheckClasses(selected: boolean) {
  return selected
    ? 'steal-check-indicator steal-check-indicator-active'
    : 'steal-check-indicator steal-check-indicator-idle'
}

function getPlantCardClasses(selected: boolean) {
  return selected
    ? 'steal-plant-card steal-plant-active'
    : 'steal-plant-card steal-list-card-idle'
}

function getPlantCheckClasses(selected: boolean) {
  return selected
    ? 'steal-check-box steal-check-box-active'
    : 'steal-check-box steal-check-box-idle'
}

// Vue template usage is not always reflected in the TS unused analysis for this page.
void getStealTabClasses
void getStealBulkButtonClasses
void getFriendCardClasses
void getFriendCheckClasses
void getPlantCardClasses
void getPlantCheckClasses
</script>

<template>
  <div class="steal-settings-page ui-page-shell ui-page-density-relaxed ui-page-with-fixed-footer relative min-h-full w-full">
    <!-- Header -->
    <div class="steal-page-header mb-6 flex flex-col justify-between gap-4 pb-4 md:flex-row md:items-center">
      <div>
        <h1 class="glass-text-main flex items-center gap-2 text-2xl font-bold">
          <span class="text-primary-500 font-normal">🌱</span> 偷菜设置
        </h1>
        <p class="glass-text-muted mt-1 text-sm">
          精细化控制偷菜行为：选择哪些好友不偷、哪些作物不偷，定制专属自动化监控网。
        </p>
      </div>
      <div class="w-full shrink-0 md:w-64">
        <BaseSelect
          v-model="selectedAccount"
          :options="accounts.map(a => ({ label: String(a.name || a.nick || a.id || a.uin || ''), value: String(a.id || a.uin || '') }))"
        />
      </div>
    </div>

    <div v-if="settingsLoading" class="steal-empty-state flex flex-1 items-center justify-center py-20">
      <div class="i-svg-spinners-ring-resize text-3xl" />
    </div>

    <div v-else-if="!selectedAccount" class="steal-empty-state flex flex-1 flex-col items-center justify-center py-20">
      <div class="i-carbon-user-settings mb-4 text-4xl" />
      <p>请先在右上角选择指定账号</p>
    </div>

    <template v-else>
      <!-- 跳过白萝卜偷菜 -->
      <div class="steal-top-card glass-panel mb-3 flex flex-col items-start justify-between gap-4 p-3 sm:flex-row sm:items-center">
        <div class="flex items-center gap-2">
          <span class="glass-text-main text-sm font-medium">🥕 跳过白萝卜偷菜</span>
          <span class="glass-text-muted text-xs">开启后偷菜时自动跳过白萝卜，不偷取该作物</span>
        </div>
        <BaseSwitch v-model="localSettings.automation.skipStealRadishEnabled" size="sm" />
      </div>

      <div class="grid grid-cols-1 mb-3 gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
        <section class="steal-top-card glass-panel p-4">
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 class="glass-text-main text-base font-semibold">
                  风险打标与重点偷取策略
                </h2>
                <p class="glass-text-muted mt-1 text-sm leading-6">
                  第一阶段只做打标与评分，不做硬拦截；特别关照名单可先沉淀，实验模式开启后才会参与自动重点偷取。
                </p>
              </div>
              <div class="glass-text-muted text-xs">
                {{ riskInsightsLoading ? '正在同步风险画像...' : `最近同步 ${formatDateTime(riskInsightsUpdatedAt)}` }}
              </div>
            </div>

            <div class="grid grid-cols-1 gap-3 2xl:grid-cols-4 sm:grid-cols-2">
              <article
                v-for="card in strategySummaryCards"
                :key="card.key"
                class="border border-[var(--ui-border-subtle)] rounded-2xl bg-[color:color-mix(in_srgb,var(--ui-bg-surface-raised)_92%,transparent)] p-3"
              >
                <div class="glass-text-muted text-[11px] font-semibold tracking-[0.16em] uppercase">
                  {{ card.label }}
                </div>
                <div class="mt-2 text-lg font-semibold">
                  {{ card.value }}
                </div>
                <div class="glass-text-muted mt-1 text-xs leading-5">
                  {{ card.hint }}
                </div>
              </article>
            </div>

            <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div class="border border-[var(--ui-border-subtle)] rounded-2xl p-3">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div class="text-sm font-semibold">
                      风险识别配置
                    </div>
                    <div class="glass-text-muted mt-1 text-xs">
                      被动识别好友异常偷取行为并生成风险画像
                    </div>
                  </div>
                  <div class="flex items-center gap-4">
                    <BaseSwitch v-model="localSettings.friendRiskConfig.enabled" label="总开关" size="sm" />
                    <BaseSwitch v-model="localSettings.friendRiskConfig.passiveDetectEnabled" label="被动识别" size="sm" />
                  </div>
                </div>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <BaseInput
                    v-model="localSettings.friendRiskConfig.passiveWindowSec"
                    type="number"
                    label="施肥后观察窗口(秒)"
                    placeholder="180"
                  />
                  <BaseInput
                    v-model="localSettings.friendRiskConfig.passiveDailyThreshold"
                    type="number"
                    label="单日命中阈值"
                    placeholder="3"
                  />
                  <BaseInput
                    v-model="localSettings.friendRiskConfig.markScoreThreshold"
                    type="number"
                    label="高风险分数阈值"
                    placeholder="50"
                  />
                </div>
                <div class="mt-3 flex flex-wrap gap-4">
                  <BaseSwitch v-model="localSettings.friendRiskConfig.autoDeprioritize" label="自动降权" size="sm" />
                  <BaseInput
                    v-model="localSettings.friendRiskConfig.eventRetentionDays"
                    type="number"
                    label="事件保留天数"
                    placeholder="30"
                    class="min-w-[180px]"
                  />
                </div>
              </div>

              <div class="border border-[var(--ui-border-subtle)] rounded-2xl p-3">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div class="text-sm font-semibold">
                      实验功能
                    </div>
                    <div class="glass-text-muted mt-1 text-xs">
                      仅对特别关照名单生效，适合尝鲜验证重点偷取策略
                    </div>
                  </div>
                  <BaseSwitch v-model="localSettings.experimentalFeatures.focusStealEnabled" label="重点偷取实验开关" size="sm" />
                </div>
                <div class="border border-[var(--ui-border-subtle)] rounded-2xl border-dashed px-3 py-2">
                  <div class="text-sm font-semibold">
                    当前策略说明
                  </div>
                  <div class="glass-text-muted mt-1 text-xs leading-6">
                    {{ localSettings.experimentalFeatures.focusStealEnabled
                      ? (localSettings.specialCareFriendIds.length > 0 ? '自动偷取将优先只处理特别关照名单中的好友。' : '实验开关已开启，但特别关照名单为空，当前不会改变自动偷取行为。')
                      : '实验开关关闭时，仅记录名单，不改变现有自动偷取决策。' }}
                  </div>
                </div>
                <div class="grid grid-cols-1 mt-3 gap-2 sm:grid-cols-3">
                  <div class="border border-[var(--ui-border-subtle)] rounded-xl px-3 py-2">
                    <div class="glass-text-muted text-[11px] font-semibold tracking-[0.16em] uppercase">
                      高风险
                    </div>
                    <div class="mt-2 text-sm font-semibold">
                      {{ friendRiskSummary.high }} 人
                    </div>
                  </div>
                  <div class="border border-[var(--ui-border-subtle)] rounded-xl px-3 py-2">
                    <div class="glass-text-muted text-[11px] font-semibold tracking-[0.16em] uppercase">
                      中风险
                    </div>
                    <div class="mt-2 text-sm font-semibold">
                      {{ friendRiskSummary.medium }} 人
                    </div>
                  </div>
                  <div class="border border-[var(--ui-border-subtle)] rounded-xl px-3 py-2">
                    <div class="glass-text-muted text-[11px] font-semibold tracking-[0.16em] uppercase">
                      特别关照
                    </div>
                    <div class="mt-2 text-sm font-semibold">
                      {{ localSettings.specialCareFriendIds.length }} 人
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="steal-top-card glass-panel p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="glass-text-main text-base font-semibold">
                最近命中概览
              </h2>
              <p class="glass-text-muted mt-1 text-sm">
                这里汇总风险好友榜和偷取统计，便于后续规划自动策略。
              </p>
            </div>
            <BaseButton variant="ghost" size="sm" @click="loadRiskInsights(String(selectedAccount || ''))">
              刷新
            </BaseButton>
          </div>

          <div class="mt-4 space-y-4">
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-sm font-semibold">
                  风险好友榜
                </div>
                <div class="glass-text-muted text-xs">
                  Top {{ friendRiskProfiles.length }}
                </div>
              </div>
              <div v-if="friendRiskProfiles.length === 0" class="glass-text-muted border border-[var(--ui-border-subtle)] rounded-2xl border-dashed px-3 py-4 text-sm">
                还没有好友被标记为风险对象，继续运行后这里会出现画像数据。
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="profile in friendRiskProfiles.slice(0, 6)"
                  :key="profile.friendGid"
                  class="border border-[var(--ui-border-subtle)] rounded-2xl px-3 py-3"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="line-clamp-1 text-sm font-semibold">
                        {{ profile.friendName }}
                      </div>
                      <div class="glass-text-muted mt-1 text-xs leading-5">
                        GID {{ profile.friendGid }} · {{ formatRiskReason(profile.lastHitReason) }}
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="border rounded-full px-2 py-0.5 text-xs font-semibold" :class="getRiskToneClasses(profile.riskLevel)">
                        {{ formatRiskLevelLabel(profile.riskLevel) }}
                      </span>
                      <BaseButton variant="ghost" size="sm" @click="resetRiskProfile(profile)">
                        清除
                      </BaseButton>
                    </div>
                  </div>
                  <div class="glass-text-muted mt-2 text-xs leading-5">
                    分数 {{ profile.riskScore }} · 最近命中 {{ formatDateTime(profile.lastHitAt) }}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-sm font-semibold">
                  偷取统计 Top 榜
                </div>
                <div class="glass-text-muted text-xs">
                  命中好友 {{ friendStealOverview.totalFriends }} 人
                </div>
              </div>
              <div v-if="friendStealStats.length === 0" class="glass-text-muted border border-[var(--ui-border-subtle)] rounded-2xl border-dashed px-3 py-4 text-sm">
                还没有记录到偷取成功统计，等待自动或手动偷取后会在这里累计。
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="item in friendStealStats.slice(0, 6)"
                  :key="item.friendGid"
                  class="border border-[var(--ui-border-subtle)] rounded-2xl px-3 py-3"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="line-clamp-1 text-sm font-semibold">
                        {{ item.friendName }}
                      </div>
                      <div class="glass-text-muted mt-1 text-xs leading-5">
                        {{ item.lastPlantNames?.length ? item.lastPlantNames.join('、') : '最近未记录作物名' }}
                      </div>
                    </div>
                    <div class="text-right">
                      <div class="text-sm font-semibold">
                        {{ item.stealCount }} 次
                      </div>
                      <div class="glass-text-muted mt-1 text-xs">
                        地块 {{ item.landCount }}
                      </div>
                    </div>
                  </div>
                  <div class="glass-text-muted mt-2 text-xs leading-5">
                    最近方式 {{ item.lastMode || 'auto' }} · 最近命中 {{ formatDateTime(item.lastStealAt) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="steal-controls-panel ui-mobile-sticky-panel mb-3">
        <!-- Tabs -->
        <div class="steal-tab-bar ui-bulk-actions flex shrink-0 gap-4 overflow-x-auto">
          <button
            class="steal-tab whitespace-nowrap border-b-2 px-4 py-2 font-medium transition-colors"
            :class="getStealTabClasses(activeTab === 'friends')"
            @click="activeTab = 'friends'; searchQuery = ''"
          >
            👥 好友偷菜名单 ({{ localSettings.automation.stealFriendFilterIds.length }}/{{ resolvedFriends.length }})
          </button>
          <button
            class="steal-tab whitespace-nowrap border-b-2 px-4 py-2 font-medium transition-colors"
            :class="getStealTabClasses(activeTab === 'plants')"
            @click="activeTab = 'plants'; searchQuery = ''"
          >
            🌾 作物偷菜过滤 ({{ localSettings.automation.stealFilterPlantIds.length }}/{{ cropEntries.length }})
          </button>
        </div>

        <div class="steal-toolbar glass-panel p-3 shadow-sm">
          <div class="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div class="relative min-w-0 flex-1 xl:max-w-xl">
              <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                <div class="steal-search-icon i-carbon-search text-sm" />
              </div>
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="activeTab === 'friends' ? '搜索好友昵称/备注...' : '搜索作物名称...'"
                class="steal-search-input glass-text-main m-0 box-border block h-[36px] w-full py-1.5 pl-9 pr-3 text-sm font-medium leading-5 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
            </div>

            <div class="steal-toolbar-actions flex flex-col gap-2 xl:ml-auto xl:items-end">
              <div class="ui-bulk-actions">
                <div class="steal-toolbar-chip flex items-center gap-2 px-3 py-1.5">
                  <span class="glass-text-muted text-xs font-medium">总控:</span>
                  <BaseSwitch v-if="activeTab === 'friends'" v-model="localSettings.automation.stealFriendFilterEnabled" size="sm" />
                  <BaseSwitch v-else v-model="localSettings.automation.stealFilterEnabled" size="sm" />
                </div>

                <div class="steal-toolbar-chip flex items-center gap-2 px-2 py-1">
                  <span class="glass-text-muted text-xs font-medium">模式:</span>
                  <select
                    v-if="activeTab === 'friends'"
                    v-model="localSettings.automation.stealFriendFilterMode"
                    class="steal-inline-select glass-text-main py-1.5 pl-2 pr-6 text-xs font-medium shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="blacklist" class="steal-select-option">
                      黑名单
                    </option>
                    <option value="whitelist" class="steal-select-option">
                      白名单
                    </option>
                  </select>
                  <select
                    v-else
                    v-model="localSettings.automation.stealFilterMode"
                    class="steal-inline-select glass-text-main py-1.5 pl-2 pr-6 text-xs font-medium shadow-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="blacklist" class="steal-select-option">
                      黑名单
                    </option>
                    <option value="whitelist" class="steal-select-option">
                      白名单
                    </option>
                  </select>
                </div>
              </div>

              <div class="ui-bulk-actions xl:ml-2">
                <BaseButton
                  v-if="activeTab === 'friends'"
                  size="sm"
                  :class="getStealBulkButtonClasses('brand')"
                  @click="selectAllFriends"
                >
                  <div class="i-carbon-checkmark-outline mr-1.5 text-sm" /> 全选
                </BaseButton>
                <BaseButton
                  v-else
                  size="sm"
                  :class="getStealBulkButtonClasses('brand')"
                  @click="selectAllPlants"
                >
                  <div class="i-carbon-checkmark-outline mr-1.5 text-sm" /> 全选
                </BaseButton>

                <BaseButton
                  v-if="activeTab === 'friends'"
                  size="sm"
                  :class="getStealBulkButtonClasses('neutral')"
                  @click="invertAllFriends"
                >
                  反选
                </BaseButton>
                <BaseButton
                  v-else
                  size="sm"
                  :class="getStealBulkButtonClasses('neutral')"
                  @click="invertAllPlants"
                >
                  反选
                </BaseButton>

                <BaseButton
                  v-if="activeTab === 'friends'"
                  size="sm"
                  :class="getStealBulkButtonClasses('danger')"
                  @click="clearAllFriends"
                >
                  <div class="i-carbon-close-outline mr-1.5 text-sm" /> 清空
                </BaseButton>
                <BaseButton
                  v-else
                  size="sm"
                  :class="getStealBulkButtonClasses('danger')"
                  @click="clearAllPlants"
                >
                  <div class="i-carbon-close-outline mr-1.5 text-sm" /> 清空
                </BaseButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="steal-list-shell glass-panel min-h-[360px] p-4">
        <!-- Friends Grid -->
        <div v-if="activeTab === 'friends'" class="grid grid-cols-1 gap-3 lg:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
          <div v-if="showFriendsLoading" class="glass-text-muted col-span-full flex flex-col items-center justify-center py-20">
            <div class="i-svg-spinners-ring-resize mb-3 text-4xl text-primary-500" />
            <p>正在加载好友列表...</p>
          </div>
          <div v-else-if="filteredFriends.length === 0" class="glass-text-muted col-span-full flex flex-col items-center justify-center py-20">
            <div class="i-carbon-search mx-auto mb-3 text-5xl opacity-30" />
            <p class="text-lg">
              没有匹配的好友数据
            </p>
          </div>

          <div
            v-for="friend in filteredFriends"
            :key="getFriendSelectionId(friend)"
            class="group flex cursor-pointer select-none items-center justify-between border rounded-lg p-3 transition-all"
            :class="getFriendCardClasses(isFriendSelected(getFriendSelectionId(friend)))"
            @click="toggleFriend(getFriendSelectionId(friend))"
          >
            <div class="flex items-center gap-3 overflow-hidden">
              <div class="steal-avatar-shell relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm">
                <img
                  v-if="canShowFriendAvatar(friend)"
                  :src="getFriendAvatar(friend)"
                  class="z-10 h-full w-full object-cover"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="handleFriendAvatarError(friend)"
                >
                <div v-else class="steal-avatar-fallback i-carbon-user absolute inset-0 z-0 flex items-center justify-center text-xl" />
              </div>
              <div class="min-w-0 flex flex-col">
                <span class="glass-text-main w-full truncate text-sm font-bold" :title="getFriendDisplayName(friend)">
                  {{ getFriendDisplayName(friend) }}
                </span>
                <span class="glass-text-muted mt-0.5 text-xs font-mono" title="QQ/uId">
                  {{ getFriendSecondaryLabel(friend) }}
                </span>
                <div class="mt-1 flex flex-wrap items-center gap-1.5">
                  <span
                    v-if="getFriendRiskProfile(friend)"
                    class="border rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    :class="getRiskToneClasses(getFriendRiskProfile(friend)?.riskLevel)"
                  >
                    {{ formatRiskLevelLabel(getFriendRiskProfile(friend)?.riskLevel) }} · {{ getFriendRiskProfile(friend)?.riskScore || 0 }} 分
                  </span>
                  <span
                    v-if="isSpecialCareFriend(friend)"
                    class="border border-[color:color-mix(in_srgb,var(--ui-brand-500)_40%,var(--ui-border-subtle))] rounded-full bg-[color:color-mix(in_srgb,var(--ui-brand-500)_10%,var(--ui-bg-surface-raised))] px-2 py-0.5 text-[11px] text-[color:color-mix(in_srgb,var(--ui-brand-500)_86%,var(--ui-text-1))] font-semibold"
                  >
                    特别关照
                  </span>
                </div>
              </div>
            </div>
            <div class="flex shrink-0 flex-col items-end pl-2">
              <button
                type="button"
                class="mb-2 h-7 w-7 flex items-center justify-center border border-[var(--ui-border-subtle)] rounded-full transition-colors"
                :class="isSpecialCareFriend(friend)
                  ? 'bg-[color:color-mix(in_srgb,var(--ui-brand-500)_16%,var(--ui-bg-surface-raised))] text-primary-500'
                  : 'glass-text-muted bg-[color:color-mix(in_srgb,var(--ui-bg-surface)_66%,transparent)]'"
                :title="isSpecialCareFriend(friend) ? '移出特别关照名单' : '加入特别关照名单'"
                @click.stop="toggleSpecialCareFriend(friend)"
              >
                <div :class="isSpecialCareFriend(friend) ? 'i-carbon-star-filled' : 'i-carbon-star'" />
              </button>
              <div
                class="h-[22px] w-[22px] flex items-center justify-center rounded-full transition-colors"
                :class="getFriendCheckClasses(isFriendSelected(getFriendSelectionId(friend)))"
              >
                <div v-if="isFriendSelected(getFriendSelectionId(friend))" class="i-carbon-checkmark text-sm" />
              </div>
            </div>
          </div>
        </div>

        <!-- Plants Grid (Rich View) -->
        <div v-if="activeTab === 'plants'" class="grid grid-cols-1 gap-3 lg:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
          <div v-if="cropEntries.length === 0" class="glass-text-muted col-span-full flex flex-col items-center justify-center py-20">
            <div class="i-carbon-search mx-auto mb-3 text-5xl opacity-30" />
            <p class="text-lg">
              没有加载到作物数据
            </p>
          </div>
          <div v-else-if="filteredPlants.length === 0" class="glass-text-muted col-span-full flex flex-col items-center justify-center py-20">
            <div class="i-carbon-search mx-auto mb-3 text-5xl opacity-30" />
            <p class="text-lg">
              未搜到匹配的作物
            </p>
          </div>

          <div
            v-for="crop in filteredPlants"
            :key="crop.plantId"
            class="group flex cursor-pointer select-none items-start justify-between border rounded-xl p-3.5 transition-all"
            :class="getPlantCardClasses(isPlantSelected(crop))"
            @click="togglePlant(crop)"
          >
            <div class="min-w-0 flex flex-1 items-start gap-3">
              <div class="steal-plant-thumb relative h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden rounded-lg p-1 shadow-sm">
                <img
                  v-if="canShowPlantImage(crop)"
                  :src="getPlantImage(crop)"
                  class="z-10 max-h-full max-w-full object-contain drop-shadow-sm"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="handlePlantImageError(crop, $event)"
                >
                <div class="steal-plant-thumb-icon i-carbon-sprout absolute inset-0 z-0 flex items-center justify-center text-2xl" />
              </div>
              <div class="min-w-0 flex flex-1 flex-col">
                <div class="min-w-0 w-full flex items-center justify-between pr-1">
                  <div class="min-w-0 flex items-center gap-1.5">
                    <span class="glass-text-main truncate text-[15px] font-extrabold" :title="crop.name">
                      {{ crop.name }}
                    </span>
                    <span class="steal-level-pill ui-meta-chip--neutral shrink-0 rounded px-1.5 py-0.5 text-xs font-bold">
                      Lv {{ crop.level || '-' }}
                    </span>
                  </div>
                </div>

                <div class="mt-1.5 space-y-1.5">
                  <div class="flex items-center gap-1.5 text-xs">
                    <div class="steal-metric-pill ui-meta-chip--info whitespace-nowrap rounded-sm px-1.5 py-0.5 font-medium">
                      时经: <span class="font-bold">{{ crop.expPerHour ?? '-' }}</span>
                    </div>
                    <div class="steal-metric-pill ui-meta-chip--warning whitespace-nowrap rounded-sm px-1.5 py-0.5 font-medium">
                      时润: <span class="font-bold">{{ crop.profitPerHour ?? '-' }}</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 text-[11px] opacity-70">
                    <div class="steal-metric-text-info font-medium">
                      普时经: <span class="font-bold">{{ crop.normalFertilizerExpPerHour ?? '-' }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              class="ml-2 mt-1 h-[22px] w-[22px] flex shrink-0 items-center justify-center border rounded transition-colors"
              :class="getPlantCheckClasses(isPlantSelected(crop))"
            >
              <div v-if="isPlantSelected(crop)" class="i-carbon-checkmark text-sm" />
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Action -->
      <div class="steal-footer-bar ui-fixed-footer-bar glass-panel flex flex-col items-stretch gap-3 border-t-0 p-4 sm:flex-row sm:items-center sm:justify-end">
        <div class="steal-footer-meta min-w-0 flex items-center justify-between gap-3 sm:mr-auto sm:justify-start">
          <span class="glass-text-muted truncate text-sm font-medium">
            {{ footerSelectionSummary }}
          </span>
          <span class="glass-text-muted hidden text-sm font-medium transition-opacity sm:inline-flex" :class="saving ? 'opacity-100' : 'opacity-0'">
            正在上传修改到服务器...
          </span>
        </div>
        <BaseButton
          variant="primary"
          class="relative shadow-lg shadow-primary-500/30 !px-8 !py-2.5 !font-bold"
          :loading="saving"
          @click="saveAccountSettings"
        >
          <div class="i-carbon-save mr-2 text-lg" /> 保存过滤配置
        </BaseButton>
      </div>
    </template>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: var(--ui-scrollbar-thumb);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: var(--ui-scrollbar-thumb-hover);
}

.steal-friend-active {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-status-success) 30%, transparent);
}

.steal-plant-active {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-status-info) 30%, transparent);
}

.steal-settings-page {
  color: var(--ui-text-1);
}

.steal-settings-page
  :is(
    [class*='text-'][class*='gray-500'],
    [class*='text-'][class*='gray-400'],
    [class*='dark:text-'][class*='gray-400'],
    .glass-text-muted
  ) {
  color: var(--ui-text-2) !important;
}

.steal-page-header,
.steal-tab-bar {
  border-color: var(--ui-border-subtle) !important;
}

.steal-empty-state {
  color: var(--ui-text-2) !important;
}

.steal-top-card,
.steal-toolbar,
.steal-list-shell,
.steal-toolbar-chip {
  border: 1px solid var(--ui-border-subtle) !important;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 92%, transparent) !important;
  box-shadow: 0 18px 44px -30px var(--ui-shadow-panel) !important;
}

.steal-controls-panel {
  z-index: 12;
  display: grid;
  gap: 0.75rem;
}

.steal-tab {
  border-color: transparent !important;
}

.steal-tab-active {
  border-color: var(--ui-brand-500) !important;
  color: var(--ui-text-1) !important;
  text-shadow: 0 1px 0 color-mix(in srgb, var(--ui-text-on-brand) 22%, transparent);
}

.steal-tab-idle {
  color: color-mix(in srgb, var(--ui-text-1) 72%, var(--ui-text-3)) !important;
}

.steal-tab-idle:hover {
  color: var(--ui-text-1) !important;
}

.steal-search-icon,
.steal-avatar-fallback,
.steal-plant-thumb-icon {
  color: var(--ui-text-3) !important;
}

.steal-search-input,
.steal-inline-select {
  border: 1px solid var(--ui-border-subtle) !important;
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 96%, transparent) !important;
}

.steal-bulk-button {
  border-radius: 999px !important;
  font-weight: 700 !important;
}

.steal-bulk-button-brand {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ui-brand-500) 90%, white 10%),
    var(--ui-brand-600)
  ) !important;
  color: var(--ui-text-on-brand) !important;
}

.steal-bulk-button-neutral {
  border: 1px solid var(--ui-border-subtle) !important;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 86%, transparent) !important;
  color: var(--ui-text-1) !important;
}

.steal-bulk-button-danger {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ui-status-danger) 88%, white 12%),
    color-mix(in srgb, var(--ui-status-danger) 76%, black 24%)
  ) !important;
  color: var(--ui-text-on-brand) !important;
}

.steal-list-card,
.steal-plant-card {
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 96%, transparent) !important;
}

.steal-list-card-idle {
  border-color: var(--ui-border-subtle) !important;
}

.steal-list-card-idle:hover {
  border-color: color-mix(in srgb, var(--ui-brand-500) 24%, var(--ui-border-subtle)) !important;
}

.steal-avatar-shell,
.steal-plant-thumb {
  border: 1px solid var(--ui-border-subtle) !important;
  background: color-mix(in srgb, var(--ui-bg-surface-raised) 94%, transparent) !important;
}

.steal-check-indicator,
.steal-check-box {
  border-radius: 999px;
}

.steal-check-indicator-active,
.steal-check-box-active {
  border-color: var(--ui-brand-500) !important;
  background: var(--ui-brand-500) !important;
  color: var(--ui-text-on-brand) !important;
  box-shadow: 0 10px 24px var(--ui-shadow-panel) !important;
}

.steal-check-indicator-idle,
.steal-check-box-idle {
  border: 1px solid var(--ui-border-subtle) !important;
  background: color-mix(in srgb, var(--ui-bg-surface) 72%, transparent) !important;
}

.steal-level-pill,
.steal-metric-pill {
  display: inline-flex;
  align-items: center;
  border-width: 1px;
  border-style: solid;
  line-height: 1;
}

.steal-metric-text-info {
  color: color-mix(in srgb, var(--ui-status-info) 76%, var(--ui-text-1)) !important;
}

.steal-settings-page [class*='border-'][class*='gray-300/'],
.steal-settings-page [class*='border-'][class*='gray-300'],
.steal-settings-page [class*='border-'][class*='white/20'],
.steal-settings-page [class*='dark:border-'][class*='white/10'] {
  border-color: var(--ui-border-subtle) !important;
}

.steal-settings-page [class*='bg-'][class*='black/5'],
.steal-settings-page [class*='bg-'][class*='white/20'],
.steal-settings-page [class*='dark:bg-'][class*='black/20'],
.steal-settings-page [class*='dark:bg-'][class*='white/5'] {
  background-color: color-mix(in srgb, var(--ui-bg-surface) 62%, transparent) !important;
}

.steal-select-option {
  background: var(--ui-bg-surface) !important;
  color: var(--ui-text-1) !important;
}

.steal-toolbar-actions {
  min-width: 0;
}

.steal-footer-bar {
  border-top: 1px solid var(--glass-border);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

@media (max-width: 767px) {
  .steal-footer-bar {
    padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  }
}
</style>
