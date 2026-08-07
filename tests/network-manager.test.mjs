import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractConfigValue,
  extractGroupIds,
  isBillingEnabled,
  NetworkManager,
  readWeb3ChainId,
} from '../src/core/networks/networkManager.ts'

class MemoryNetworkRepository {
  constructor(networks = [], active) {
    this.networks = [...networks]
    this.active = active
  }

  async getAll() {
    return [...this.networks]
  }

  async getActive() {
    return this.active
  }

  async setActive(network) {
    this.active = network
  }

  async add(network) {
    this.networks.push(network)
    this.active = network
  }

  async update(network) {
    this.networks = this.networks.map((candidate) =>
      candidate.id === network.id ? network : candidate,
    )
    if (this.active?.id === network.id) this.active = network
  }

  async delete(id) {
    this.networks = this.networks.filter((network) => network.id !== id)
  }
}

const input = {
  name: ' 测试链 ',
  url: 'https://node.example.test',
  mode: 'legacy',
  groupId: 'group1',
  isGM: true,
  billingEnabled: true,
}

const validatedTransport = (compatibilityVersion = '3.14.0') => ({
  async request(method, params) {
    if (method === 'getGroupInfoList') return ['group0', 'group1']
    if (method === 'getSystemConfigByKey' && params?.[0] === 'feature_balance') return true
    return compatibilityVersion
  },
})

test('extracts exact group IDs and common system config response shapes', () => {
  assert.deepEqual(extractGroupIds(['group1', 'group10']), ['group1', 'group10'])
  assert.deepEqual(
    extractGroupIds([{ groupId: 'group0' }, { groupID: 'group1' }, { id: 2 }]),
    ['group0', 'group1', '2'],
  )
  assert.deepEqual(extractGroupIds({ groupInfoList: [{ groupId: 'group2' }] }), ['group2'])
  assert.equal(extractConfigValue({ compatibility_version: '3.14.0' }), '3.14.0')
  assert.equal(extractConfigValue({ value: '3.9.1' }), '3.9.1')
})

test('accepts only explicit feature_balance enable values', () => {
  for (const enabled of [1, true, '1', 'true', 'ON', 'enable', { value: 'enabled' }]) {
    assert.equal(isBillingEnabled(enabled), true)
  }
  for (const disabled of [0, false, '0', 'false', 'off', 'unknown', {}, null]) {
    assert.equal(isBillingEnabled(disabled), false)
  }
})

test('rejects an unknown RPC mode before probing the endpoint', async () => {
  let probed = false
  const manager = new NetworkManager(
    new MemoryNetworkRepository(),
    () => {
      probed = true
      return validatedTransport()
    },
  )
  await assert.rejects(() => manager.add({...input, mode: 'unknown'}), /RPC 类型/)
  assert.equal(probed, false)
})

test('probes exact RPC methods in order and persists the validated active network', async () => {
  const repository = new MemoryNetworkRepository()
  const calls = []
  const responses = [['group0', { groupID: 'group1' }], { value: '3.14.0' }, 'true']
  let transportArgs
  const manager = new NetworkManager(
    repository,
    (endpoint, allowInsecureLocalhost) => {
      transportArgs = [endpoint, allowInsecureLocalhost]
      return {
        async request(method, params) {
          calls.push([method, params])
          return responses.shift()
        },
      }
    },
    () => 'network-test',
  )

  const network = await manager.add(input)

  assert.deepEqual(calls, [
    ['getGroupInfoList', []],
    ['getSystemConfigByKey', ['compatibility_version']],
    ['getSystemConfigByKey', ['feature_balance']],
  ])
  assert.deepEqual(transportArgs, ['https://node.example.test', false])
  assert.equal(network.id, 'network-test')
  assert.equal(network.name, '测试链')
  assert.equal(network.crypto, 'gm')
  assert.equal(network.groupId, 'group1')
  assert.equal(network.mode, 'legacy')
  assert.equal(network.chainId, 1)
  assert.equal(network.legacyParamStyle, 'endpoint-scoped')
  assert.equal(network.compatibilityVersion, '3.14.0')
  assert.equal(network.billingEnabled, true)
  assert.equal(network.balanceDecimals, 18)
  assert.equal(network.balanceToken, 'FBT')
  assert.equal(repository.active, network)
  assert.deepEqual(repository.networks, [network])
})

test('validates a Web3 RPC and persists its configured chain ID without a group', async () => {
  const repository = new MemoryNetworkRepository()
  const calls = []
  const manager = new NetworkManager(
    repository,
    () => ({
      async request(method, params) {
        calls.push([method, params])
        if (method === 'eth_chainId') return '0x4e20'
        return '0x2a'
      },
    }),
    () => 'web3',
  )

  const {groupId: _groupId, ...web3Input} = input
  const network = await manager.add({...web3Input, mode: 'web3', chainId: 20_000, isGM: false})

  assert.equal(network.mode, 'web3')
  assert.equal(network.chainId, 20_000)
  assert.equal(network.groupId, undefined)
  assert.equal(Object.hasOwn(network, 'groupId'), false)
  assert.equal(network.compatibilityVersion, undefined)
  assert.equal(network.legacyParamStyle, undefined)
  assert.deepEqual(calls, [
    ['eth_chainId', []],
    ['eth_blockNumber', []],
  ])
})

test('rejects malformed or mismatched Web3 chain IDs', async () => {
  assert.equal(readWeb3ChainId('0x1'), 1)
  for (const value of ['1', '0x', '0x01', '0x0', null]) {
    assert.throws(() => readWeb3ChainId(value), /chainId|eth_chainId/)
  }

  const manager = new NetworkManager(
    new MemoryNetworkRepository(),
    () => ({
      request: async (method) => method === 'eth_chainId' ? '0x2' : '0x1',
    }),
    () => 'unused',
  )
  const {groupId: _groupId, ...web3Input} = input
  await assert.rejects(
    () => manager.add({...web3Input, mode: 'web3', chainId: 1, isGM: false}),
    /返回的 Chain ID 为 2/,
  )
  await assert.rejects(
    () => manager.add({...web3Input, mode: 'web3', chainId: 1.5, isGM: false}),
    /有效的 Chain ID/,
  )
})

test('rejects Web3 with GM before transport or persistence', async () => {
  const repository = new MemoryNetworkRepository()
  let transportCreated = false
  const manager = new NetworkManager(repository, () => {
    transportCreated = true
    return validatedTransport()
  })
  const {groupId: _groupId, ...web3Input} = input

  await assert.rejects(
    () => manager.add({...web3Input, mode: 'web3', chainId: 20_000}),
    /Web3 RPC 不支持 SM2\/SM3.*标准密码体系.*原生 RPC/,
  )
  assert.equal(transportCreated, false)
  assert.deepEqual(repository.networks, [])
  assert.equal(repository.active, undefined)
})

test('does not fuzzy-match a missing group or persist a rejected network', async () => {
  const repository = new MemoryNetworkRepository()
  const manager = new NetworkManager(
    repository,
    () => ({ request: async () => ['group10'] }),
    () => 'unused',
  )

  await assert.rejects(() => manager.add(input), /未返回群组 group1/)
  assert.equal(repository.active, undefined)
})

test('checks feature_balance only when requested and rejects a disabled node', async () => {
  const repository = new MemoryNetworkRepository()
  const methods = []
  const manager = new NetworkManager(
    repository,
    () => ({
      async request(method) {
        methods.push(method)
        if (method === 'getGroupInfoList') return ['group1']
        if (methods.length === 2) return '3.9.0'
        return 'off'
      },
    }),
    () => 'unused',
  )

  await assert.rejects(() => manager.add(input), /未开启计费功能/)
  assert.deepEqual(methods, [
    'getGroupInfoList',
    'getSystemConfigByKey',
    'getSystemConfigByKey',
  ])
  assert.equal(repository.active, undefined)

  methods.length = 0
  const saved = await manager.add({ ...input, billingEnabled: false })
  assert.equal(saved.billingEnabled, false)
  assert.equal(saved.balanceDecimals, undefined)
  assert.equal(saved.balanceToken, undefined)
  assert.deepEqual(methods, ['getGroupInfoList', 'getSystemConfigByKey'])
})

test('normalizes custom balance display settings and rejects invalid decimals', async () => {
  const repository = new MemoryNetworkRepository()
  const manager = new NetworkManager(repository, () => validatedTransport(), () => 'balance')

  const saved = await manager.add({
    ...input,
    balanceDecimals: 6,
    balanceToken: '  GAS  ',
  })
  assert.equal(saved.balanceDecimals, 6)
  assert.equal(saved.balanceToken, 'GAS')

  await assert.rejects(
    () => manager.update({...input, id: saved.id, balanceDecimals: 1.5}),
    /0 到 255 之间的整数/,
  )
})

test('automatically allows HTTP only for loopback endpoints', async () => {
  let allowInsecureLocalhost
  const manager = new NetworkManager(
    new MemoryNetworkRepository(),
    (_endpoint, allow) => {
      allowInsecureLocalhost = allow
      return {
        async request(method) {
          return method === 'getGroupInfoList' ? ['group1'] : '3.10.0'
        },
      }
    },
    () => 'local',
  )

  await manager.add({ ...input, url: 'http://127.0.0.1:8545', billingEnabled: false })
  assert.equal(allowInsecureLocalhost, true)
})

test('rejects duplicate normalized RPC URL and group ID without writing', async () => {
  const repository = new MemoryNetworkRepository()
  let id = 0
  const manager = new NetworkManager(repository, () => validatedTransport(), () => `n${++id}`)
  await manager.add({
    ...input,
    url: 'https://NODE.example.test/',
    billingEnabled: false,
  })

  await assert.rejects(
    () =>
      manager.add({
        ...input,
        name: '允许重名但不允许同端点群组',
        url: 'https://node.example.test',
        billingEnabled: false,
      }),
    /相同 RPC URL 和群组 ID/,
  )
  assert.equal(repository.networks.length, 1)
})

test('editing re-probes, preserves id, and synchronizes the active network', async () => {
  const repository = new MemoryNetworkRepository()
  const calls = []
  const manager = new NetworkManager(
    repository,
    () => ({
      async request(method, params) {
        calls.push([method, params])
        if (method === 'getGroupInfoList') return ['group1']
        return '3.15.0'
      },
    }),
    () => 'edit-me',
  )
  const original = await manager.add({ ...input, billingEnabled: false })
  calls.length = 0

  const updated = await manager.update({
    ...input,
    id: original.id,
    name: '更新后的网络',
    billingEnabled: false,
  })

  assert.equal(updated.id, 'edit-me')
  assert.equal(updated.name, '更新后的网络')
  assert.equal(updated.compatibilityVersion, '3.15.0')
  assert.equal(repository.active, updated)
  assert.equal(repository.networks[0], updated)
  assert.deepEqual(calls, [
    ['getGroupInfoList', []],
    ['getSystemConfigByKey', ['compatibility_version']],
  ])
})

test('a failed edit leaves the original network and active selection unchanged', async () => {
  const repository = new MemoryNetworkRepository()
  let acceptGroup = true
  const manager = new NetworkManager(
    repository,
    () => ({
      async request(method) {
        if (method === 'getGroupInfoList') return acceptGroup ? ['group1'] : ['group10']
        return '3.14.0'
      },
    }),
    () => 'stable',
  )
  const original = await manager.add({ ...input, billingEnabled: false })
  acceptGroup = false

  await assert.rejects(
    () =>
      manager.update({
        ...input,
        id: original.id,
        name: '不应保存',
        billingEnabled: false,
      }),
    /未返回群组 group1/,
  )
  assert.equal(repository.networks[0], original)
  assert.equal(repository.active, original)
})

test('switches active and deletes only non-active networks', async () => {
  const repository = new MemoryNetworkRepository()
  let id = 0
  const manager = new NetworkManager(repository, () => validatedTransport(), () => `n${++id}`)
  const first = await manager.add({ ...input, billingEnabled: false })
  const second = await manager.add({
    ...input,
    name: '第二网络',
    url: 'https://second.example.test',
    billingEnabled: false,
  })
  assert.equal(repository.active, second)

  assert.equal(await manager.setActive(first.id), first)
  assert.equal(repository.active, first)
  await assert.rejects(() => manager.delete(first.id), /当前网络不能删除/)

  const remaining = await manager.delete(second.id)
  assert.deepEqual(remaining, [first])
  assert.deepEqual(repository.networks, [first])
})

test('edit, delete, and switch reject unknown network IDs', async () => {
  const manager = new NetworkManager(
    new MemoryNetworkRepository(),
    () => validatedTransport(),
    () => 'unused',
  )
  await assert.rejects(() => manager.setActive('missing'), /网络不存在：missing/)
  await assert.rejects(() => manager.delete('missing'), /网络不存在：missing/)
  await assert.rejects(
    () => manager.update({ ...input, id: 'missing', billingEnabled: false }),
    /网络不存在：missing/,
  )
})
