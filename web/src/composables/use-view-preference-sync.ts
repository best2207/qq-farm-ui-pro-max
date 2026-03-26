import type { ViewPreferencesPayload } from '../utils/view-preferences'
import { computed, onScopeDispose, ref, watch } from 'vue'

type ViewPreferencesFetcher = () => Promise<ViewPreferencesPayload | null>
type ViewPreferencesSaver = (payload: ViewPreferencesPayload) => Promise<unknown>
type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

interface ViewPreferenceSyncState {
  dirty: boolean
  updatedAt: number
  lastSyncedAt: number
}

const VIEW_PREFERENCE_SYNC_STATE_KEY = 'qq-farm.view-preferences.sync-state.v1'
const DEFAULT_VIEW_PREFERENCE_SYNC_STATE: ViewPreferenceSyncState = Object.freeze({
  dirty: false,
  updatedAt: 0,
  lastSyncedAt: 0,
})

export interface UseViewPreferenceSyncOptions<T, K extends keyof ViewPreferencesPayload> {
  key: K
  label: string
  buildState: () => T
  applyState: (state: ViewPreferencesPayload[K] | null | undefined) => void
  defaultState?: T
  readLocalFallback?: () => T
  shouldSyncFallback?: (state: T) => boolean
  debounceMs?: number
  fetchPreferences?: ViewPreferencesFetcher
  savePreferences?: ViewPreferencesSaver
  storage?: StorageLike | null
  syncId?: string
}

function hasPersistedViewPreferenceValue(value: unknown) {
  return value !== undefined && value !== null
}

function buildViewPreferencePayload<K extends keyof ViewPreferencesPayload>(
  key: K,
  state: ViewPreferencesPayload[K],
): ViewPreferencesPayload {
  return { [key]: state } as ViewPreferencesPayload
}

function getSafeStorage(storage?: StorageLike | null) {
  if (storage)
    return storage
  if (typeof window === 'undefined')
    return null
  try {
    return window.localStorage
  }
  catch {
    return null
  }
}

function normalizeTimestamp(value: unknown) {
  const next = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(next) || next < 0)
    return 0
  return next
}

function normalizeSyncId(syncId: unknown) {
  return String(syncId || '').trim()
}

function normalizeViewPreferenceSyncState(input: unknown): ViewPreferenceSyncState {
  const source = (input && typeof input === 'object') ? input as Partial<ViewPreferenceSyncState> : {}
  return {
    dirty: source.dirty === true,
    updatedAt: normalizeTimestamp(source.updatedAt),
    lastSyncedAt: normalizeTimestamp(source.lastSyncedAt),
  }
}

function readViewPreferenceSyncStateMap(storage: StorageLike | null | undefined) {
  if (!storage)
    return {}
  try {
    const raw = storage.getItem(VIEW_PREFERENCE_SYNC_STATE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object')
      return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([syncId, state]) => [normalizeSyncId(syncId), normalizeViewPreferenceSyncState(state)])
        .filter(([syncId]) => !!syncId),
    ) as Record<string, ViewPreferenceSyncState>
  }
  catch {
    return {}
  }
}

function writeViewPreferenceSyncStateMap(
  storage: StorageLike | null | undefined,
  nextMap: Record<string, ViewPreferenceSyncState>,
) {
  if (!storage)
    return
  try {
    const entries = Object.entries(nextMap)
      .filter(([syncId]) => !!normalizeSyncId(syncId))
    if (!entries.length) {
      storage.removeItem(VIEW_PREFERENCE_SYNC_STATE_KEY)
      return
    }
    storage.setItem(VIEW_PREFERENCE_SYNC_STATE_KEY, JSON.stringify(Object.fromEntries(entries)))
  }
  catch {
  }
}

function getViewPreferenceSyncState(
  storage: StorageLike | null | undefined,
  syncId: unknown,
) {
  const normalizedSyncId = normalizeSyncId(syncId)
  if (!normalizedSyncId)
    return { ...DEFAULT_VIEW_PREFERENCE_SYNC_STATE }
  const stateMap = readViewPreferenceSyncStateMap(storage)
  return stateMap[normalizedSyncId] || { ...DEFAULT_VIEW_PREFERENCE_SYNC_STATE }
}

function setViewPreferenceSyncState(
  storage: StorageLike | null | undefined,
  syncId: unknown,
  nextState: Partial<ViewPreferenceSyncState>,
) {
  const normalizedSyncId = normalizeSyncId(syncId)
  if (!normalizedSyncId || !storage)
    return { ...DEFAULT_VIEW_PREFERENCE_SYNC_STATE }
  const stateMap = readViewPreferenceSyncStateMap(storage)
  const mergedState = normalizeViewPreferenceSyncState({
    ...(stateMap[normalizedSyncId] || DEFAULT_VIEW_PREFERENCE_SYNC_STATE),
    ...nextState,
  })
  stateMap[normalizedSyncId] = mergedState
  writeViewPreferenceSyncStateMap(storage, stateMap)
  return mergedState
}

async function resolveDefaultFetchPreferences(): Promise<ViewPreferencesFetcher> {
  const { fetchViewPreferences } = await import('../utils/view-preference-api')
  return fetchViewPreferences
}

async function resolveDefaultSavePreferences(): Promise<ViewPreferencesSaver> {
  const { saveViewPreferences } = await import('../utils/view-preference-api')
  return saveViewPreferences
}

export function useViewPreferenceSync<T, K extends keyof ViewPreferencesPayload>(
  options: UseViewPreferenceSyncOptions<T, K>,
) {
  const hydrating = ref(false)
  const syncEnabled = ref(false)
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let pendingState: T | null = null
  const debounceMs = options.debounceMs ?? 240
  const fetchPreferences = options.fetchPreferences ?? (() => resolveDefaultFetchPreferences().then(load => load()))
  const savePreferences = options.savePreferences ?? (payload => resolveDefaultSavePreferences().then(save => save(payload)))
  const storage = getSafeStorage(options.storage)
  const syncId = normalizeSyncId(options.syncId ?? String(options.key))

  const signature = computed(() => JSON.stringify(options.buildState()))

  function clearSyncTimer() {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
  }

  function applyHydratedState(state: ViewPreferencesPayload[K] | null | undefined) {
    hydrating.value = true
    options.applyState(state)
    hydrating.value = false
  }

  function readFallbackState() {
    return options.readLocalFallback ? options.readLocalFallback() : options.buildState()
  }

  function shouldSyncFallbackState(state: T) {
    if (options.shouldSyncFallback)
      return options.shouldSyncFallback(state)
    if (options.defaultState === undefined)
      return false
    return JSON.stringify(state) !== JSON.stringify(options.defaultState)
  }

  function markSyncDirty() {
    setViewPreferenceSyncState(storage, syncId, {
      dirty: true,
      updatedAt: Date.now(),
    })
  }

  function markSyncSynced() {
    setViewPreferenceSyncState(storage, syncId, {
      dirty: false,
      lastSyncedAt: Date.now(),
    })
  }

  async function persistState(state: T = options.buildState()) {
    try {
      await savePreferences(
        buildViewPreferencePayload(options.key, state as ViewPreferencesPayload[K]),
      )
      markSyncSynced()
      return true
    }
    catch (error) {
      markSyncDirty()
      console.warn(`保存${options.label}失败`, error)
      return false
    }
  }

  async function flushPendingState() {
    const state = pendingState
    clearSyncTimer()
    pendingState = null
    if (state === null)
      return
    await persistState(state)
  }

  async function hydrate(preloadedPayload?: ViewPreferencesPayload | null) {
    const fallbackState = readFallbackState()
    const syncState = getViewPreferenceSyncState(storage, syncId)
    try {
      const payload = preloadedPayload ?? await fetchPreferences()
      const remoteState = payload?.[options.key]
      if (syncState.dirty) {
        applyHydratedState(fallbackState as ViewPreferencesPayload[K])
        if (JSON.stringify(remoteState ?? null) === JSON.stringify(fallbackState ?? null)) {
          markSyncSynced()
          return
        }
        await persistState(fallbackState)
        return
      }
      if (hasPersistedViewPreferenceValue(remoteState)) {
        applyHydratedState(remoteState)
        markSyncSynced()
        return
      }

      applyHydratedState(fallbackState as ViewPreferencesPayload[K])
      if (shouldSyncFallbackState(fallbackState))
        await persistState(fallbackState)
    }
    catch (error) {
      console.warn(`读取${options.label}失败`, error)
      applyHydratedState(fallbackState as ViewPreferencesPayload[K])
    }
  }

  function scheduleSync() {
    clearSyncTimer()
    const payload = options.buildState()
    pendingState = payload
    syncTimer = setTimeout(() => {
      void flushPendingState()
    }, debounceMs)
  }

  watch(signature, () => {
    if (!syncEnabled.value || hydrating.value)
      return
    scheduleSync()
  })

  onScopeDispose(() => {
    if (!syncEnabled.value || hydrating.value) {
      clearSyncTimer()
      pendingState = null
      return
    }
    void flushPendingState()
  })

  return {
    hydrating,
    syncEnabled,
    hydrate,
    enableSync: () => {
      syncEnabled.value = true
    },
    disableSync: () => {
      syncEnabled.value = false
      clearSyncTimer()
      pendingState = null
    },
  }
}
