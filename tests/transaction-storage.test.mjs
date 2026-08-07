import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'

import {
  activityStore,
  getTransactionActivities,
  getTransactionWatches,
  transactionRepository,
  TRANSACTION_ACTIVITIES,
  TRANSACTION_WATCHES,
} from '../src/background/chromeStorage.ts'

let values

globalThis.chrome = {
  runtime: { id: 'test-extension' },
  storage: {
    local: {
      get(key, callback) {
        if (key === null) return queueMicrotask(() => callback({ ...values }))
        const keys = Array.isArray(key) ? key : [key]
        queueMicrotask(() =>
          callback(Object.fromEntries(keys.filter((item) => item in values).map((item) => [item, values[item]]))),
        )
      },
      set(next, callback) {
        queueMicrotask(() => {
          values = { ...values, ...structuredClone(next) }
          callback()
        })
      },
      remove(keys, callback) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]
        queueMicrotask(callback)
      },
    },
  },
}

const activity = (id) => ({
  id,
  hash: `0x${id.padStart(64, '0')}`,
  origin: 'https://dapp.example',
  from: `0x${'11'.repeat(20)}`,
  networkId: 'network',
  networkName: '测试链',
  groupId: 'group0',
  crypto: 'standard',
  createdAt: new Date(0).toISOString(),
  status: 'submitted',
})

const watch = (id) => ({
  activityId: id,
  hash: activity(id).hash,
  network: {
    id: 'network',
    name: '测试链',
    rpcUrl: 'https://rpc.example',
    mode: 'web3',
    crypto: 'standard',
    chainId: 1,
    groupId: 'group0',
  },
  blockLimit: '500',
  attempts: 0,
  maxAttempts: 40,
  nextCheckAt: 1,
})

beforeEach(() => {
  values = {}
})

test('serializes concurrent activity additions without losing records', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, index) => activityStore.add(activity(String(index)))))
  const activities = await getTransactionActivities()
  assert.equal(activities.length, 20)
  assert.equal(new Set(activities.map((item) => item.id)).size, 20)
})

test('caps activities at 100 and removes watches orphaned by trimming', async () => {
  const existing = Array.from({ length: 100 }, (_, index) => activity(String(index)))
  values[TRANSACTION_ACTIVITIES] = existing
  values[TRANSACTION_WATCHES] = existing.map((item) => watch(item.id))
  await activityStore.add(activity('new'))
  const [activities, watches] = await Promise.all([
    getTransactionActivities(),
    getTransactionWatches(),
  ])
  assert.equal(activities.length, 100)
  assert.equal(activities[0].id, 'new')
  assert.equal(watches.length, 99)
  assert.equal(watches.some((item) => item.activityId === '99'), false)
})

test('concurrent terminal update and add preserve both changes', async () => {
  values[TRANSACTION_ACTIVITIES] = [activity('tracked')]
  values[TRANSACTION_WATCHES] = [watch('tracked')]
  await Promise.all([
    transactionRepository.complete('tracked', { status: 'success' }),
    activityStore.add(activity('new')),
  ])
  const [activities, watches] = await Promise.all([
    getTransactionActivities(),
    getTransactionWatches(),
  ])
  assert.equal(activities.find((item) => item.id === 'tracked').status, 'success')
  assert.equal(activities.some((item) => item.id === 'new'), true)
  assert.equal(watches.length, 0)
})

test('reads a legacy submitted-only activity without inventing a watch', async () => {
  const legacy = activity('legacy')
  values[TRANSACTION_ACTIVITIES] = [legacy]
  assert.deepEqual(await getTransactionActivities(), [legacy])
  assert.deepEqual(await getTransactionWatches(), [])
})
