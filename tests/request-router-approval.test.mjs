import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestRouter } from '../src/background/requestRouter.ts'
import { PermissionController } from '../src/core/permissions/permissionController.ts'

const origin = 'https://dapp.example'
const gm0 = '0x1111111111111111111111111111111111111111'
const gm1 = '0x2222222222222222222222222222222222222222'
const standard0 = '0x3333333333333333333333333333333333333333'
const standard1 = '0x4444444444444444444444444444444444444444'

const network = {
  id: 'gm',
  name: 'GM chain',
  rpcUrl: 'https://rpc.example',
  mode: 'legacy',
  crypto: 'gm',
  chainId: 1,
  groupId: 'group0',
}

const createConnectRouter = ({
  selected = [0, 1],
  authorized = [],
  activeAccountIndex = 0,
  mutate,
} = {}) => {
  let grants = [...authorized]
  let summary = {
    id: 'wallet-1',
    activeAccountIndex,
    accounts: [
      { index: 0, name: 'Main', remark: '', addresses: { gm: gm0, standard: standard0 } },
      { index: 1, name: 'Ops', remark: 'operations', addresses: { gm: gm1, standard: standard1 } },
    ],
  }
  let activeNetwork = network
  const approvals = []
  const providerEvents = []
  const router = new RequestRouter(
    new PermissionController({
      async get() { return grants },
      async set(_origin, accounts) { grants = [...accounts] },
    }),
    {
      async getSummary() { return summary },
      async selectAccount({ index }) {
        summary = { ...summary, activeAccountIndex: index }
        return summary
      },
    },
    {
      async getAll() { return [activeNetwork] },
      async getActive() { return activeNetwork },
      async setActive(value) { activeNetwork = value },
    },
    undefined,
    undefined,
    {
      async approveConnect(data) {
        approvals.push(data)
        const change = mutate?.({ summary, network: activeNetwork })
        if (change?.summary) summary = change.summary
        if (change?.network) activeNetwork = change.network
        return selected
      },
      async approveTransaction() {},
    },
    undefined,
    (changes) => providerEvents.push(changes),
  )
  return {
    router,
    approvals,
    grants: () => grants,
    providerEvents,
    summary: () => summary,
  }
}

test('connection approval receives every account and grants only selected indexes', async () => {
  const { router, approvals, grants } = createConnectRouter({ selected: [1] })
  assert.deepEqual(await router.request(origin, { method: 'eth_requestAccounts' }), [gm1])
  assert.equal(approvals.length, 1)
  assert.deepEqual(approvals[0].accounts.map((account) => account.index), [0, 1])
  assert.deepEqual(approvals[0].accounts.map((account) => account.address), [gm0, gm1])
  assert.deepEqual(grants(), [gm1])
})

test('existing valid authorization bypasses connection approval', async () => {
  const { router, approvals } = createConnectRouter({ authorized: [gm0] })
  assert.deepEqual(await router.request(origin, { method: 'eth_requestAccounts' }), [gm0])
  assert.equal(approvals.length, 0)
})

test('authorized accounts expose the active account first', async () => {
  const { router } = createConnectRouter({
    authorized: [gm0, gm1],
    activeAccountIndex: 1,
  })
  assert.deepEqual(await router.request(origin, { method: 'eth_accounts' }), [gm1, gm0])
})

test('wallet_switchAccount selects an authorized account and broadcasts the new order', async () => {
  const { router, providerEvents, summary } = createConnectRouter({
    authorized: [gm0, gm1],
  })
  assert.equal(
    await router.request(origin, {
      method: 'wallet_switchAccount',
      params: [{ account: gm1 }],
    }),
    null,
  )
  assert.equal(summary().activeAccountIndex, 1)
  assert.deepEqual(providerEvents, [['accounts']])
  assert.deepEqual(await router.request(origin, { method: 'eth_accounts' }), [gm1, gm0])
})

test('wallet_switchAccount rejects accounts not authorized for the requesting origin', async () => {
  const { router, providerEvents, summary } = createConnectRouter({
    authorized: [gm0],
  })
  await assert.rejects(
    () => router.request(origin, {
      method: 'wallet_switchAccount',
      params: [{ account: gm1 }],
    }),
    (error) => error.code === 4100,
  )
  assert.equal(summary().activeAccountIndex, 0)
  assert.deepEqual(providerEvents, [])
})

test('empty and forged connection selections never write permission', async () => {
  for (const selected of [[], [99], [0, 0]]) {
    const { router, grants } = createConnectRouter({ selected })
    await assert.rejects(router.request(origin, { method: 'eth_requestAccounts' }))
    assert.deepEqual(grants(), [])
  }
})

test('connection approval fails when network or account snapshot changes', async () => {
  const networkChanged = createConnectRouter({
    selected: [0],
    mutate: ({ network }) => ({ network: { ...network, id: 'other' } }),
  })
  await assert.rejects(
    networkChanged.router.request(origin, { method: 'eth_requestAccounts' }),
    /network changed/,
  )
  assert.deepEqual(networkChanged.grants(), [])

  const accountChanged = createConnectRouter({
    selected: [0],
    mutate: ({ summary }) => ({
      summary: {
        ...summary,
        accounts: summary.accounts.map((account) =>
          account.index === 0
            ? { ...account, addresses: { ...account.addresses, gm: gm1 } }
            : account,
        ),
      },
    }),
  })
  await assert.rejects(
    accountChanged.router.request(origin, { method: 'eth_requestAccounts' }),
    /accounts changed/,
  )
  assert.deepEqual(accountChanged.grants(), [])
})

test('first connection fails closed when approval gateway is unavailable', async () => {
  let grants = []
  const router = new RequestRouter(
    new PermissionController({
      async get() { return grants },
      async set(_origin, accounts) { grants = [...accounts] },
    }),
    {
      async getSummary() {
        return {
          activeAccountIndex: 0,
          accounts: [
            { index: 0, name: 'Main', remark: '', addresses: { gm: gm0, standard: standard0 } },
          ],
        }
      },
    },
    {
      async getAll() { return [network] },
      async getActive() { return network },
      async setActive() {},
    },
  )

  await assert.rejects(
    router.request(origin, { method: 'eth_requestAccounts' }),
    (error) => error.code === 4900 && error.message.includes('approval service'),
  )
  assert.deepEqual(grants, [])
})
