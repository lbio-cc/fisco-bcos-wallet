import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ApprovalController,
  isExpectedApprovalPage,
} from '../src/background/approvalController.ts'

const connectData = (origin = 'https://dapp.example') => ({
  kind: 'connect',
  origin,
  network: {
    id: 'gm',
    name: 'GM',
    rpcUrl: 'https://rpc.example',
    groupId: 'group0',
    chainId: 1,
    crypto: 'gm',
  },
  accounts: [],
})

const transactionData = (origin = 'https://dapp.example') => ({
  kind: 'transaction',
  origin,
  network: {
    id: 'gm',
    name: 'GM',
    rpcUrl: 'https://rpc.example',
    groupId: 'group0',
    chainId: 1,
    crypto: 'gm',
  },
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: '0x0',
  data: '0x',
  dataBytes: 0,
})

const switchData = (origin = 'https://dapp.example') => ({
  kind: 'switch',
  origin,
  requestType: 'group',
  currentNetwork: connectData().network,
  network: { ...connectData().network, id: 'gm-1', groupId: 'group1' },
})

const createHarness = (timeout = 1000, maxLifetime = timeout * 6, timing) => {
  let nextWindow = 1
  let removed
  const created = []
  const closed = []
  const controller = new ApprovalController(
    {
      async create(url) {
        const id = nextWindow++
        created.push({ id, url })
        return id
      },
      async close(id) { closed.push(id) },
      onRemoved(listener) { removed = listener },
    },
    timeout,
    (() => {
      let id = 0
      return () => `token-${++id}`
    })(),
    maxLifetime,
    timing,
  )
  return { controller, created, closed, remove: (id) => removed(id) }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const createFakeTiming = () => {
  let now = 0
  let nextTimer = 0
  const timers = new Map()
  const timing = {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = ++nextTimer
      timers.set(id, { at: now + delayMs, callback })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
  }
  const advance = (milliseconds) => {
    const target = now + milliseconds
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!due) break
      const [id, timer] = due
      timers.delete(id)
      now = timer.at
      timer.callback()
    }
    now = target
  }
  return { timing, advance }
}

test('approves, rejects and ignores unknown or duplicate decisions', async () => {
  const { controller, created, closed } = createHarness()
  const approved = controller.approveConnect(connectData())
  await tick()
  assert.match(created[0].url, /^connect-approval\.html\?approval=token-1$/)
  assert.equal(controller.resolve('unknown', 'connect', true, [0]), false)
  assert.equal(controller.resolve('token-1', 'connect', true, [0, 1]), true)
  assert.equal(controller.resolve('token-1', 'connect', false), false)
  assert.deepEqual(await approved, [0, 1])
  assert.deepEqual(closed, [1])

  const rejected = controller.approveTransaction(transactionData())
  await tick()
  assert.equal(controller.resolve('token-2', 'transaction', false), true)
  await assert.rejects(rejected, (error) => error.code === 4001)
})

test('window close and timeout reject with provider code 4001', async () => {
  const closedHarness = createHarness()
  const closedRequest = closedHarness.controller.approveTransaction(transactionData())
  await tick()
  closedHarness.remove(1)
  await assert.rejects(closedRequest, (error) => error.code === 4001)

  const timeoutHarness = createHarness(5)
  const timedOut = timeoutHarness.controller.approveTransaction(transactionData())
  await assert.rejects(timedOut, (error) => error.code === 4001)
})

test('matching heartbeat renews the active expiry timer but cannot exceed maximum lifetime', async () => {
  const renewedClock = createFakeTiming()
  const renewed = createHarness(50, 300, renewedClock.timing)
  const renewedRequest = renewed.controller.approveTransaction(transactionData())
  const renewedRejection = assert.rejects(renewedRequest, (error) => error.code === 4001)
  await tick()
  renewedClock.advance(30)
  assert.equal(renewed.controller.heartbeat('token-1', 'transaction'), true)
  assert.equal(renewed.controller.heartbeat('token-1', 'connect'), false)
  renewedClock.advance(30)
  assert.ok(renewed.controller.get('token-1', 'transaction'))
  renewedClock.advance(20)
  await renewedRejection

  const cappedClock = createFakeTiming()
  const capped = createHarness(40, 65, cappedClock.timing)
  const cappedRequest = capped.controller.approveTransaction(transactionData())
  const cappedRejection = assert.rejects(cappedRequest, (error) => error.code === 4001)
  await tick()
  cappedClock.advance(25)
  assert.equal(capped.controller.heartbeat('token-1', 'transaction'), true)
  cappedClock.advance(25)
  assert.equal(capped.controller.heartbeat('token-1', 'transaction'), true)
  cappedClock.advance(15)
  await cappedRejection
  assert.equal(capped.controller.heartbeat('token-1', 'transaction'), false)
})

test('FIFO queue and same-origin connect deduplication are enforced', async () => {
  const { controller, created } = createHarness()
  const connect1 = controller.approveConnect(connectData())
  const connect2 = controller.approveConnect(connectData())
  const transaction = controller.approveTransaction(transactionData())
  assert.equal(connect1, connect2)
  await tick()
  assert.equal(created.length, 1)
  controller.resolve('token-1', 'connect', true, [0])
  assert.deepEqual(await connect1, [0])
  await tick()
  assert.equal(created.length, 2)
  assert.match(created[1].url, /^transaction-approval/)
  controller.resolve('token-2', 'transaction', true)
  await transaction
})

test('network switch approvals use their dedicated trusted page', async () => {
  const { controller, created } = createHarness()
  const request = controller.approveSwitch(switchData())
  await tick()
  assert.match(created[0].url, /^switch-approval\.html\?approval=token-1$/)
  assert.equal(controller.resolve('token-1', 'switch', true), true)
  await request
})

test('same-origin connect requests with different network snapshots are not deduplicated', async () => {
  const { controller, created } = createHarness()
  const first = controller.approveConnect(connectData())
  const second = controller.approveConnect({
    ...connectData(),
    network: {
      ...connectData().network,
      id: 'standard',
      groupId: 'group1',
      crypto: 'standard',
    },
  })
  assert.notEqual(first, second)
  await tick()
  assert.equal(created.length, 1)
  controller.resolve('token-1', 'connect', true, [0])
  await first
  await tick()
  assert.equal(created.length, 2)
  assert.match(created[1].url, /^connect-approval/)
  controller.resolve('token-2', 'connect', true, [0])
  await second
})

test('resolve and window removal race settles exactly once', async () => {
  const { controller, remove } = createHarness()
  const request = controller.approveTransaction(transactionData())
  await tick()
  assert.equal(controller.resolve('token-1', 'transaction', true), true)
  remove(1)
  await request
  assert.equal(controller.resolve('token-1', 'transaction', false), false)
  assert.equal(controller.get('token-1', 'transaction'), undefined)
})

test('only the matching approval page in this extension is trusted', () => {
  const runtimeId = 'wallet-extension-id'
  const root = `chrome-extension://${runtimeId}/`
  assert.equal(
    isExpectedApprovalPage(
      { id: runtimeId, url: `${root}connect-approval.html?approval=token-1` },
      'connect',
      runtimeId,
      root,
    ),
    true,
  )
  assert.equal(
    isExpectedApprovalPage(
      { id: runtimeId, url: `${root}switch-approval.html?approval=token-2` },
      'switch',
      runtimeId,
      root,
    ),
    true,
  )
  for (const sender of [
    { id: 'other-extension', url: `${root}connect-approval.html` },
    { id: runtimeId, url: `${root}transaction-approval.html` },
    { id: runtimeId, url: `${root}index.html` },
    { id: runtimeId, url: 'https://dapp.example/connect-approval.html' },
    { id: runtimeId },
  ]) {
    assert.equal(isExpectedApprovalPage(sender, 'connect', runtimeId, root), false)
  }
})
