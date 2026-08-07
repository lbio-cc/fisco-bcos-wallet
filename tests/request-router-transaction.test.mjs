import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestRouter } from '../src/background/requestRouter.ts'
import { TransactionMonitor } from '../src/background/transactionMonitor.ts'
import { PermissionController } from '../src/core/permissions/permissionController.ts'

const origin = 'https://dapp.example'
const from = '0x1111111111111111111111111111111111111111'
const to = '0x435407f2be59a102edc42077027b92093349d4c7'
const transactionHash = `0x${'ab'.repeat(32)}`
const rawTransaction = `0x${'12'.repeat(64)}`

const groupInfo = {
  chainID: 'chain0',
  groupID: 'testchain',
  nodeList: [
    {
      iniConfig: JSON.stringify({ isWasm: false, smCryptoType: true }),
      protocol: { compatibilityVersion: 50462720 },
    },
  ],
}

const network = {
  id: 'gm',
  name: 'GM chain',
  rpcUrl: 'https://rpc.example',
  mode: 'legacy',
  crypto: 'gm',
  chainId: 1,
  groupId: 'testchain',
}

const autoApprove = {
  async approveConnect(data) {
    return data.accounts.map((account) => account.index)
  },
  async approveTransaction() {},
  async approveSwitch() {},
}

const createRouter = (activityStore, approvals = autoApprove, options = {}) => {
  const adapterCalls = []
  const signingCalls = []
  const adapter = {
    mode: options.adapterMode ?? 'legacy',
    async request(request) {
      adapterCalls.push(request)
      if (request.method === 'fisco_getGroupInfo') return options.getGroupInfo?.() ?? groupInfo
      if (request.method === 'fisco_getBlockNumber') return 40
      if (request.method === 'eth_chainId') return '0x4ee8'
      if (request.method === 'eth_getTransactionCount') return '0x2'
      if (request.method === 'eth_gasPrice') return '0x3'
      if (request.method === 'eth_estimateGas') return '0x5208'
      if (request.method === 'eth_sendRawTransaction') {
        return { transactionHash, status: 0 }
      }
      throw new Error(`Unexpected method: ${request.method}`)
    },
  }
  const wallet = {
    async getSummary() {
      return {
        activeAccountIndex: 0,
        accounts: [
          {
            index: 0,
            addresses: {
              standard: options.network?.crypto === 'standard'
                ? from
                : '0x2222222222222222222222222222222222222222',
              gm: from,
            },
          },
        ],
      }
    },
    async signFiscoV0Transaction(address, data, crypto) {
      signingCalls.push({ address, data, crypto })
      return { rawTransaction, transactionHash }
    },
    async signWeb3Transaction(address, data) {
      signingCalls.push({ address, data, web3: true })
      return { rawTransaction, transactionHash }
    },
  }
  const permissions = new PermissionController({
    async get() {
      return [from]
    },
    async set() {},
  })
  const networks = {
    async getAll() {
      return [options.network ?? network]
    },
    async getActive() {
      return options.network ?? network
    },
    async setActive() {},
  }
  const adapters = {
    async create() {
      return adapter
    },
  }
  return {
    router: new RequestRouter(
      permissions,
      wallet,
      networks,
      adapters,
      activityStore,
      approvals,
      options.transactionTracker,
    ),
    adapterCalls,
    signingCalls,
  }
}

test('exposes only the compatibility version through wallet_getCompatibilityVersion', async () => {
  const { router } = createRouter()
  assert.equal(
    await router.request(origin, { method: 'wallet_getCompatibilityVersion' }),
    '3.2.0',
  )
})

test('exposes the selected RPC transport through wallet_getMode', async () => {
  const native = createRouter()
  assert.equal(await native.router.request(origin, {method: 'wallet_getMode'}), 'native')
  assert.deepEqual(native.adapterCalls, [])

  const web3 = createRouter(undefined, autoApprove, {
    network: {
      ...network,
      mode: 'web3',
      chainId: 20_000,
      groupId: undefined,
    },
  })
	assert.equal(await web3.router.request(origin, {method: 'wallet_getMode'}), 'web3')
	assert.deepEqual(web3.adapterCalls, [])
})

test('builds, signs and sends an endpoint-scoped FISCO V0 transaction', async () => {
  const { router, adapterCalls, signingCalls } = createRouter()
  const result = await router.request(origin, {
    method: 'eth_sendTransaction',
    params: [{ from, to, data: '0x1234', value: '0x0' }],
  })

  assert.equal(result, transactionHash)
  assert.equal(signingCalls.length, 1)
  assert.equal(signingCalls[0].address, from)
  assert.equal(signingCalls[0].crypto, 'gm')
  assert.equal(signingCalls[0].data.version, 0)
  assert.equal(signingCalls[0].data.chainID, 'chain0')
  assert.equal(signingCalls[0].data.groupID, 'testchain')
  assert.equal(signingCalls[0].data.blockLimit, 540n)
  assert.equal(Buffer.from(signingCalls[0].data.input).toString('hex'), '1234')
  assert.match(signingCalls[0].data.nonce, /^[1-9][0-9]{39}$/)
  assert.deepEqual(adapterCalls.at(-1), {
    method: 'eth_sendRawTransaction',
    params: [rawTransaction, false],
  })
})

test('builds, signs and broadcasts an EIP-155 transaction on Web3 RPC', async () => {
  const web3Network = {
    ...network,
    id: 'web3',
    name: 'Web3 chain',
    mode: 'web3',
    crypto: 'standard',
    chainId: 20_200,
    groupId: undefined,
  }
  const { router, adapterCalls, signingCalls } = createRouter(undefined, autoApprove, {
    network: web3Network,
    adapterMode: 'web3',
  })

  const result = await router.request(origin, {
    method: 'eth_sendTransaction',
    params: [{ from, to, data: '0x1234', value: '0x0' }],
  })

  assert.equal(result, transactionHash)
  assert.deepEqual(adapterCalls.slice(0, 4), [
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getTransactionCount', params: [from, 'pending'] },
    { method: 'eth_gasPrice', params: [] },
    {
      method: 'eth_estimateGas',
      params: [{ from, to, data: '0x1234', value: '0x0' }],
    },
  ])
  assert.deepEqual(adapterCalls.at(-1), {
    method: 'eth_sendRawTransaction',
    params: [rawTransaction],
  })
  assert.equal(adapterCalls.some((call) => call.method.startsWith('fisco_')), false)
  assert.equal(signingCalls.length, 1)
  assert.equal(signingCalls[0].web3, true)
  assert.deepEqual(signingCalls[0].data, {
    nonce: 2n,
    gasPrice: 3n,
    gasLimit: 21_000n,
    to,
    value: 0n,
    data: '0x1234',
    chainId: 20_200n,
  })
})

test('rejects GM Web3 transactions before signing or node RPC calls', async () => {
  const { router, adapterCalls, signingCalls } = createRouter(undefined, autoApprove, {
    network: {...network, mode: 'web3', chainId: 20_200, groupId: undefined},
    adapterMode: 'web3',
  })

  await assert.rejects(
    router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to }],
    }),
    (error) => error.code === 4200 && error.message.includes('GM Web3'),
  )
  assert.deepEqual(adapterCalls, [])
  assert.deepEqual(signingCalls, [])
})

test('records a successfully submitted transaction in activity storage', async () => {
  const activities = []
  const approvals = []
  const { router } = createRouter(
    {
      async add(activity) {
        activities.push(activity)
      },
    },
    {
      async approveConnect() {
        throw new Error('Unexpected connect approval')
      },
      async approveTransaction(approval) {
        approvals.push(approval)
      },
    },
  )

  const before = Date.now()
  const result = await router.request(origin, {
    method: 'eth_sendTransaction',
    params: [{ from, to, data: '0x1234' }],
  })

  assert.equal(result, transactionHash)
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0].from, from)
  assert.equal(approvals[0].to, to)
  assert.equal(approvals[0].selector, undefined)
  assert.equal(activities.length, 1)
  assert.deepEqual(
    {
      hash: activities[0].hash,
      origin: activities[0].origin,
      from: activities[0].from,
      to: activities[0].to,
      networkId: activities[0].networkId,
      networkName: activities[0].networkName,
      groupId: activities[0].groupId,
      crypto: activities[0].crypto,
      status: activities[0].status,
    },
    {
      hash: transactionHash,
      origin,
      from,
      to,
      networkId: 'gm',
      networkName: 'GM chain',
      groupId: 'testchain',
      crypto: 'gm',
      status: 'submitted',
    },
  )
  assert.match(activities[0].id, new RegExp(`^[0-9]+-${transactionHash}$`))
  assert.ok(Date.parse(activities[0].createdAt) >= before)
})

test('returns the submitted hash when activity storage fails', async () => {
  const { router } = createRouter({
    async add() {
      throw new Error('storage unavailable')
    },
  })

  assert.equal(
    await router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to }],
    }),
    transactionHash,
  )
})

test('persists the actual blockLimit and schedules receipt monitoring after broadcast', async () => {
  const tracked = []
  const { router } = createRouter(undefined, autoApprove, {
    transactionTracker: {
      maxAttempts: 7,
      pollIntervalMs: 12,
      async track(activity, watch) {
        tracked.push({ activity, watch })
      },
    },
  })
  assert.equal(
    await router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to }],
    }),
    transactionHash,
  )
  assert.equal(tracked.length, 1)
  assert.equal(tracked[0].activity.blockLimit, '540')
  assert.equal(tracked[0].watch.blockLimit, '540')
  assert.equal(tracked[0].watch.maxAttempts, 7)
  assert.equal(tracked[0].watch.network.rpcUrl, network.rpcUrl)
  assert.equal(
    tracked[0].watch.expiresAt - Date.parse(tracked[0].activity.createdAt),
    20 * 60_000,
  )
  assert.equal(tracked[0].watch.nextCheckAt - Date.parse(tracked[0].activity.createdAt), 12)
})

test('returns the provider hash before any receipt request is allowed to finish', async () => {
  let watches = []
  let receiptCalls = 0
  let releaseReceipt
  let markReceiptStarted
  const receiptGate = new Promise((resolve) => { releaseReceipt = resolve })
  const receiptStarted = new Promise((resolve) => { markReceiptStarted = resolve })
  const repository = {
    async listWatches() { return watches },
    async track(_activity, watch) { watches = [watch] },
    async saveWatch(watch) { watches = [watch] },
    async complete(_id) { watches = [] },
  }
  const monitor = new TransactionMonitor(
    repository,
    { async schedule() {} },
    {
      async create() {
        return {
          mode: 'web3',
          async request(request) {
            if (request.method === 'eth_getTransactionReceipt') {
              receiptCalls += 1
              markReceiptStarted()
              await receiptGate
              return null
            }
            if (request.method === 'fisco_getBlockNumber') return 40
            throw new Error(`Unexpected method ${request.method}`)
          },
        }
      },
    },
    { pollIntervalMs: 1 },
  )
  const { router } = createRouter(undefined, autoApprove, { transactionTracker: monitor })
  const result = await router.request(origin, {
    method: 'eth_sendTransaction',
    params: [{ from, to }],
  })
  assert.equal(result, transactionHash)
  assert.equal(receiptCalls, 0)

  const polling = monitor.pollOne(watches[0])
  await receiptStarted
  assert.equal(receiptCalls, 1)
  releaseReceipt()
  await polling
})

test('returns the broadcast hash when receipt monitor persistence fails', async () => {
  const { router } = createRouter(undefined, autoApprove, {
    transactionTracker: {
      async track() {
        throw new Error('monitor storage unavailable')
      },
    },
  })
  assert.equal(
    await router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to }],
    }),
    transactionHash,
  )
})

test('does not sign, broadcast or record activity when transaction approval is rejected', async () => {
  const activities = []
  const { router, adapterCalls, signingCalls } = createRouter(
    { async add(activity) { activities.push(activity) } },
    {
      async approveConnect() {
        throw new Error('Unexpected connect approval')
      },
      async approveTransaction() {
        throw Object.assign(new Error('User rejected the request'), { code: 4001 })
      },
    },
  )

  await assert.rejects(
    router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to, data: '0x1234' }],
    }),
    (error) => error.code === 4001,
  )
  assert.equal(signingCalls.length, 0)
  assert.equal(adapterCalls.some((call) => call.method === 'eth_sendRawTransaction'), false)
  assert.equal(adapterCalls.some((call) => call.method === 'fisco_getBlockNumber'), false)
  assert.equal(activities.length, 0)
})

test('fails closed before signing when transaction approval gateway is unavailable', async () => {
  const { router, adapterCalls, signingCalls } = createRouter(undefined, null)
  await assert.rejects(
    router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to }],
    }),
    (error) => error.code === 4900 && error.message.includes('approval service'),
  )
  assert.equal(signingCalls.length, 0)
  assert.equal(adapterCalls.some((call) => call.method === 'fisco_getBlockNumber'), false)
  assert.equal(adapterCalls.some((call) => call.method === 'eth_sendRawTransaction'), false)
})

test('does not sign or broadcast when group metadata changes during approval', async () => {
  let currentGroupInfo = groupInfo
  const { router, adapterCalls, signingCalls } = createRouter(
    undefined,
    {
      async approveConnect() {
        throw new Error('Unexpected connect approval')
      },
      async approveTransaction() {
        currentGroupInfo = {
          ...groupInfo,
          chainID: 'chain-changed',
        }
      },
    },
    { getGroupInfo: () => currentGroupInfo },
  )

  await assert.rejects(
    router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to }],
    }),
    (error) => error.code === 4900 && error.message.includes('metadata changed'),
  )
  assert.equal(signingCalls.length, 0)
  assert.equal(adapterCalls.some((call) => call.method === 'eth_sendRawTransaction'), false)
})

test('rejects non-zero value and caller-controlled nonce on V0', async () => {
  const { router } = createRouter()
  await assert.rejects(
    router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to, value: '0x1' }],
    }),
    (error) => error.code === -32602 && error.message.includes('non-zero value'),
  )
  await assert.rejects(
    router.request(origin, {
      method: 'eth_sendTransaction',
      params: [{ from, to, nonce: '0x1' }],
    }),
    (error) => error.code === -32602 && error.message.includes('generated securely'),
  )
})

test('switches the exposed address with the selected group crypto mode', async () => {
  const standardAddress = '0x2222222222222222222222222222222222222222'
  let granted = [standardAddress]
  const standardNetwork = { ...network, id: 'standard', groupId: 'group0', crypto: 'standard' }
  const gmNetwork = { ...network, id: 'gm', groupId: 'group1', crypto: 'gm' }
  let active = standardNetwork
  const providerEvents = []
  const switchApprovals = []
  const router = new RequestRouter(
    new PermissionController({
      async get() {
        return granted
      },
      async set(_origin, accounts) {
        granted = [...accounts]
      },
    }),
    {
      async getSummary() {
        return {
          activeAccountIndex: 0,
          accounts: [
            {
              index: 0,
              addresses: { standard: standardAddress, gm: from },
            },
          ],
        }
      },
    },
    {
      async getAll() {
        return [standardNetwork, gmNetwork]
      },
      async getActive() {
        return active
      },
      async setActive(value) {
        active = value
      },
    },
    undefined,
    undefined,
    {
      async approveConnect() { return [0] },
      async approveTransaction() {},
      async approveSwitch(data) { switchApprovals.push(data) },
    },
    undefined,
    (changes) => providerEvents.push(changes),
  )

  assert.deepEqual(await router.request(origin, { method: 'eth_accounts' }), [standardAddress])
  await router.request(origin, {
    method: 'wallet_switchGroup',
    params: [{ groupId: 'group1' }],
  })
  assert.deepEqual(await router.request(origin, { method: 'eth_accounts' }), [from])
  assert.equal(switchApprovals.length, 1)
  assert.equal(switchApprovals[0].requestType, 'group')
  assert.equal(switchApprovals[0].currentNetwork.groupId, 'group0')
  assert.equal(switchApprovals[0].network.groupId, 'group1')
  assert.deepEqual(providerEvents, [['group', 'accounts']])
})
