import assert from 'node:assert/strict'
import test from 'node:test'

import {
  broadcastProviderStateChanged,
  runAndBroadcastProviderState,
} from '../src/background/providerStateBroadcast.ts'
import { isProviderStateChangedEvent } from '../src/shared/messages.ts'

test('provider state event validator accepts only supported non-empty changes', () => {
  assert.equal(
    isProviderStateChangedEvent({
      type: 'FISCO_PROVIDER_STATE_CHANGED',
      changes: ['accounts', 'group'],
    }),
    true,
  )
  assert.equal(
    isProviderStateChangedEvent({
      type: 'FISCO_PROVIDER_STATE_CHANGED',
      changes: [],
    }),
    false,
  )
  assert.equal(
    isProviderStateChangedEvent({
      type: 'FISCO_PROVIDER_STATE_CHANGED',
      changes: ['chain'],
    }),
    true,
  )
})

test('provider state operation broadcasts only after successful completion', async () => {
  const calls = []
  const result = await runAndBroadcastProviderState(
    async () => {
      calls.push('operation')
      return 'result'
    },
    ['accounts'],
    (changes) => calls.push(`broadcast:${changes.join(',')}`),
  )
  assert.equal(result, 'result')
  assert.deepEqual(calls, ['operation', 'broadcast:accounts'])

  await assert.rejects(
    () => runAndBroadcastProviderState(
      async () => {
        throw new Error('failed')
      },
      ['group'],
      () => calls.push('unexpected'),
    ),
    /failed/,
  )
  assert.deepEqual(calls, ['operation', 'broadcast:accounts'])
})

test('provider state broadcaster sends deduplicated changes to every tab', () => {
  const sent = []
  let lastErrorReads = 0
  const previousChrome = globalThis.chrome
  globalThis.chrome = {
    runtime: {
      get lastError() {
        lastErrorReads += 1
        return undefined
      },
    },
    tabs: {
      query(_query, callback) {
        callback([{ id: 1 }, { id: 2 }, {}])
      },
      sendMessage(tabId, message, callback) {
        sent.push({ tabId, message })
        callback()
      },
    },
  }

  try {
    broadcastProviderStateChanged(['group', 'accounts', 'group'])

    assert.deepEqual(sent, [
      {
        tabId: 1,
        message: {
          type: 'FISCO_PROVIDER_STATE_CHANGED',
          changes: ['group', 'accounts'],
        },
      },
      {
        tabId: 2,
        message: {
          type: 'FISCO_PROVIDER_STATE_CHANGED',
          changes: ['group', 'accounts'],
        },
      },
    ])
    assert.equal(lastErrorReads, 3)
  } finally {
    globalThis.chrome = previousChrome
  }
})
