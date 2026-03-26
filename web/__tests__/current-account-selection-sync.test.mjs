import assert from 'node:assert/strict'
import test from 'node:test'

const {
  getCurrentAccountSelectionSyncState,
  normalizeCurrentAccountSelectionId,
  persistCurrentAccountSelection,
  reconcileCurrentAccountSelection,
} = await import('../src/utils/current-account-selection-sync.ts')

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

const syncStateStorageKey = 'qq-farm.account-selection-sync-state.v1'

test('persistCurrentAccountSelection keeps local choice and dirty state when remote save fails', async () => {
  const storage = createMemoryStorage()
  const errors = []

  const savedAccountId = await persistCurrentAccountSelection('acc-5', {
    storage,
    saveSelection: async () => {
      throw new Error('network down')
    },
    onError: (phase, error) => {
      errors.push({ phase, message: error instanceof Error ? error.message : String(error) })
    },
  })

  assert.equal(savedAccountId, 'acc-5')
  assert.equal(storage.getItem('current_account_id'), 'acc-5')
  assert.deepEqual(errors, [{ phase: 'persist', message: 'network down' }])

  const dirtyState = getCurrentAccountSelectionSyncState(storage)
  assert.equal(dirtyState.dirty, true)
  assert.equal(dirtyState.lastSyncedAt, 0)
  assert.ok(dirtyState.updatedAt > 0)
})

test('reconcileCurrentAccountSelection retries dirty local clear instead of restoring stale remote account', async () => {
  const storage = createMemoryStorage()
  storage.setItem(syncStateStorageKey, JSON.stringify({
    currentAccountId: {
      dirty: true,
      updatedAt: 456,
      lastSyncedAt: 0,
    },
  }))

  const calls = []
  const accountId = await reconcileCurrentAccountSelection('acc-9', {
    storage,
    localValue: '',
    saveSelection: async (nextValue) => {
      calls.push(nextValue)
      return { currentAccountId: nextValue }
    },
  })

  assert.equal(accountId, '')
  assert.deepEqual(calls, [''])
  assert.equal(storage.getItem('current_account_id'), null)

  const syncedState = getCurrentAccountSelectionSyncState(storage)
  assert.equal(syncedState.dirty, false)
  assert.ok(syncedState.updatedAt >= 456)
  assert.ok(syncedState.lastSyncedAt > 0)
})

test('reconcileCurrentAccountSelection adopts remote value when local state is clean', async () => {
  const storage = createMemoryStorage()
  storage.setItem('current_account_id', 'acc-1')

  const accountId = await reconcileCurrentAccountSelection('acc-9', {
    storage,
  })

  assert.equal(accountId, 'acc-9')
  assert.equal(storage.getItem('current_account_id'), 'acc-9')

  const syncedState = getCurrentAccountSelectionSyncState(storage)
  assert.equal(syncedState.dirty, false)
  assert.ok(syncedState.lastSyncedAt > 0)
})

test('normalizeCurrentAccountSelectionId trims arbitrary input to a stable account id', () => {
  assert.equal(normalizeCurrentAccountSelectionId('  acc-7  '), 'acc-7')
  assert.equal(normalizeCurrentAccountSelectionId(null), '')
})
