import assert from 'node:assert/strict'
import test from 'node:test'

import {
  broadcastWalletStatusChanged,
  runAndBroadcastWalletStatus,
} from '../src/background/walletStatusBroadcast.ts'
import { handleWalletRequestWithManager } from '../src/background/walletRequestHandler.ts'
import {
  createWalletStatusSynchronizer,
  subscribeToWalletStatusChanges,
} from '../src/popup/walletClient.ts'
import { planWalletStatusTransition } from '../src/popup/walletStatusTransition.ts'
import { createWalletUiActionEpoch } from '../src/popup/walletUiActionEpoch.ts'
import { isWalletStatusChangedEvent } from '../src/shared/walletMessages.ts'

const unlocked = { initialized: true, locked: false }
const locked = { initialized: true, locked: true }
const validSummary = {
  id: 'wallet-1',
  name: '主钱包',
  derivationPath: "m/44'/60'/0'/0",
  derivationScheme: 'bip32-secp256k1-v1',
  wordCount: 12,
  backupConfirmed: true,
  createdAt: '2026-07-30T00:00:00.000Z',
  activeAccountIndex: 0,
  accounts: [{
    index: 0,
    name: '账户 1',
    remark: '',
    addresses: {
      standard: `0x${'11'.repeat(20)}`,
      gm: `0x${'22'.repeat(20)}`,
    },
    publicKeys: {
      standard: `0x${'33'.repeat(64)}`,
      gm: `0x${'44'.repeat(64)}`,
    },
    derivationPath: "m/44'/60'/0'/0/0",
    derivationScheme: 'bip32-secp256k1-v1',
    createdAt: '2026-07-30T00:00:00.000Z',
  }],
}

const installRuntime = () => {
  let listener
  let removed
  globalThis.chrome = {
    runtime: {
      id: 'wallet-extension',
      onMessage: {
        addListener(value) { listener = value },
        removeListener(value) {
          removed = value
          if (listener === value) listener = undefined
        },
      },
    },
  }
  return {
    emit(message, sender = { id: 'wallet-extension' }) {
      return listener?.(message, sender, () => {})
    },
    get listener() { return listener },
    get removed() { return removed },
  }
}

test('wallet status event validator rejects malformed state', () => {
  assert.equal(isWalletStatusChangedEvent({ type: 'OTHER', status: locked }), false)
  assert.equal(
    isWalletStatusChangedEvent({
      type: 'WALLET_STATUS_CHANGED',
      status: { initialized: true, locked: 'yes' },
    }),
    false,
  )
  assert.equal(
    isWalletStatusChangedEvent({ type: 'WALLET_STATUS_CHANGED', status: locked }),
    true,
  )
  assert.equal(
    isWalletStatusChangedEvent({
      type: 'WALLET_STATUS_CHANGED',
      status: { initialized: true, locked: false, summary: validSummary },
    }),
    true,
  )
  for (const summary of [
    { ...validSummary, derivationScheme: 'unknown' },
    { ...validSummary, wordCount: 18 },
    { ...validSummary, backupConfirmed: 'yes' },
    { ...validSummary, accounts: [{ ...validSummary.accounts[0], remark: 1 }] },
    {
      ...validSummary,
      accounts: [{
        ...validSummary.accounts[0],
        addresses: { ...validSummary.accounts[0].addresses, standard: '0x1234' },
      }],
    },
    {
      ...validSummary,
      accounts: [{
        ...validSummary.accounts[0],
        publicKeys: { ...validSummary.accounts[0].publicKeys, gm: 'not-hex' },
      }],
    },
    { ...validSummary, activeAccountIndex: 99 },
  ]) {
    assert.equal(
      isWalletStatusChangedEvent({
        type: 'WALLET_STATUS_CHANGED',
        status: { initialized: true, locked: false, summary },
      }),
      false,
    )
  }
})

test('wallet status subscription filters other extensions and unsubscribes', () => {
  const runtime = installRuntime()
  let calls = 0
  const unsubscribe = subscribeToWalletStatusChanges(() => { calls += 1 })
  const registered = runtime.listener
  runtime.emit({ type: 'UNRELATED' })
  runtime.emit({ type: 'WALLET_STATUS_CHANGED', status: locked }, { id: 'other-extension' })
  runtime.emit({ type: 'WALLET_STATUS_CHANGED', status: locked }, {})
  assert.equal(calls, 0)
  runtime.emit({ type: 'WALLET_STATUS_CHANGED', status: locked })
  assert.equal(calls, 1)
  unsubscribe()
  assert.equal(runtime.removed, registered)
})

test('state-changing operation broadcasts only after success and final status read', async () => {
  const order = []
  const result = await runAndBroadcastWalletStatus(
    async () => { order.push('operation'); return 'result' },
    async () => { order.push('status'); return locked },
    (status) => { order.push('broadcast'); assert.equal(status, locked) },
  )
  assert.equal(result, 'result')
  assert.deepEqual(order, ['operation', 'status', 'broadcast'])

  let broadcasts = 0
  await assert.rejects(
    () => runAndBroadcastWalletStatus(
      async () => { throw new Error('bad password') },
      async () => unlocked,
      () => { broadcasts += 1 },
    ),
    /bad password/,
  )
  assert.equal(broadcasts, 0)
})

test('runtime broadcast adapter sends the internal event and consumes no-listener lastError', () => {
  let sent
  let reads = 0
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        sent = message
        callback()
      },
      get lastError() {
        reads += 1
        return { message: 'Receiving end does not exist' }
      },
    },
  }
  broadcastWalletStatusChanged(locked)
  assert.deepEqual(sent, { type: 'WALLET_STATUS_CHANGED', status: locked })
  assert.equal(reads, 1)
})

test('all state-changing runtime routes broadcast final status and rejected routes do not', async () => {
  const routes = [
    ['WALLET_CREATE_MNEMONIC', 'create', { input: { name: '钱包', wordCount: 12, password: 'password123' } }],
    ['WALLET_RESTORE_MNEMONIC', 'restore', { input: { name: '钱包', mnemonic: 'words', password: 'password123' } }],
    ['WALLET_UNLOCK', 'unlock', { input: { password: 'password123' } }],
    ['WALLET_LOCK', 'lock', {}],
    ['WALLET_RESET', 'reset', { input: { confirmation: '重置钱包' } }],
  ]

  for (const [type, method, extra] of routes) {
    const calls = []
    const manager = {
      async getStatus() { calls.push('getStatus'); return locked },
      async create() { calls.push('create'); return { summary: validSummary, mnemonic: 'words' } },
      async restore() { calls.push('restore'); return { summary: validSummary, mnemonic: 'words' } },
      async confirmBackup() { return validSummary },
      async unlock() { calls.push('unlock'); return unlocked },
      async lock() { calls.push('lock'); return locked },
      async addAccount() { return validSummary },
      async updateAccount() { return validSummary },
      async selectAccount() { return validSummary },
      async deleteAccount() { return validSummary },
      async reset() { calls.push('reset'); return { initialized: false, locked: true } },
    }
    const broadcasts = []
    await handleWalletRequestWithManager(
      { type, ...extra },
      manager,
      (status) => { calls.push('broadcast'); broadcasts.push(status) },
    )
    assert.deepEqual(calls, [method, 'getStatus', 'broadcast'])
    assert.deepEqual(broadcasts, [locked])

    manager[method] = async () => { throw new Error(`${method} failed`) }
    calls.length = 0
    broadcasts.length = 0
    await assert.rejects(
      () => handleWalletRequestWithManager({ type, ...extra }, manager, (status) => broadcasts.push(status)),
      new RegExp(`${method} failed`),
    )
    assert.deepEqual(broadcasts, [])
    assert.deepEqual(calls, [])
  }
})

test('selecting an account broadcasts provider account state only after success', async () => {
  const calls = []
  const manager = {
    async selectAccount() {
      calls.push('selectAccount')
      return validSummary
    },
  }
  const providerEvents = []
  const result = await handleWalletRequestWithManager(
    { type: 'WALLET_SELECT_ACCOUNT', input: { index: 0 } },
    manager,
    () => undefined,
    (changes) => {
      calls.push('broadcast')
      providerEvents.push(changes)
    },
  )
  assert.equal(result, validSummary)
  assert.deepEqual(calls, ['selectAccount', 'broadcast'])
  assert.deepEqual(providerEvents, [['accounts']])

  manager.selectAccount = async () => {
    throw new Error('selection failed')
  }
  await assert.rejects(
    () => handleWalletRequestWithManager(
      { type: 'WALLET_SELECT_ACCOUNT', input: { index: 1 } },
      manager,
      () => undefined,
      (changes) => providerEvents.push(changes),
    ),
    /selection failed/,
  )
  assert.deepEqual(providerEvents, [['accounts']])
})

test('wallet status synchronizer ignores stale out-of-order responses and duplicate events', async () => {
  const runtime = installRuntime()
  const pending = []
  const applied = []
  const synchronizer = createWalletStatusSynchronizer(
    () => new Promise((resolve) => pending.push(resolve)),
    (status, isCurrent) => { if (isCurrent()) applied.push(status) },
  )
  runtime.emit({ type: 'WALLET_STATUS_CHANGED', status: locked })
  runtime.emit({ type: 'WALLET_STATUS_CHANGED', status: unlocked })
  assert.equal(pending.length, 2)
  pending[1](unlocked)
  await Promise.resolve()
  pending[0](locked)
  await Promise.resolve()
  assert.deepEqual(applied, [unlocked])

  synchronizer.dispose()
  runtime.emit({ type: 'WALLET_STATUS_CHANGED', status: locked })
  assert.equal(pending.length, 2)
})

test('locked status signal invalidates UI actions before authoritative status read resolves', () => {
  const runtime = installRuntime()
  const epoch = createWalletUiActionEpoch()
  const startedAt = epoch.capture()
  createWalletStatusSynchronizer(
    () => new Promise(() => {}),
    () => {},
    (event) => {
      if (!event.status.initialized || event.status.locked) epoch.invalidate()
    },
  )
  runtime.emit({ type: 'WALLET_STATUS_CHANGED', status: locked })
  assert.equal(epoch.isCurrent(startedAt), false)
})

test('status transition locks immediately, resets to welcome, and preserves legal forms on unlock', () => {
  const lockTransition = planWalletStatusTransition(locked, 'done')
  assert.deepEqual(lockTransition, {
    targetView: 'unlock',
    clearSensitive: true,
    closeTransientUi: true,
    stopBusy: true,
    clearHome: true,
    refreshHome: false,
  })

  assert.equal(
    planWalletStatusTransition({ initialized: false, locked: true }, 'accounts').targetView,
    'welcome',
  )
  const unlockTransition = planWalletStatusTransition(unlocked, 'unlock')
  assert.equal(unlockTransition.targetView, 'done')
  assert.equal(unlockTransition.refreshHome, true)
  const createTransition = planWalletStatusTransition(unlocked, 'create')
  assert.equal(createTransition.targetView, 'create')
  assert.equal(createTransition.refreshHome, false)
})

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('late wallet, account, network, and home actions cannot commit after remote lock', async () => {
  for (const action of ['create', 'restore', 'confirmation', 'account', 'network', 'home']) {
    const epoch = createWalletUiActionEpoch()
    const response = deferred()
    const state = {
      view: action,
      mnemonic: undefined,
      summary: undefined,
      home: [],
      error: '',
      busy: true,
    }
    const startedAt = epoch.capture()
    const completion = response.promise.then((payload) => {
      epoch.commit(startedAt, () => {
        state.view = payload.view
        state.mnemonic = payload.mnemonic
        state.summary = payload.summary
        state.home = payload.home
        state.error = 'late error'
        state.busy = false
      })
    })

    epoch.invalidate()
    Object.assign(state, {
      view: 'unlock',
      mnemonic: undefined,
      summary: undefined,
      home: [],
      error: '',
      busy: false,
    })
    response.resolve({
      view: action === 'network' ? 'networks' : action === 'account' ? 'accounts' : 'done',
      mnemonic: action === 'create' ? 'sensitive mnemonic' : undefined,
      summary: validSummary,
      home: [{ transactionHash: '0xlate' }],
    })
    await completion

    assert.deepEqual(
      state,
      {
        view: 'unlock',
        mnemonic: undefined,
        summary: undefined,
        home: [],
        error: '',
        busy: false,
      },
      `${action} completion must remain invalid after lock`,
    )
  }
})

test('reset invalidates delayed create mnemonic and all later UI mutations', async () => {
  const epoch = createWalletUiActionEpoch()
  const response = deferred()
  const state = { view: 'create', mnemonic: undefined, summary: undefined, busy: true }
  const startedAt = epoch.capture()
  const completion = response.promise.then((creation) => {
    epoch.commit(startedAt, () => {
      state.view = 'backup'
      state.mnemonic = creation.mnemonic
      state.summary = creation.summary
      state.busy = false
    })
  })

  epoch.invalidate()
  Object.assign(state, {
    view: 'welcome',
    mnemonic: undefined,
    summary: undefined,
    busy: false,
  })
  response.resolve({ mnemonic: 'must never return', summary: validSummary })
  await completion
  assert.deepEqual(state, {
    view: 'welcome',
    mnemonic: undefined,
    summary: undefined,
    busy: false,
  })
})
