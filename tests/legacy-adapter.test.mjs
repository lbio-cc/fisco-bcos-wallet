import assert from 'node:assert/strict'
import test from 'node:test'

import { LegacyAdapter } from '../src/core/adapters/legacyAdapter.ts'

const network = {
  id: 'legacy',
  name: 'Legacy FISCO',
  rpcUrl: 'https://node.example',
  mode: 'legacy',
  crypto: 'standard',
  chainId: 1,
  groupId: 'group0',
  nodeId: 'node0',
  legacyParamStyle: 'explicit',
}

class RecordingTransport {
  calls = []

  constructor(result) {
    this.result = result
  }

  async request(method, params) {
    this.calls.push({ method, params })
    return this.result
  }
}

test('maps eth_call without group or node params and unwraps output', async () => {
  const transport = new RecordingTransport({
    blockNumber: 12,
    output: '0x1234',
    status: 0,
  })
  const adapter = new LegacyAdapter(transport, network)

  const result = await adapter.request({
    method: 'eth_call',
    params: [
      {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x435407f2be59a102edc42077027b92093349d4c7',
        data: '0x2be92b250000000000000000000000000000000000000000000000000000000000000001',
      },
      'latest',
    ],
  })

  assert.equal(result, '0x1234')
  assert.deepEqual(transport.calls, [
    {
      method: 'call',
      params: [
        '0x435407f2be59a102edc42077027b92093349d4c7',
        '0x2be92b250000000000000000000000000000000000000000000000000000000000000001',
      ],
    },
  ])
})

test('keeps eth_call unscoped for endpoint-scoped networks', async () => {
  const transport = new RecordingTransport({ output: '0x', status: 0 })
  const adapter = new LegacyAdapter(transport, {
    ...network,
    nodeId: undefined,
    legacyParamStyle: 'endpoint-scoped',
  })

  await adapter.request({
    method: 'eth_call',
    params: [{ to: '0x435407f2be59a102edc42077027b92093349d4c7', data: '0x' }],
  })

  assert.deepEqual(transport.calls[0], {
    method: 'call',
    params: ['0x435407f2be59a102edc42077027b92093349d4c7', '0x'],
  })
})

test('never injects group or node into native RPC parameters', async () => {
  const transport = new RecordingTransport({ number: 12 })
  const adapter = new LegacyAdapter(transport, network)

  await adapter.request({
    method: 'fisco_getBlockByNumber',
    params: [12, false, false],
  })

  assert.deepEqual(transport.calls[0], {
    method: 'getBlockByNumber',
    params: [12, false, false],
  })
})

test('maps a signed raw transaction to endpoint-scoped sendTransaction', async () => {
  const hash = `0x${'ab'.repeat(32)}`
  const transport = new RecordingTransport({ transactionHash: hash, status: 0 })
  const adapter = new LegacyAdapter(transport, network)
  const rawTransaction = `0x${'12'.repeat(64)}`

  assert.equal(
    await adapter.request({
      method: 'eth_sendRawTransaction',
      params: [rawTransaction, true],
    }),
    hash,
  )
  assert.deepEqual(transport.calls[0], {
    method: 'sendTransaction',
    params: [rawTransaction, true],
  })
})

test('rejects unsupported block tags and malformed transaction data', async () => {
  const adapter = new LegacyAdapter(new RecordingTransport({ output: '0x' }), network)

  await assert.rejects(
    adapter.request({
      method: 'eth_call',
      params: [{ to: '0x435407f2be59a102edc42077027b92093349d4c7' }, '0x10'],
    }),
    (error) => error.code === -32602 && error.message.includes('latest block'),
  )
  await assert.rejects(
    adapter.request({
      method: 'eth_call',
      params: [{ to: 'not-an-address', data: '0x123' }],
    }),
    (error) => error.code === -32602,
  )
})
