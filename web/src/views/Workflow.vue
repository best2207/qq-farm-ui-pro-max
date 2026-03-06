<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const { currentAccountId } = storeToRefs(accountStore)
const toast = useToastStore()

// ======== 类型定义 ========

interface WorkflowNode {
  id: string
  type: string
  params?: Record<string, any>
}

interface WorkflowLane {
  enabled: boolean
  minInterval: number
  maxInterval: number
  nodes: WorkflowNode[]
}

interface WorkflowConfig {
  farm: WorkflowLane
  friend: WorkflowLane
}

interface NodeTemplate {
  type: string
  label: string
  icon: string
  color: string
  bgLight: string
  bgDark: string
  borderLight: string
  borderDark: string
  textLight: string
  textDark: string
  category: 'farm' | 'friend' | 'common'
  hasParams: boolean
  defaultParams?: Record<string, any>
}

// ======== 节点模板库 ========

const NODE_TEMPLATES: NodeTemplate[] = [
  // Farm Specific
  { type: 'stage_fertilize', label: '阶段施肥', icon: '🧪', color: '#4f46e5', bgLight: 'bg-indigo-50', bgDark: 'dark:bg-indigo-950/30', borderLight: 'border-indigo-200', borderDark: 'dark:border-indigo-800', textLight: 'text-indigo-700', textDark: 'dark:text-indigo-400', category: 'farm', hasParams: true, defaultParams: { mode: 'normal', phases: ['seed', 'sprout', 'leaf'] } },
  { type: 'wait_mature', label: '等待成熟', icon: '⏳', color: '#ef4444', bgLight: 'bg-red-50', bgDark: 'dark:bg-red-950/30', borderLight: 'border-red-200', borderDark: 'dark:border-red-800', textLight: 'text-red-700', textDark: 'dark:text-red-400', category: 'farm', hasParams: true, defaultParams: { stopIfNotMature: true } },
  { type: 'harvest', label: '收获', icon: '🌾', color: '#f59e0b', bgLight: 'bg-amber-50', bgDark: 'dark:bg-amber-950/30', borderLight: 'border-amber-200', borderDark: 'dark:border-amber-800', textLight: 'text-amber-700', textDark: 'dark:text-amber-400', category: 'farm', hasParams: false },
  { type: 'remove_dead', label: '铲除', icon: '💀', color: '#6b7280', bgLight: 'bg-gray-50', bgDark: 'dark:bg-gray-800/50', borderLight: 'border-gray-200', borderDark: 'dark:border-gray-700', textLight: 'text-gray-700', textDark: 'dark:text-gray-400', category: 'farm', hasParams: false },
  { type: 'select_seed', label: '选种', icon: '🌱', color: '#059669', bgLight: 'bg-emerald-50', bgDark: 'dark:bg-emerald-950/30', borderLight: 'border-emerald-200', borderDark: 'dark:border-emerald-800', textLight: 'text-emerald-700', textDark: 'dark:text-emerald-400', category: 'farm', hasParams: true, defaultParams: { strategy: 'preferred' } },
  { type: 'plant', label: '种植', icon: '🌱', color: '#059669', bgLight: 'bg-emerald-50', bgDark: 'dark:bg-emerald-950/30', borderLight: 'border-emerald-200', borderDark: 'dark:border-emerald-800', textLight: 'text-emerald-700', textDark: 'dark:text-emerald-400', category: 'farm', hasParams: false },
  { type: 'fertilize', label: '施肥', icon: '🧪', color: '#8b5cf6', bgLight: 'bg-purple-50', bgDark: 'dark:bg-purple-950/30', borderLight: 'border-purple-200', borderDark: 'dark:border-purple-800', textLight: 'text-purple-700', textDark: 'dark:text-purple-400', category: 'farm', hasParams: true, defaultParams: { mode: 'normal' } },

  // Friend Specific
  { type: 'steal', label: '偷菜', icon: '🤏', color: '#f97316', bgLight: 'bg-orange-50', bgDark: 'dark:bg-orange-950/30', borderLight: 'border-orange-200', borderDark: 'dark:border-orange-800', textLight: 'text-orange-700', textDark: 'dark:text-orange-400', category: 'friend', hasParams: false },
  { type: 'put_bug', label: '放虫', icon: '😈', color: '#ef4444', bgLight: 'bg-red-50', bgDark: 'dark:bg-red-950/30', borderLight: 'border-red-200', borderDark: 'dark:border-red-800', textLight: 'text-red-700', textDark: 'dark:text-red-400', category: 'friend', hasParams: false },
  { type: 'put_weed', label: '放草', icon: '🌿', color: '#059669', bgLight: 'bg-emerald-50', bgDark: 'dark:bg-emerald-950/30', borderLight: 'border-emerald-200', borderDark: 'dark:border-emerald-800', textLight: 'text-emerald-700', textDark: 'dark:text-emerald-400', category: 'friend', hasParams: false },

  // Common
  { type: 'weed', label: '除草', icon: '✂️', color: '#10b981', bgLight: 'bg-green-50', bgDark: 'dark:bg-green-950/30', borderLight: 'border-green-200', borderDark: 'dark:border-green-800', textLight: 'text-green-700', textDark: 'dark:text-green-400', category: 'common', hasParams: false },
  { type: 'bug', label: '除虫', icon: '🐛', color: '#f43f5e', bgLight: 'bg-rose-50', bgDark: 'dark:bg-rose-950/30', borderLight: 'border-rose-200', borderDark: 'dark:border-rose-800', textLight: 'text-rose-700', textDark: 'dark:text-rose-400', category: 'common', hasParams: false },
  { type: 'water', label: '浇水', icon: '💧', color: '#0ea5e9', bgLight: 'bg-sky-50', bgDark: 'dark:bg-sky-950/30', borderLight: 'border-sky-200', borderDark: 'dark:border-sky-800', textLight: 'text-sky-700', textDark: 'dark:text-sky-400', category: 'common', hasParams: false },
  { type: 'delay', label: '延迟', icon: '⏱️', color: '#64748b', bgLight: 'bg-slate-50', bgDark: 'dark:bg-slate-800/50', borderLight: 'border-slate-200', borderDark: 'dark:border-slate-700', textLight: 'text-slate-700', textDark: 'dark:text-slate-400', category: 'common', hasParams: true, defaultParams: { sec: 5 } },
]

function getTemplate(type: string): NodeTemplate | undefined {
  return NODE_TEMPLATES.find(t => t.type === type)
}

function generateId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const farmTemplates = computed(() => NODE_TEMPLATES.filter(t => t.category === 'farm' || t.category === 'common'))
const friendTemplates = computed(() => NODE_TEMPLATES.filter(t => t.category === 'friend' || t.category === 'common'))

// ======== 响应式状态 ========

const loading = ref(false)
const saving = ref(false)

const config = ref<WorkflowConfig>({
  farm: { enabled: false, minInterval: 30, maxInterval: 120, nodes: [] },
  friend: { enabled: false, minInterval: 60, maxInterval: 300, nodes: [] },
})

const lastSavedConfig = ref<string>('')

const hasFarmChanges = computed(() => JSON.stringify(config.value.farm) !== JSON.parse(lastSavedConfig.value || '{}')?.farm)
const hasFriendChanges = computed(() => JSON.stringify(config.value.friend) !== JSON.parse(lastSavedConfig.value || '{}')?.friend)

const editingNodeId = ref<string | null>(null)
const editingScope = ref<'farm' | 'friend' | null>(null)

const activeNode = computed(() => {
  if (!editingScope.value || !editingNodeId.value)
    return null
  return config.value[editingScope.value].nodes.find(n => n.id === editingNodeId.value) || null
})

// ======== 拖拽物理引擎 (横向 X轴) ========

interface SpringState {
  x: number
  y: number
  vx: number
  vy: number
  targetX: number
  targetY: number
}

const STIFFNESS = 300
const DAMPING = 22
const MASS = 1
const SETTLE_THRESHOLD = 0.5
const DRAG_THRESHOLD_PX = 8

const isDragging = ref(false)
const dragScope = ref<'farm' | 'friend' | null>(null)
const dragSource = ref<'pool' | 'queue'>('queue')
const dragIndex = ref(-1)
const dragNodeType = ref('')

const dropPlaceholderIndex = ref(-1)

const ghostEl = ref<HTMLElement | null>(null)
const ghostSpring = ref<SpringState>({ x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0 })

let animFrameId = 0
let lastTime = 0
let pointerDownStart = { x: 0, y: 0 }
let dragHoldTimer: ReturnType<typeof setTimeout> | null = null

// 轨道容器引用
const farmTrackRef = ref<HTMLElement | null>(null)
const friendTrackRef = ref<HTMLElement | null>(null)

function springTick(s: SpringState, dt: number): boolean {
  const ax = (-STIFFNESS * (s.x - s.targetX) - DAMPING * s.vx) / MASS
  const ay = (-STIFFNESS * (s.y - s.targetY) - DAMPING * s.vy) / MASS
  s.vx += ax * dt
  s.vy += ay * dt
  s.x += s.vx * dt
  s.y += s.vy * dt
  return Math.abs(s.x - s.targetX) > SETTLE_THRESHOLD
    || Math.abs(s.y - s.targetY) > SETTLE_THRESHOLD
    || Math.abs(s.vx) > SETTLE_THRESHOLD
    || Math.abs(s.vy) > SETTLE_THRESHOLD
}

function animateLoop(time: number) {
  const dt = Math.min((time - lastTime) / 1000, 0.05)
  lastTime = time

  let needsContinue = false

  if (isDragging.value && ghostEl.value) {
    if (springTick(ghostSpring.value, dt))
      needsContinue = true

    // 如果拖出轨道，样式变红提示删除
    const trackRef = dragScope.value === 'farm' ? farmTrackRef.value : friendTrackRef.value
    let isOutside = true
    if (trackRef) {
      const tr = trackRef.getBoundingClientRect()
      if (ghostSpring.value.targetX + ghostEl.value.offsetWidth / 2 >= tr.left
        && ghostSpring.value.targetX - ghostEl.value.offsetWidth / 2 <= tr.right
        && ghostSpring.value.targetY + ghostEl.value.offsetHeight / 2 >= tr.top
        && ghostSpring.value.targetY - ghostEl.value.offsetHeight / 2 <= tr.bottom) {
        isOutside = false
      }
    }

    if (dragSource.value === 'queue' && isOutside) {
      ghostEl.value.style.borderColor = '#ef4444' // red-500
      ghostEl.value.style.background = 'rgba(239, 68, 68, 0.1)'
      ghostEl.value.style.opacity = '0.8'
    }
    else {
      ghostEl.value.style.borderColor = ''
      ghostEl.value.style.background = ''
      ghostEl.value.style.opacity = '1'
    }

    ghostEl.value.style.transform = `translate3d(${ghostSpring.value.x}px, ${ghostSpring.value.y}px, 0) scale(1.05) rotate(${ghostSpring.value.vx * 0.005}deg)`
  }

  if (needsContinue || isDragging.value) {
    animFrameId = requestAnimationFrame(animateLoop)
  }
}

function initDrag(e: PointerEvent, template: NodeTemplate, _scope: 'farm' | 'friend') {
  if (ghostEl.value)
    ghostEl.value.remove()

  const el = document.createElement('div')
  el.className = `fixed z-[9999] pointer-events-none px-5 py-2.5 border-2 rounded-full font-bold shadow-xl flex items-center gap-2.5 whitespace-nowrap bg-gray-900/90 text-white backdrop-blur-md text-base`
  el.style.borderColor = template.color
  el.innerHTML = `<span>${template.icon}</span><span>${template.label}</span>`

  document.body.appendChild(el)
  ghostEl.value = el

  const rect = el.getBoundingClientRect()
  const startX = e.clientX - rect.width / 2
  const startY = e.clientY - rect.height / 2
  ghostSpring.value = { x: startX, y: startY, vx: 0, vy: 0, targetX: startX, targetY: startY }
  el.style.transform = `translate3d(${startX}px, ${startY}px, 0) scale(1.05)`

  lastTime = performance.now()
  animFrameId = requestAnimationFrame(animateLoop)

  // Add auto-scroll
  document.addEventListener('pointermove', handleAutoScroll)
}

// 自动滚动支持 (当拖到边缘时)
function handleAutoScroll(e: PointerEvent) {
  if (!isDragging.value || !dragScope.value)
    return
  const track = dragScope.value === 'farm' ? farmTrackRef.value : friendTrackRef.value
  if (!track)
    return

  const rect = track.getBoundingClientRect()
  const scrollZone = 50

  // 仅在 Y 轴大致对齐时才自动横向滚动轨道
  if (e.clientY > rect.top - 50 && e.clientY < rect.bottom + 50) {
    if (e.clientX < rect.left + scrollZone) {
      track.scrollLeft -= 10
    }
    else if (e.clientX > rect.right - scrollZone) {
      track.scrollLeft += 10
    }
  }
}

function handlePointerDownPool(e: PointerEvent, scope: 'farm' | 'friend', template: NodeTemplate) {
  e.preventDefault()

  pointerDownStart = { x: e.clientX, y: e.clientY }

  const activateDrag = () => {
    dragScope.value = scope
    dragSource.value = 'pool'
    dragNodeType.value = template.type
    isDragging.value = true
    dragIndex.value = -1
    dropPlaceholderIndex.value = config.value[scope].nodes.length
    initDrag(e, template, scope)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUpPool)
  }

  // Click vs Drag logic
  const moveToleration = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - pointerDownStart.x, ev.clientY - pointerDownStart.y) > DRAG_THRESHOLD_PX) {
      if (dragHoldTimer)
        clearTimeout(dragHoldTimer)
      document.removeEventListener('pointermove', moveToleration)
      document.removeEventListener('pointerup', cancelEarly)
      activateDrag()
      onPointerMove(ev) // process the first move
    }
  }

  function cancelEarly() {
    if (dragHoldTimer) {
      clearTimeout(dragHoldTimer)
    }
    document.removeEventListener('pointermove', moveToleration)
    document.removeEventListener('pointerup', cancelEarly)
    // It was a click!
    addNode(scope, template)
  }

  document.addEventListener('pointermove', moveToleration)
  document.addEventListener('pointerup', cancelEarly)

  // Mobile long press -> drag
  dragHoldTimer = setTimeout(() => {
    document.removeEventListener('pointermove', moveToleration)
    document.removeEventListener('pointerup', cancelEarly)
    activateDrag()
  }, 200)
}

function handlePointerDownQueue(e: PointerEvent, scope: 'farm' | 'friend', index: number) {
  // If clicking on actions or anything, ignore
  const target = e.target as HTMLElement
  if (target.closest('button') || target.tagName === 'INPUT')
    return

  e.preventDefault()
  const node = config.value[scope].nodes[index]
  if (!node)
    return
  const template = getTemplate(node.type)
  if (!template)
    return

  pointerDownStart = { x: e.clientX, y: e.clientY }

  const activateDrag = () => {
    dragScope.value = scope
    dragSource.value = 'queue'
    dragNodeType.value = node.type
    isDragging.value = true
    dragIndex.value = index
    dropPlaceholderIndex.value = index

    editingNodeId.value = null // hide editor while dragging

    initDrag(e, template, scope)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUpQueue)
  }

  const moveToleration = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - pointerDownStart.x, ev.clientY - pointerDownStart.y) > DRAG_THRESHOLD_PX) {
      if (dragHoldTimer)
        clearTimeout(dragHoldTimer)
      document.removeEventListener('pointermove', moveToleration)
      document.removeEventListener('pointerup', cancelEarly)
      activateDrag()
      onPointerMove(ev)
    }
  }

  function cancelEarly() {
    if (dragHoldTimer) {
      clearTimeout(dragHoldTimer)
    }
    document.removeEventListener('pointermove', moveToleration)
    document.removeEventListener('pointerup', cancelEarly)
    // Click logic: open editor
    if (template?.hasParams && node) {
      if (editingNodeId.value === node.id) {
        editingNodeId.value = null
      }
      else {
        editingNodeId.value = node.id
        editingScope.value = scope
      }
    }
  }

  document.addEventListener('pointermove', moveToleration)
  document.addEventListener('pointerup', cancelEarly)

  dragHoldTimer = setTimeout(() => {
    document.removeEventListener('pointermove', moveToleration)
    document.removeEventListener('pointerup', cancelEarly)
    activateDrag()
  }, 200)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value || !ghostEl.value)
    return

  const rect = ghostEl.value.getBoundingClientRect()
  ghostSpring.value.targetX = e.clientX - rect.width / 2
  ghostSpring.value.targetY = e.clientY - rect.height / 2

  const trackRef = dragScope.value === 'farm' ? farmTrackRef.value : friendTrackRef.value
  if (!trackRef)
    return

  const tRect = trackRef.getBoundingClientRect()
  const items = Array.from(trackRef.querySelectorAll('.wf-node-track-item'))
  let newPlaceholder = config.value[dragScope.value!].nodes.length

  // Only calc if inside track bounds (allow a little slack vertically)
  if (e.clientX >= tRect.left - 50 && e.clientX <= tRect.right + 50
    && e.clientY >= tRect.top - 50 && e.clientY <= tRect.bottom + 50) {
    // Find index based on X coordinate
    // The items are horizontal
    for (let i = 0; i < items.length; i++) {
      const iRect = items[i]?.getBoundingClientRect()
      if (!iRect)
        continue
      const midX = iRect.left + iRect.width / 2
      if (e.clientX < midX) {
        newPlaceholder = i
        break
      }
    }
  }
  else {
    // Left the track
    newPlaceholder = -1
  }

  dropPlaceholderIndex.value = newPlaceholder
}

function cleanupDrag() {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointermove', handleAutoScroll)

  isDragging.value = false
  dragIndex.value = -1
  dropPlaceholderIndex.value = -1
  dragNodeType.value = ''
  dragScope.value = null

  if (ghostEl.value) {
    ghostEl.value.remove()
    ghostEl.value = null
  }

  if (animFrameId) {
    cancelAnimationFrame(animFrameId)
    animFrameId = 0
  }
}

function onPointerUpPool(_e: PointerEvent) {
  document.removeEventListener('pointerup', onPointerUpPool)

  const scope = dragScope.value
  if (!scope) {
    cleanupDrag()
    return
  }

  const nodes = config.value[scope].nodes
  const phIdx = dropPlaceholderIndex.value

  // Dropped inside track
  if (phIdx >= 0) {
    const template = getTemplate(dragNodeType.value)
    if (template) {
      nodes.splice(phIdx, 0, {
        id: generateId(),
        type: template.type,
        ...(template.hasParams ? { params: JSON.parse(JSON.stringify(template.defaultParams || {})) } : {}),
      })
    }
  }

  cleanupDrag()
}

function onPointerUpQueue(_e: PointerEvent) {
  document.removeEventListener('pointerup', onPointerUpQueue)
  const scope = dragScope.value
  if (!scope) {
    cleanupDrag()
    return
  }

  const nodes = config.value[scope].nodes
  const phIdx = dropPlaceholderIndex.value

  if (phIdx < 0) {
    // Delete
    nodes.splice(dragIndex.value, 1)
  }
  else {
    // Reorder
    if (phIdx !== dragIndex.value && phIdx !== dragIndex.value + 1) {
      const moved = nodes.splice(dragIndex.value, 1)[0]
      if (moved) {
        // Because we removed an item, if we mapped to an index after our old position,
        // it shifts by 1.
        const insertAt = phIdx > dragIndex.value ? phIdx - 1 : phIdx
        nodes.splice(insertAt, 0, moved)
      }
    }
  }

  cleanupDrag()
}

// ======== 操作 ========
function addNode(scope: 'farm' | 'friend', template: NodeTemplate) {
  config.value[scope].nodes.push({
    id: generateId(),
    type: template.type,
    ...(template.hasParams ? { params: JSON.parse(JSON.stringify(template.defaultParams || {})) } : {}),
  })
}

function removeNode(scope: 'farm' | 'friend', index: number) {
  config.value[scope].nodes.splice(index, 1)
  editingNodeId.value = null
}

// ======== 数据交互 ========

async function loadData() {
  if (!currentAccountId.value)
    return
  loading.value = true
  try {
    const { data } = await api.get('/api/settings', {
      headers: { 'x-account-id': currentAccountId.value },
    })
    if (data?.ok && data.data?.workflowConfig) {
      const wc = data.data.workflowConfig
      config.value = {
        farm: {
          enabled: !!wc.farm?.enabled,
          minInterval: wc.farm?.minInterval || 30,
          maxInterval: wc.farm?.maxInterval || 120,
          nodes: Array.isArray(wc.farm?.nodes) ? wc.farm.nodes : [],
        },
        friend: {
          enabled: !!wc.friend?.enabled,
          minInterval: wc.friend?.minInterval || 60,
          maxInterval: wc.friend?.maxInterval || 300,
          nodes: Array.isArray(wc.friend?.nodes) ? wc.friend.nodes : [],
        },
      }
      lastSavedConfig.value = JSON.stringify(config.value)
    }
  }
  catch (e) {
    console.error('Failed to load workflow config', e)
  }
  finally {
    loading.value = false
  }
}

async function saveConfigData(scope: 'farm' | 'friend') {
  if (!currentAccountId.value)
    return

  // 静态编译期拦截：农场一旦启用编排，必须明确知道自己没有配置施肥可能会导致停滞
  if (scope === 'farm' && config.value.farm.enabled) {
    const hasFertilizeNode = config.value.farm.nodes.some(n => n.type === 'stage_fertilize' || n.type === 'fertilize')
    if (!hasFertilizeNode) {
      // confirm
      if (!window.window.confirm('【警告】您的农场流程中没有包含“阶段施肥”或“普通施肥”节点。\n在流程编排模式下，系统将完全依靠编排节点执行。缺少施肥节点可能导致植物长期处于某阶段不成长。\n\n是否确认无化肥直接保存？')) {
        return
      }
    }
  }

  saving.value = true

  // To avoid overwriting the other scope if it was changed by another client, we should merge.
  // But for simplicity of this component, we save the whole config state.
  try {
    const res = await api.post('/api/settings/save', { workflowConfig: config.value }, {
      headers: { 'x-account-id': currentAccountId.value },
    })
    if (res.data?.ok) {
      toast.success(`${scope === 'farm' ? '农场' : '好友'}流程保存成功`)
      lastSavedConfig.value = JSON.stringify(config.value)
      editingNodeId.value = null
    }
    else {
      toast.error(`保存失败: ${res.data?.error}`)
    }
  }
  catch {
    toast.error('保存请求异常')
  }
  finally {
    saving.value = false
  }
}

function resetDefault(scope: 'farm' | 'friend') {
  if (scope === 'farm') {
    config.value.farm.nodes = [
      { id: generateId(), type: 'stage_fertilize', params: { mode: 'normal', phases: ['seed', 'sprout', 'leaf', 'flower'] } },
      { id: generateId(), type: 'weed' },
      { id: generateId(), type: 'bug' },
      { id: generateId(), type: 'water' },
      { id: generateId(), type: 'wait_mature', params: { stopIfNotMature: true } },
      { id: generateId(), type: 'harvest' },
      { id: generateId(), type: 'delay', params: { sec: 5 } },
      { id: generateId(), type: 'remove_dead' },
      { id: generateId(), type: 'delay', params: { sec: 2 } },
      { id: generateId(), type: 'select_seed', params: { strategy: 'preferred' } },
      { id: generateId(), type: 'plant' },
      { id: generateId(), type: 'fertilize', params: { mode: 'normal' } },
    ]
  }
  else {
    config.value.friend.nodes = [
      { id: generateId(), type: 'weed' },
      { id: generateId(), type: 'bug' },
      { id: generateId(), type: 'water' },
      { id: generateId(), type: 'steal' },
      { id: generateId(), type: 'put_bug' },
      { id: generateId(), type: 'put_weed' },
    ]
  }
}

onMounted(() => {
  loadData()
})

// 【修复闪烁】监听 accountId 字符串值而非 currentAccount 对象引用
watch(() => currentAccountId.value, () => {
  loadData()
})
</script>

<template>
  <div class="min-h-screen p-4 pb-28 space-y-6 md:p-6">
    <!-- Header -->
    <div class="flex flex-col justify-between gap-4 border-b border-gray-100/50 pb-4 md:flex-row md:items-center dark:border-gray-700/50">
      <div>
        <h1 class="glass-text-main flex items-center gap-2 text-2xl font-bold">
          <span class="text-primary-500 font-normal">🚀</span> 策略流程编排
        </h1>
        <p class="glass-text-muted mt-1 text-sm">
          通过水平拖拽节点组织自动化流水线，高级弹簧交互，随心所欲定制策略。
        </p>
      </div>
      <div>
        <BaseButton variant="outline" size="sm" :loading="loading" @click="loadData">
          刷新配置
        </BaseButton>
      </div>
    </div>

    <div v-if="!currentAccountId" class="flex flex-1 flex-col items-center justify-center py-20 text-gray-400">
      <div class="i-carbon-user-settings mb-4 text-4xl" />
      <p>请先在右上角选择指定账号</p>
    </div>

    <template v-else>
      <!-- ================= 农场流程 ================= -->
      <div class="glass-panel overflow-hidden border border-white/20 rounded-xl shadow-sm dark:border-white/10 dark:bg-black/20">
        <!-- Title Bar -->
        <div class="flex flex-wrap items-center justify-between border-b border-gray-200/50 bg-black/5 p-4 dark:border-gray-700/50 dark:bg-white/5">
          <div class="flex items-center gap-3">
            <h2 class="glass-text-main flex items-center gap-2 text-base font-bold">
              <span>🚜</span> 农场流程编排
            </h2>
            <span
              class="rounded px-2 py-0.5 text-xs font-bold transition-colors"
              :class="config.farm.enabled ? 'bg-primary-500/20 text-primary-600 dark:text-primary-400' : 'bg-gray-200/50 text-gray-500 dark:bg-gray-700/50'"
            >
              {{ config.farm.enabled ? '已启用' : '未启用' }}
            </span>
          </div>
          <BaseSwitch v-model="config.farm.enabled" label="启用流程模式" />
        </div>

        <div class="p-4 space-y-4">
          <!-- Description & Interval -->
          <div class="text-xs text-gray-500 dark:text-gray-400">
            启用后，巡田时按以下流程执行，未启用时使用传统模式。可拖拽节点调整顺序。
            推荐顺序: 阶段施肥 -> 等待成熟 -> 收获/铲除/种植
          </div>

          <div class="grid grid-cols-2 gap-4 rounded-lg bg-black/5 p-3 md:w-1/2 dark:bg-white/5">
            <div class="space-y-1">
              <label class="text-xs text-gray-500 font-bold">最小间隔 (秒)</label>
              <input
                v-model.number="config.farm.minInterval" type="number" min="1"
                class="glass-panel w-full border border-white/20 rounded bg-transparent px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
            </div>
            <div class="space-y-1">
              <label class="text-xs text-gray-500 font-bold">最大间隔 (秒)</label>
              <input
                v-model.number="config.farm.maxInterval" type="number" min="1"
                class="glass-panel w-full border border-white/20 rounded bg-transparent px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
            </div>
          </div>

          <!-- Status Bar -->
          <div
            class="flex items-center justify-between border border-transparent rounded bg-black/5 px-3 py-2 text-xs transition-colors dark:bg-white/5"
            :class="{ 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400': hasFarmChanges, 'border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400': !hasFarmChanges }"
          >
            <div class="font-bold font-mono">
              {{ hasFarmChanges ? '农场流程有未保存改动' : '农场流程已就绪 (未保存改动)' }}
            </div>
            <div class="opacity-70">
              {{ hasFarmChanges ? '等待保存' : '最后保存: 未知' }}
            </div>
          </div>

          <!-- THE TRACK -->
          <div
            ref="farmTrackRef"
            class="custom-scrollbar relative flex select-none items-center overflow-x-auto overflow-y-hidden border-y border-gray-200 border-dashed p-3 transition-colors dark:border-gray-800 sm:py-6"
            :class="{ 'bg-primary-500/5 border-primary-500/30': isDragging && dragScope === 'farm' }"
          >
            <div v-if="config.farm.nodes.length === 0" class="pointer-events-none py-4 pl-2 text-sm text-gray-400 italic">
              拖拽底部节点到这里，或者直接点击下方节点...
            </div>

            <TransitionGroup name="wf-horizontal" class="flex items-center">
              <template v-for="(node, idx) in config.farm.nodes" :key="node.id">
                <div
                  v-if="isDragging && dragScope === 'farm' && dropPlaceholderIndex === idx"
                  class="wf-ph mx-2 h-[36px] w-[80px] shrink-0 border-2 border-primary-500/50 rounded-full border-dashed bg-primary-500/10 transition-all"
                />

                <template v-if="!(isDragging && dragSource === 'queue' && dragScope === 'farm' && dragIndex === idx)">
                  <!-- Arrow between nodes -->
                  <div v-if="idx > 0 || (isDragging && dragScope === 'farm' && dropPlaceholderIndex === 0)" class="i-carbon-arrow-right wf-arrow mx-1 shrink-0 text-gray-300 dark:text-gray-600" />

                  <!-- Node Chip -->
                  <div
                    class="group wf-node-track-item relative shrink-0 cursor-grab transition-transform hover:scale-105 active:cursor-grabbing hover:-translate-y-1"
                    @pointerdown="(e) => handlePointerDownQueue(e, 'farm', idx)"
                  >
                    <div
                      class="flex items-center gap-2 border rounded-full px-4 py-2 text-base font-bold shadow-sm transition-colors"
                      :class="[
                        getTemplate(node.type)?.bgLight, getTemplate(node.type)?.bgDark,
                        getTemplate(node.type)?.borderLight, getTemplate(node.type)?.borderDark,
                        getTemplate(node.type)?.textLight, getTemplate(node.type)?.textDark,
                        editingNodeId === node.id ? 'ring-2 ring-primary-500 shadow-md' : 'hover:shadow',
                      ]"
                    >
                      <span>{{ getTemplate(node.type)?.icon }}</span>
                      <span>{{ getTemplate(node.type)?.label }}</span>
                      <!-- Preview parameters if any -->
                      <span v-if="node.type === 'wait_mature' && node.params?.stopIfNotMature" class="ml-1.5 border-l border-current pl-1.5 text-xs font-normal opacity-75">(未成熟停止)</span>
                      <span v-if="node.type === 'stage_fertilize' && node.params" class="ml-1.5 border-l border-current pl-1.5 text-xs font-normal opacity-75">({{ node.params.phases?.length || 0 }}阶段)</span>
                    </div>

                    <!-- Delete button overlay map (visible on hover) -->
                    <button
                      class="absolute z-10 h-5 w-5 flex items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-sm transition-opacity -right-2 -top-2 hover:bg-red-600 group-hover:opacity-100"
                      @pointerdown.stop
                      @click="removeNode('farm', idx)"
                    >
                      <div class="i-carbon-close text-xs" />
                    </button>
                    <!-- Settings button if params -->
                    <button
                      v-if="getTemplate(node.type)?.hasParams"
                      class="absolute z-10 h-5 w-5 flex items-center justify-center rounded-full bg-blue-500 text-white opacity-0 shadow-sm transition-opacity -bottom-2 -right-2 hover:bg-blue-600 group-hover:opacity-100"
                      @pointerdown.stop
                      @click="editingNodeId = editingNodeId === node.id ? null : node.id; editingScope = 'farm'"
                    >
                      <div class="i-carbon-settings text-[10px]" />
                    </button>
                  </div>
                </template>
              </template>

              <!-- End placeholder -->
              <div
                v-if="isDragging && dragScope === 'farm' && dropPlaceholderIndex === config.farm.nodes.length" key="ph-end"
                class="wf-ph mx-2 h-[36px] w-[80px] shrink-0 border-2 border-primary-500/50 rounded-full border-dashed bg-primary-500/10 transition-all"
              />
            </TransitionGroup>
          </div>

          <!-- Inline Editor -->
          <div v-if="editingScope === 'farm' && editingNodeId && activeNode" class="animate-in fade-in slide-in-from-top-2 relative border border-primary-500/20 rounded-lg bg-black/5 p-4 dark:bg-white/5">
            <button class="absolute right-3 top-3 text-gray-400 hover:text-gray-600" @click="editingNodeId = null">
              <div class="i-carbon-close text-lg" />
            </button>
            <h3 class="mb-3 flex items-center gap-2 text-sm text-primary-600 font-bold dark:text-primary-400">
              <div class="i-carbon-edit" />
              编辑节点: {{ getTemplate(activeNode.type)?.label }}
            </h3>

            <div v-if="activeNode.params" class="space-y-4">
              <template v-if="activeNode.type === 'wait_mature'">
                <BaseSwitch v-model="activeNode.params.stopIfNotMature" label="若所有作物未成熟，中止后续流程" />
              </template>

              <template v-if="activeNode.type === 'stage_fertilize'">
                <div>
                  <label class="mb-1 block text-xs text-gray-500 font-bold">阶段施肥模式</label>
                  <select v-model="activeNode.params.mode" class="glass-panel max-w-[240px] w-full border border-white/20 rounded px-3 py-1.5 text-sm text-gray-700 outline-none dark:text-gray-200 focus:ring-2 focus:ring-primary-500/50">
                    <option value="normal" class="bg-white dark:bg-gray-800">
                      仅普通化肥
                    </option>
                    <option value="organic" class="bg-white dark:bg-gray-800">
                      仅有机化肥
                    </option>
                    <option value="both" class="bg-white dark:bg-gray-800">
                      双效(普通+有机)
                    </option>
                  </select>
                </div>
                <div>
                  <label class="mb-2 block text-xs text-gray-500 font-bold">选择执行施肥的作物阶段</label>
                  <div class="flex flex-wrap gap-3">
                    <label v-for="ph in [{ v: 'seed', l: '种子期' }, { v: 'sprout', l: '发芽期' }, { v: 'leaf', l: '小叶期' }, { v: 'big_leaf', l: '大叶期' }, { v: 'flower', l: '开花期' }]" :key="ph.v" class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                      <input v-model="activeNode.params.phases" type="checkbox" :value="ph.v" class="h-4 w-4 rounded accent-primary-500">
                      {{ ph.l }}
                    </label>
                  </div>
                </div>
              </template>

              <template v-if="activeNode.type === 'delay'">
                <div class="max-w-[240px] w-full">
                  <BaseInput v-model.number="activeNode.params.sec" type="number" min="1" label="延时时间(秒)" />
                </div>
              </template>

              <template v-if="activeNode.type === 'select_seed'">
                <div class="max-w-[240px] w-full">
                  <label class="mb-1 block text-xs text-gray-500 font-bold">选种策略</label>
                  <select v-model="activeNode.params.strategy" class="glass-panel w-full border border-white/20 rounded px-3 py-1.5 text-sm text-gray-700 outline-none dark:text-gray-200 focus:ring-2 focus:ring-primary-500/50">
                    <option value="preferred" class="bg-white dark:bg-gray-800">
                      设置项中优先选择
                    </option>
                    <option value="max_profit" class="bg-white dark:bg-gray-800">
                      理论时润最高
                    </option>
                    <option value="max_exp" class="bg-white dark:bg-gray-800">
                      理论时经最高
                    </option>
                  </select>
                </div>
              </template>
            </div>
          </div>

          <!-- Bottom Toolbar -->
          <div class="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div class="flex flex-1 flex-wrap items-center gap-2.5">
              <span class="whitespace-nowrap text-base text-gray-400 font-bold">添加节点:</span>
              <button
                v-for="tpl in farmTemplates" :key="tpl.type"
                class="flex cursor-grab items-center gap-2 border border-gray-300 rounded-lg bg-white/50 px-4 py-1.5 text-sm text-gray-600 font-bold shadow-sm transition-colors active:cursor-grabbing dark:border-gray-600 hover:border-primary-500 dark:bg-black/30 hover:bg-white dark:text-gray-300 dark:hover:bg-black"
                @pointerdown="(e) => handlePointerDownPool(e, 'farm', tpl)"
              >
                <span class="text-base">{{ tpl.icon }}</span>
                <span>{{ tpl.label }}</span>
              </button>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <BaseButton variant="outline" size="sm" @click="resetDefault('farm')">
                重置默认流程
              </BaseButton>
              <BaseButton variant="primary" size="sm" :loading="saving" @click="saveConfigData('farm')">
                保存农场流程
              </BaseButton>
            </div>
          </div>
        </div>
      </div>

      <!-- ================= 好友流程 ================= -->
      <div class="glass-panel overflow-hidden border border-white/20 rounded-xl shadow-sm dark:border-white/10 dark:bg-black/20">
        <!-- Title Bar -->
        <div class="flex flex-wrap items-center justify-between border-b border-gray-200/50 bg-black/5 p-4 dark:border-gray-700/50 dark:bg-white/5">
          <div class="flex items-center gap-3">
            <h2 class="glass-text-main flex items-center gap-2 text-base font-bold">
              <span>🤝</span> 好友巡查流程编排
            </h2>
            <span
              class="rounded px-2 py-0.5 text-xs font-bold transition-colors"
              :class="config.friend.enabled ? 'bg-primary-500/20 text-primary-600 dark:text-primary-400' : 'bg-gray-200/50 text-gray-500 dark:bg-gray-700/50'"
            >
              {{ config.friend.enabled ? '已启用' : '未启用' }}
            </span>
          </div>
          <BaseSwitch v-model="config.friend.enabled" label="启用流程模式" />
        </div>

        <div class="p-4 space-y-4">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            启用后，拜访每位好友时按以下流程依次执行操作。未启用时使用默认顺序（除草->浇水->除虫->偷菜->放虫->放草）。
          </div>

          <div class="grid grid-cols-2 gap-4 rounded-lg bg-black/5 p-3 md:w-1/2 dark:bg-white/5">
            <div class="space-y-1">
              <label class="text-xs text-gray-500 font-bold">最小间隔 (秒)</label>
              <input
                v-model.number="config.friend.minInterval" type="number" min="1"
                class="glass-panel w-full border border-white/20 rounded bg-transparent px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
            </div>
            <div class="space-y-1">
              <label class="text-xs text-gray-500 font-bold">最大间隔 (秒)</label>
              <input
                v-model.number="config.friend.maxInterval" type="number" min="1"
                class="glass-panel w-full border border-white/20 rounded bg-transparent px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
            </div>
          </div>

          <!-- Status Bar -->
          <div
            class="flex items-center justify-between border border-transparent rounded bg-black/5 px-3 py-2 text-xs transition-colors dark:bg-white/5"
            :class="{ 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400': hasFriendChanges, 'border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400': !hasFriendChanges }"
          >
            <div class="font-bold font-mono">
              {{ hasFriendChanges ? '好友流程有未保存改动' : '好友流程已就绪 (未手保存改动)' }}
            </div>
            <div class="opacity-70">
              {{ hasFriendChanges ? '等待保存' : '最后保存: 未知' }}
            </div>
          </div>

          <!-- THE TRACK -->
          <div
            ref="friendTrackRef"
            class="custom-scrollbar relative flex select-none items-center overflow-x-auto overflow-y-hidden border-y border-gray-200 border-dashed p-3 transition-colors dark:border-gray-800 sm:py-6"
            :class="{ 'bg-primary-500/5 border-primary-500/30': isDragging && dragScope === 'friend' }"
          >
            <div v-if="config.friend.nodes.length === 0" class="pointer-events-none py-4 pl-2 text-sm text-gray-400 italic">
              拖拽底部节点到这里，或者直接点击下方节点...
            </div>

            <TransitionGroup name="wf-horizontal" class="flex items-center">
              <template v-for="(node, idx) in config.friend.nodes" :key="node.id">
                <div
                  v-if="isDragging && dragScope === 'friend' && dropPlaceholderIndex === idx"
                  class="wf-ph mx-2 h-[36px] w-[80px] shrink-0 border-2 border-primary-500/50 rounded-full border-dashed bg-primary-500/10 transition-all"
                />

                <template v-if="!(isDragging && dragSource === 'queue' && dragScope === 'friend' && dragIndex === idx)">
                  <div v-if="idx > 0 || (isDragging && dragScope === 'friend' && dropPlaceholderIndex === 0)" class="i-carbon-arrow-right wf-arrow mx-1 shrink-0 text-gray-300 dark:text-gray-600" />

                  <div
                    class="group wf-node-track-item relative shrink-0 cursor-grab transition-transform hover:scale-105 active:cursor-grabbing hover:-translate-y-1"
                    @pointerdown="(e) => handlePointerDownQueue(e, 'friend', idx)"
                  >
                    <div
                      class="flex items-center gap-2 border rounded-full px-4 py-2 text-base font-bold shadow-sm transition-colors"
                      :class="[
                        getTemplate(node.type)?.bgLight, getTemplate(node.type)?.bgDark,
                        getTemplate(node.type)?.borderLight, getTemplate(node.type)?.borderDark,
                        getTemplate(node.type)?.textLight, getTemplate(node.type)?.textDark,
                        editingNodeId === node.id ? 'ring-2 ring-primary-500 shadow-md' : 'hover:shadow',
                      ]"
                    >
                      <span>{{ getTemplate(node.type)?.icon }}</span>
                      <span>{{ getTemplate(node.type)?.label }}</span>
                    </div>

                    <button
                      class="absolute z-10 h-5 w-5 flex items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-sm transition-opacity -right-2 -top-2 hover:bg-red-600 group-hover:opacity-100"
                      @pointerdown.stop
                      @click="removeNode('friend', idx)"
                    >
                      <div class="i-carbon-close text-xs" />
                    </button>
                    <button
                      v-if="getTemplate(node.type)?.hasParams"
                      class="absolute z-10 h-5 w-5 flex items-center justify-center rounded-full bg-blue-500 text-white opacity-0 shadow-sm transition-opacity -bottom-2 -right-2 hover:bg-blue-600 group-hover:opacity-100"
                      @pointerdown.stop
                      @click="editingNodeId = editingNodeId === node.id ? null : node.id; editingScope = 'friend'"
                    >
                      <div class="i-carbon-settings text-[10px]" />
                    </button>
                  </div>
                </template>
              </template>

              <div
                v-if="isDragging && dragScope === 'friend' && dropPlaceholderIndex === config.friend.nodes.length" key="ph-end"
                class="wf-ph mx-2 h-[36px] w-[80px] shrink-0 border-2 border-primary-500/50 rounded-full border-dashed bg-primary-500/10 transition-all"
              />
            </TransitionGroup>
          </div>

          <!-- Inline Editor -->
          <div v-if="editingScope === 'friend' && editingNodeId && activeNode" class="animate-in fade-in slide-in-from-top-2 relative border border-primary-500/20 rounded-lg bg-black/5 p-4 dark:bg-white/5">
            <button class="absolute right-3 top-3 text-gray-400 hover:text-gray-600" @click="editingNodeId = null">
              <div class="i-carbon-close text-lg" />
            </button>
            <h3 class="mb-3 flex items-center gap-2 text-sm text-primary-600 font-bold dark:text-primary-400">
              <div class="i-carbon-edit" />
              编辑节点: {{ getTemplate(activeNode.type)?.label }}
            </h3>

            <div v-if="activeNode.params" class="space-y-4">
              <template v-if="activeNode.type === 'delay'">
                <div class="max-w-[240px] w-full">
                  <BaseInput v-model.number="activeNode.params.sec" type="number" min="1" label="延时时间(秒)" />
                </div>
              </template>
            </div>
          </div>

          <!-- Bottom Toolbar -->
          <div class="mt-2 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div class="flex flex-1 flex-wrap items-center gap-2.5">
              <span class="whitespace-nowrap text-base text-gray-400 font-bold">添加节点:</span>
              <button
                v-for="tpl in friendTemplates" :key="tpl.type"
                class="flex cursor-grab items-center gap-2 border border-gray-300 rounded-lg bg-white/50 px-4 py-1.5 text-sm text-gray-600 font-bold shadow-sm transition-colors active:cursor-grabbing dark:border-gray-600 hover:border-primary-500 dark:bg-black/30 hover:bg-white dark:text-gray-300 dark:hover:bg-black"
                @pointerdown="(e) => handlePointerDownPool(e, 'friend', tpl)"
              >
                <span class="text-base">{{ tpl.icon }}</span>
                <span>{{ tpl.label }}</span>
              </button>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <BaseButton variant="outline" size="sm" @click="resetDefault('friend')">
                重置默认流程
              </BaseButton>
              <BaseButton variant="primary" size="sm" :loading="saving" @click="saveConfigData('friend')">
                保存好友流程
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  height: 8px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
}
.dark .custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.02);
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 4px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
}

.wf-horizontal-move {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.wf-horizontal-enter-active,
.wf-horizontal-leave-active {
  transition: all 0.3s ease;
}
.wf-horizontal-enter-from {
  opacity: 0;
  transform: translateX(-20px) scale(0.9);
}
.wf-horizontal-leave-to {
  opacity: 0;
  transform: scale(0.9);
  position: absolute;
}
</style>
