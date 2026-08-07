import assert from 'node:assert/strict'
import test from 'node:test'

import { TransactionMonitor } from '../src/background/transactionMonitor.ts'

const hash = `0x${'ab'.repeat(32)}`
const network = {
  id: 'snapshot',
  name: '广播网络',
  rpcUrl: 'https://snapshot.example',
  mode: 'legacy',
  crypto: 'gm',
  chainId: 1,
  groupId: 'group0',
  billingEnabled: true,
}

const createHarness = ({
  receipt = null,
  block = 10,
  blockLimit = '10',
  maxAttempts = 3,
  expiresAt,
  monitorOptions = {},
} = {}) => {
  let now = 1_000
  let watches = [{
    activityId: 'activity-1',
    hash,
    network,
    ...(blockLimit === undefined ? {} : { blockLimit }),
    attempts: 0,
    maxAttempts,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    nextCheckAt: now,
  }]
  const completions = []
  const schedules = []
  const adapterNetworks = []
  const repository = {
    async listWatches() { return watches.map((watch) => ({ ...watch })) },
    async track(_activity, watch) { watches = [watch] },
    async saveWatch(watch) {
      watches = [watch, ...watches.filter((item) => item.activityId !== watch.activityId)]
    },
    async complete(activityId, update) {
      completions.push({ activityId, update })
      watches = watches.filter((watch) => watch.activityId !== activityId)
    },
  }
  const adapter = {
    mode: 'legacy',
    async request(request) {
      if (request.method === 'eth_getTransactionReceipt') {
        return typeof receipt === 'function' ? receipt() : receipt
      }
      if (request.method === 'fisco_getBlockNumber') {
        return typeof block === 'function' ? block() : block
      }
      throw new Error(`Unexpected method ${request.method}`)
    },
  }
  const monitor = new TransactionMonitor(
    repository,
    { async schedule(at) { schedules.push(at) } },
    { async create(snapshot) { adapterNetworks.push(snapshot); return adapter } },
    { pollIntervalMs: 20, maxAttempts, now: () => now, ...monitorOptions },
  )
  return {
    monitor,
    completions,
    schedules,
    adapterNetworks,
    watches: () => watches,
    setNow(value) { now = value },
  }
}

test('pending receipt becomes success and uses broadcast network snapshot', async () => {
  let call = 0
  const harness = createHarness({
    receipt: () => ++call === 1 ? null : { transactionHash: hash, status: 0, blockNumber: 10 },
  })
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.completions.length, 0)
  harness.setNow(1_020)
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.completions[0].update.status, 'success')
  assert.equal(harness.completions[0].update.receiptBlockNumber, '10')
  assert.deepEqual(harness.adapterNetworks[0], network)
})

test('valid non-zero receipt becomes failed', async () => {
  const harness = createHarness({ receipt: { transactionHash: hash, status: '0x2' } })
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.completions[0].update.status, 'failed')
  assert.equal(harness.completions[0].update.receiptStatus, '2')
})

test('expires only when current block is strictly greater than blockLimit', async () => {
  const atLimit = createHarness({ block: 10 })
  await atLimit.monitor.pollOne(atLimit.watches()[0])
  assert.equal(atLimit.completions.length, 0)
  const beyond = createHarness({ block: 11 })
  await beyond.monitor.pollOne(beyond.watches()[0])
  assert.equal(beyond.completions[0].update.status, 'expired')
})

test('valid receipt wins over an exceeded blockLimit', async () => {
  const harness = createHarness({
    receipt: { transactionHash: hash, status: 0 },
    block: 99,
  })
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.completions[0].update.status, 'success')
})

test('Web3 receipt monitoring never calls FISCO block methods', async () => {
  const harness = createHarness({
    blockLimit: undefined,
    receipt: { transactionHash: hash, status: '0x0', blockNumber: '0xa' },
  })
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.completions[0].update.status, 'success')
})

test('malformed receipt and network errors consume attempts and eventually timeout', async () => {
  const malformed = createHarness({ receipt: {}, maxAttempts: 1 })
  await malformed.monitor.pollOne(malformed.watches()[0])
  assert.equal(malformed.completions[0].update.status, 'timeout')

  const failing = createHarness({
    receipt: () => { throw new Error('offline') },
    block: () => { throw new Error('offline') },
    maxAttempts: 1,
  })
  await failing.monitor.pollOne(failing.watches()[0])
  assert.equal(failing.completions[0].update.status, 'timeout')
})

test('uses fast polling delays before falling back to the durable interval', async () => {
  const harness = createHarness({
    maxAttempts: 10,
    monitorOptions: { fastPollDelaysMs: [2, 2, 5] },
  })

  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.watches()[0].nextCheckAt, 1_002)
  harness.setNow(1_002)
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.watches()[0].nextCheckAt, 1_007)
  harness.setNow(1_007)
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.watches()[0].nextCheckAt, 1_027)
})

test('a monitoring deadline is not shortened by fast polling attempts', async () => {
  const harness = createHarness({
    maxAttempts: 1,
    expiresAt: 1_100,
    monitorOptions: { fastPollDelaysMs: [2] },
  })

  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.completions.length, 0)
  assert.equal(harness.watches()[0].nextCheckAt, 1_020)

  harness.setNow(1_100)
  await harness.monitor.pollOne(harness.watches()[0])
  assert.equal(harness.completions[0].update.status, 'timeout')
  assert.equal(harness.completions[0].update.failureMessage, '交易回执监控超时')
})

test('production defaults schedule a best-effort local wake after two seconds', async () => {
  let now = 1_000
  let timer
  let timerDelay
  let watches = []
  const completions = []
  const monitor = new TransactionMonitor(
    {
      async listWatches() { return watches },
      async track(_activity, watch) { watches = [watch] },
      async saveWatch(watch) { watches = [watch] },
      async complete(activityId, update) {
        completions.push({ activityId, update })
        watches = []
      },
    },
    { async schedule() {} },
    {
      async create() {
        return {
          mode: 'web3',
          async request(request) {
            if (request.method === 'eth_getTransactionReceipt') {
              return { transactionHash: hash, status: 0, blockNumber: 10 }
            }
            if (request.method === 'fisco_getBlockNumber') return 10
            throw new Error(`Unexpected method ${request.method}`)
          },
        }
      },
    },
    {
      now: () => now,
      timing: {
        setTimeout(callback, delayMs) {
          timer = callback
          timerDelay = delayMs
          return 1
        },
        clearTimeout() {},
      },
    },
  )
  const activity = {
    id: 'activity-1',
    hash,
    origin: 'https://dapp.example',
    from: `0x${'11'.repeat(20)}`,
    networkId: network.id,
    networkName: network.name,
    groupId: network.groupId,
    crypto: network.crypto,
    createdAt: new Date(now).toISOString(),
    status: 'submitted',
  }
  await monitor.track(activity, {
    activityId: activity.id,
    hash,
    network,
    blockLimit: '10',
    attempts: 0,
    maxAttempts: 40,
    expiresAt: now + 20 * 60_000,
    nextCheckAt: now + monitor.initialPollDelayMs,
  })

  assert.equal(monitor.initialPollDelayMs, 2_000)
  assert.equal(timerDelay, 2_000)
  now += timerDelay
  timer()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(completions[0].update.status, 'success')
})

test('resume schedules persisted work and duplicate wakeups share one request', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const harness = createHarness({
    receipt: async () => { await gate; return null },
  })
  await harness.monitor.resumePending()
  assert.equal(harness.schedules[0], 1_000)
  const watch = harness.watches()[0]
  const first = harness.monitor.pollOne(watch)
  const second = harness.monitor.pollOne(watch)
  assert.equal(first, second)
  release()
  await Promise.all([first, second])
  assert.equal(harness.watches()[0].attempts, 1)
})

test('an overdue persisted watch is polled when the restored alarm fires', async () => {
  let watches = [{
    activityId: 'overdue',
    hash,
    network,
    blockLimit: '20',
    attempts: 0,
    maxAttempts: 3,
    nextCheckAt: 900,
  }]
  const completions = []
  const scheduled = []
  let alarmHandler
  const repository = {
    async listWatches() { return watches },
    async track() {},
    async saveWatch(watch) { watches = [watch] },
    async complete(activityId, update) {
      completions.push({ activityId, update })
      watches = []
    },
  }
  let monitor
  const scheduler = {
    async schedule(at) {
      scheduled.push(at)
      alarmHandler = at === undefined ? undefined : () => monitor.pollDue()
    },
  }
  monitor = new TransactionMonitor(
    repository,
    scheduler,
    {
      async create(snapshot) {
        assert.deepEqual(snapshot, network)
        return {
          mode: 'legacy',
          async request(request) {
            if (request.method === 'eth_getTransactionReceipt') {
              return { transactionHash: hash, status: 0, blockNumber: 12 }
            }
            if (request.method === 'fisco_getBlockNumber') return 12
            throw new Error(`Unexpected method ${request.method}`)
          },
        }
      },
    },
    { now: () => 1_000 },
  )
  await monitor.resumePending()
  assert.equal(scheduled[0], 900)
  await alarmHandler()
  assert.equal(completions[0].activityId, 'overdue')
  assert.equal(completions[0].update.status, 'success')
  assert.equal(scheduled.at(-1), undefined)
})
