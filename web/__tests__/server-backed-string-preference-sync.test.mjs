import assert from 'node:assert/strict'
import test from 'node:test'

const {
  getServerBackedStringPreferenceSyncState,
  hydrateSyncableStringPreference,
  persistSyncableStringPreference,
  resolveServerBackedStringPreferenceHydrationMode,
} = await import('../src/utils/server-backed-string-preference-sync.ts')

function createMemoryStorage() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

const syncStateStorageKey = 'qq-farm.view-preferences.string-sync-state.v1'

function createPreferenceOptions(overrides = {}) {
  const storage = overrides.storage ?? createMemoryStorage()
  return {
    storage,
    syncId: 'announcementDismissedId:announcement_dismissed_id',
    storageKey: syncStateStorageKey,
    localKey: 'announcement_dismissed_id',
    normalize: (value, fallback = '') => String(value ?? fallback).trim(),
    readRemoteValue: payload => payload?.announcementDismissedId,
    fetchRemote: overrides.fetchRemote ?? (async () => null),
    saveRemote: overrides.saveRemote ?? (async nextValue => ({ announcementDismissedId: nextValue })),
    onError: overrides.onError,
  }
}

test('dirty local string preference wins over stale remote value, including empty-string clears', async () => {
  const storage = createMemoryStorage()
  storage.setItem(syncStateStorageKey, JSON.stringify({
    'announcementDismissedId:announcement_dismissed_id': {
      dirty: true,
      updatedAt: 123,
      lastSyncedAt: 0,
    },
  }))

  const calls = []
  const value = await hydrateSyncableStringPreference(createPreferenceOptions({
    storage,
    fetchRemote: async () => ({ announcementDismissedId: '42' }),
    saveRemote: async (nextValue) => {
      calls.push(nextValue)
      return { announcementDismissedId: nextValue }
    },
  }))

  assert.equal(value, '')
  assert.deepEqual(calls, [''])
  assert.equal(storage.getItem('announcement_dismissed_id'), null)
  const syncedState = getServerBackedStringPreferenceSyncState(
    storage,
    syncStateStorageKey,
    'announcementDismissedId:announcement_dismissed_id',
  )
  assert.equal(syncedState.dirty, false)
  assert.ok(syncedState.updatedAt >= 123)
  assert.ok(syncedState.lastSyncedAt > 0)
})

test('persistSyncableStringPreference keeps local value and dirty state when remote save fails', async () => {
  const storage = createMemoryStorage()
  const errors = []
  const nextValue = await persistSyncableStringPreference(createPreferenceOptions({
    storage,
    saveRemote: async () => {
      throw new Error('network down')
    },
    onError: (phase, error) => {
      errors.push({ phase, message: error instanceof Error ? error.message : String(error) })
    },
  }), '2026-03-26 10:00:00')

  assert.equal(nextValue, '2026-03-26 10:00:00')
  assert.equal(storage.getItem('announcement_dismissed_id'), '2026-03-26 10:00:00')
  assert.deepEqual(errors, [{ phase: 'persist', message: 'network down' }])
  const dirtyState = getServerBackedStringPreferenceSyncState(
    storage,
    syncStateStorageKey,
    'announcementDismissedId:announcement_dismissed_id',
  )
  assert.equal(dirtyState.dirty, true)
  assert.equal(dirtyState.lastSyncedAt, 0)
  assert.ok(dirtyState.updatedAt > 0)
})

test('string preference hydration picks remote, local migration, and empty modes as expected', () => {
  assert.equal(resolveServerBackedStringPreferenceHydrationMode({
    localValue: '',
    remoteValue: '2026-03-20',
    syncState: { dirty: false },
  }), 'prefer_remote')

  assert.equal(resolveServerBackedStringPreferenceHydrationMode({
    localValue: '2026-03-21',
    remoteValue: '',
    syncState: { dirty: false },
  }), 'migrate_local')

  assert.equal(resolveServerBackedStringPreferenceHydrationMode({
    localValue: '',
    remoteValue: '',
    syncState: { dirty: true },
  }), 'prefer_local_dirty')

  assert.equal(resolveServerBackedStringPreferenceHydrationMode({
    localValue: '',
    remoteValue: '',
    syncState: { dirty: false },
  }), 'empty')
})
