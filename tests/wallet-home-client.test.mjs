import assert from 'node:assert/strict'
import test from 'node:test'

import {
  subscribeToSubmittedTransactions,
  subscribeToTransactionActivities,
} from '../src/popup/walletHomeClient.ts'
import { TRANSACTION_ACTIVITIES_STORAGE_KEY } from '../src/shared/walletHomeMessages.ts'

test('activity storage subscription is filtered, debounced, and removable', () => {
  let registered
  let removed
  let calls = 0
  globalThis.window = {
    setTimeout(callback) {
      callback()
      return 1
    },
    clearTimeout() {},
  }
  globalThis.chrome = {
    storage: {
      onChanged: {
        addListener(listener) { registered = listener },
        removeListener(listener) { removed = listener },
      },
    },
  }
  const unsubscribe = subscribeToTransactionActivities(() => { calls += 1 })
  registered({ unrelated: { newValue: [] } }, 'local')
  registered({ [TRANSACTION_ACTIVITIES_STORAGE_KEY]: { newValue: [] } }, 'sync')
  assert.equal(calls, 0)
  registered({ [TRANSACTION_ACTIVITIES_STORAGE_KEY]: { newValue: [] } }, 'local')
  assert.equal(calls, 1)
  unsubscribe()
  assert.equal(removed, registered)
})

test('submitted transaction subscription only reports newly inserted broadcasts', () => {
  let registered
  let removed
  let calls = 0
  globalThis.chrome = {
    storage: {
      onChanged: {
        addListener(listener) { registered = listener },
        removeListener(listener) { removed = listener },
      },
    },
  }
  const unsubscribe = subscribeToSubmittedTransactions(() => { calls += 1 })
  const submitted = { id: 'tx-1', status: 'submitted' }
  registered({
    [TRANSACTION_ACTIVITIES_STORAGE_KEY]: {
      oldValue: [],
      newValue: [submitted],
    },
  }, 'local')
  registered({
    [TRANSACTION_ACTIVITIES_STORAGE_KEY]: {
      oldValue: [submitted],
      newValue: [{ ...submitted, status: 'success' }],
    },
  }, 'local')
  registered({
    [TRANSACTION_ACTIVITIES_STORAGE_KEY]: {
      oldValue: [{ ...submitted, status: 'success' }],
      newValue: [{ ...submitted, status: 'success' }],
    },
  }, 'local')
  assert.equal(calls, 1)
  unsubscribe()
  assert.equal(removed, registered)
})
