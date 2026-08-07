import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestRouter } from '../src/background/requestRouter.ts'
import { PermissionController } from '../src/core/permissions/permissionController.ts'

const origin = 'https://dapp.example'
const group0 = {
  id: 'group0', name: 'Group 0', rpcUrl: 'https://rpc.example', mode: 'legacy',
  crypto: 'standard', chainId: 1, groupId: 'group0',
}
const web3 = {
  id: 'web3', name: 'Web3 20200', rpcUrl: 'https://web3.example', mode: 'web3',
  crypto: 'standard', chainId: 20_200,
}
const group1 = {...group0, id: 'group1', name: 'Group 1', groupId: 'group1'}

const createRouter = (approveSwitch) => {
  let active = group0
  const events = []
  const router = new RequestRouter(
    new PermissionController({ async get() { return [] }, async set() {} }),
    { async getSummary() { return {activeAccountIndex: 0, accounts: []} }, async selectAccount() {} },
    {
      async getAll() { return [group0, group1, web3] },
      async getActive() { return active },
      async setActive(network) { active = network },
    },
    undefined,
    undefined,
    { async approveConnect() { return [] }, async approveTransaction() {}, approveSwitch },
    undefined,
    (changes) => events.push(changes),
  )
  return {router, active: () => active, events}
}

test('wallet_switchEthereumChain asks for approval before switching and broadcasting', async () => {
  const approvals = []
  const {router, active, events} = createRouter(async (data) => approvals.push(data))

  assert.equal(await router.request(origin, {
    method: 'wallet_switchEthereumChain',
    params: [{chainId: '0x4ee8'}],
  }), null)
  assert.equal(active().id, 'web3')
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0].requestType, 'chain')
  assert.equal(approvals[0].currentNetwork.id, 'group0')
  assert.equal(approvals[0].network.id, 'web3')
  assert.deepEqual(events, [['chain', 'group', 'accounts']])
})

test('rejected chain switches do not change the active network', async () => {
  const rejection = Object.assign(new Error('User rejected the request'), {code: 4001})
  const {router, active, events} = createRouter(async () => { throw rejection })

  await assert.rejects(
    router.request(origin, {method: 'wallet_switchEthereumChain', params: [{chainId: '0x4ee8'}]}),
    (error) => error.code === 4001,
  )
  assert.equal(active().id, 'group0')
  assert.deepEqual(events, [])
})

test('wallet_switchGroup also requires approval before changing groups', async () => {
  const rejection = Object.assign(new Error('User rejected the request'), {code: 4001})
  const {router, active, events} = createRouter(async () => { throw rejection })

  await assert.rejects(
    router.request(origin, {method: 'wallet_switchGroup', params: [{groupId: 'group1'}]}),
    (error) => error.code === 4001,
  )
  assert.equal(active().id, 'group0')
  assert.deepEqual(events, [])
})

test('chain switching rejects malformed and unknown chain IDs', async () => {
  const {router} = createRouter(async () => {})
  await assert.rejects(
    router.request(origin, {method: 'wallet_switchEthereumChain', params: [{chainId: '20200'}]}),
    (error) => error.code === -32602,
  )
  await assert.rejects(
    router.request(origin, {method: 'wallet_switchEthereumChain', params: [{chainId: '0x2'}]}),
    (error) => error.code === 4902,
  )
})
