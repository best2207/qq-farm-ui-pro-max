export interface ServerBackedStringPreferenceSyncState {
  dirty: boolean
  updatedAt: number
  lastSyncedAt: number
}

export interface SyncableStringPreferenceOptions<TPayload = Record<string, unknown>> {
  fetchRemote: () => Promise<TPayload | null>
  localKey: string
  normalize: (value: unknown, fallback?: string) => string
  onError?: (phase: 'hydrate' | 'persist', error: unknown) => void
  readRemoteValue: (payload: TPayload | null | undefined) => unknown
  saveRemote: (nextValue: string) => Promise<TPayload | null>
  storage?: StorageLike | null
  storageKey: string
  syncId: string
}

export interface PersistSyncableStringPreferenceOptions<TPayload = Record<string, unknown>> {
  localKey: string
  normalize: (value: unknown, fallback?: string) => string
  onError?: (phase: 'hydrate' | 'persist', error: unknown) => void
  readRemoteValue: (payload: TPayload | null | undefined) => unknown
  saveRemote: (nextValue: string) => Promise<TPayload | null>
  storage?: StorageLike | null
  storageKey: string
  syncId: string
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>
type HydrationMode = 'prefer_local_dirty' | 'prefer_remote' | 'migrate_local' | 'empty'

const DEFAULT_SYNC_STATE: ServerBackedStringPreferenceSyncState = Object.freeze({
  dirty: false,
  updatedAt: 0,
  lastSyncedAt: 0,
})

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

function normalizeSyncState(input: unknown): ServerBackedStringPreferenceSyncState {
  const source = (input && typeof input === 'object') ? input as Partial<ServerBackedStringPreferenceSyncState> : {}
  return {
    dirty: source.dirty === true,
    updatedAt: normalizeTimestamp(source.updatedAt),
    lastSyncedAt: normalizeTimestamp(source.lastSyncedAt),
  }
}

function readSyncStateMap(storage: StorageLike | null | undefined, storageKey: string) {
  if (!storage)
    return {}
  try {
    const raw = storage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object')
      return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([syncId, state]) => [normalizeSyncId(syncId), normalizeSyncState(state)])
        .filter(([syncId]) => !!syncId),
    ) as Record<string, ServerBackedStringPreferenceSyncState>
  }
  catch {
    return {}
  }
}

function writeSyncStateMap(
  storage: StorageLike | null | undefined,
  storageKey: string,
  nextMap: Record<string, ServerBackedStringPreferenceSyncState>,
) {
  if (!storage)
    return
  try {
    const entries = Object.entries(nextMap)
      .filter(([syncId]) => !!normalizeSyncId(syncId))
    if (!entries.length) {
      storage.removeItem(storageKey)
      return
    }
    storage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)))
  }
  catch {
  }
}

function readLocalValue(storage: StorageLike | null | undefined, localKey: string) {
  if (!storage)
    return ''
  try {
    return String(storage.getItem(localKey) || '')
  }
  catch {
    return ''
  }
}

function writeLocalValue(storage: StorageLike | null | undefined, localKey: string, value: string) {
  if (!storage)
    return
  try {
    if (value)
      storage.setItem(localKey, value)
    else
      storage.removeItem(localKey)
  }
  catch {
  }
}

function markSynced(storage: StorageLike | null | undefined, storageKey: string, syncId: string) {
  setServerBackedStringPreferenceSyncState(storage, storageKey, syncId, {
    dirty: false,
    lastSyncedAt: Date.now(),
  })
}

function markDirty(storage: StorageLike | null | undefined, storageKey: string, syncId: string) {
  setServerBackedStringPreferenceSyncState(storage, storageKey, syncId, {
    dirty: true,
    updatedAt: Date.now(),
  })
}

export function getServerBackedStringPreferenceSyncState(
  storage: StorageLike | null | undefined,
  storageKey: string,
  syncId: unknown,
) {
  const normalizedSyncId = normalizeSyncId(syncId)
  if (!normalizedSyncId)
    return { ...DEFAULT_SYNC_STATE }
  const stateMap = readSyncStateMap(storage, storageKey)
  return stateMap[normalizedSyncId] || { ...DEFAULT_SYNC_STATE }
}

export function setServerBackedStringPreferenceSyncState(
  storage: StorageLike | null | undefined,
  storageKey: string,
  syncId: unknown,
  nextState: Partial<ServerBackedStringPreferenceSyncState>,
) {
  const normalizedSyncId = normalizeSyncId(syncId)
  if (!normalizedSyncId || !storage)
    return { ...DEFAULT_SYNC_STATE }
  const stateMap = readSyncStateMap(storage, storageKey)
  const mergedState = normalizeSyncState({
    ...(stateMap[normalizedSyncId] || DEFAULT_SYNC_STATE),
    ...nextState,
  })
  stateMap[normalizedSyncId] = mergedState
  writeSyncStateMap(storage, storageKey, stateMap)
  return mergedState
}

export function resolveServerBackedStringPreferenceHydrationMode(input: {
  localValue?: string | null
  remoteValue?: string | null
  syncState?: Partial<ServerBackedStringPreferenceSyncState> | null
}): HydrationMode {
  const syncState = normalizeSyncState(input.syncState)
  if (syncState.dirty)
    return 'prefer_local_dirty'
  if (String(input.remoteValue || ''))
    return 'prefer_remote'
  if (String(input.localValue || ''))
    return 'migrate_local'
  return 'empty'
}

export async function persistSyncableStringPreference<TPayload = Record<string, unknown>>(
  options: PersistSyncableStringPreferenceOptions<TPayload>,
  value: unknown,
) {
  const storage = getSafeStorage(options.storage)
  const nextValue = options.normalize(value, '')
  writeLocalValue(storage, options.localKey, nextValue)
  markDirty(storage, options.storageKey, options.syncId)

  try {
    const payload = await options.saveRemote(nextValue)
    const savedValue = options.normalize(options.readRemoteValue(payload), nextValue)
    writeLocalValue(storage, options.localKey, savedValue)
    markSynced(storage, options.storageKey, options.syncId)
    return savedValue
  }
  catch (error) {
    options.onError?.('persist', error)
    return nextValue
  }
}

export async function hydrateSyncableStringPreference<TPayload = Record<string, unknown>>(
  options: SyncableStringPreferenceOptions<TPayload>,
) {
  const storage = getSafeStorage(options.storage)
  const localValue = options.normalize(readLocalValue(storage, options.localKey), '')
  const syncState = getServerBackedStringPreferenceSyncState(storage, options.storageKey, options.syncId)

  try {
    const payload = await options.fetchRemote()
    const remoteValue = options.normalize(options.readRemoteValue(payload), '')
    const hydrationMode = resolveServerBackedStringPreferenceHydrationMode({
      localValue,
      remoteValue,
      syncState,
    })

    if (hydrationMode === 'prefer_local_dirty') {
      if (remoteValue === localValue) {
        writeLocalValue(storage, options.localKey, localValue)
        markSynced(storage, options.storageKey, options.syncId)
        return localValue
      }
      return await persistSyncableStringPreference(options, localValue)
    }

    if (hydrationMode === 'prefer_remote') {
      writeLocalValue(storage, options.localKey, remoteValue)
      markSynced(storage, options.storageKey, options.syncId)
      return remoteValue
    }

    if (hydrationMode === 'migrate_local')
      return await persistSyncableStringPreference(options, localValue)

    return localValue
  }
  catch (error) {
    options.onError?.('hydrate', error)
    return localValue
  }
}
