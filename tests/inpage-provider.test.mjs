import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTENT_CHANNEL,
  PAGE_CHANNEL,
  PROVIDER_EVENT_CHANNEL,
} from '../src/shared/messages.ts'

class PageWindow extends EventTarget {
  location = { origin: 'https://dapp.example' }
  messages = []

  postMessage(message, targetOrigin) {
    this.messages.push({ message, targetOrigin })
  }

  respond(id, body) {
    const event = new Event('message')
    Object.defineProperties(event, {
      data: { value: { channel: CONTENT_CHANNEL, id, ...body } },
      source: { value: this },
    })
    this.dispatchEvent(event)
  }

  providerStateChanged(changes) {
    const event = new Event('message')
    Object.defineProperties(event, {
      data: { value: { channel: PROVIDER_EVENT_CHANNEL, changes } },
      source: { value: this },
    })
    this.dispatchEvent(event)
  }
}

const pageWindow = new PageWindow()
globalThis.window = pageWindow

const { FiscoProvider } = await import('../src/inpage/index.ts')

function takeRequest() {
  const posted = pageWindow.messages.shift()
  assert.ok(posted)
  assert.equal(posted.targetOrigin, pageWindow.location.origin)
  assert.equal(posted.message.channel, PAGE_CHANNEL)
  return posted.message
}

test('request returns the bare provider result', async () => {
  const resultPromise = window.fisco.request({
    method: 'eth_chainId',
    params: [],
  })
  const message = takeRequest()
  assert.deepEqual(message.request, { method: 'eth_chainId', params: [] })

  pageWindow.respond(message.id, { result: '0x1' })
  assert.equal(await resultPromise, '0x1')
})

test('send supports the ethereum method and params signature', async () => {
  const resultPromise = window.fisco.send('eth_accounts', [])
  const message = takeRequest()
  assert.deepEqual(message.request, { method: 'eth_accounts', params: [] })

  pageWindow.respond(message.id, { result: ['0x1234'] })
  assert.deepEqual(await resultPromise, ['0x1234'])
})

test('send supports promise and callback JSON-RPC payload signatures', async () => {
  const promiseResponse = window.fisco.send({
    jsonrpc: '2.0',
    id: 7,
    method: 'eth_blockNumber',
  })
  const promiseMessage = takeRequest()
  pageWindow.respond(promiseMessage.id, { result: '0x2a' })
  assert.deepEqual(await promiseResponse, {
    jsonrpc: '2.0',
    id: 7,
    result: '0x2a',
  })

  const callbackResponse = new Promise((resolve, reject) => {
    window.fisco.send(
      { jsonrpc: '2.0', id: 'request-8', method: 'eth_accounts' },
      (error, response) => (error ? reject(error) : resolve(response)),
    )
  })
  const callbackMessage = takeRequest()
  pageWindow.respond(callbackMessage.id, { result: ['0xabcd'] })
  assert.deepEqual(await callbackResponse, {
    jsonrpc: '2.0',
    id: 'request-8',
    result: ['0xabcd'],
  })
})

test('sendAsync uses the node-style callback for results and errors', async () => {
  const success = new Promise((resolve, reject) => {
    window.fisco.sendAsync(
      { jsonrpc: '2.0', id: 9, method: 'eth_chainId' },
      (error, response) => (error ? reject(error) : resolve(response)),
    )
  })
  const successMessage = takeRequest()
  pageWindow.respond(successMessage.id, { result: '0x1' })
  assert.deepEqual(await success, {
    jsonrpc: '2.0',
    id: 9,
    result: '0x1',
  })

  const failure = new Promise((resolve) => {
    window.fisco.sendAsync(
      { jsonrpc: '2.0', id: 10, method: 'eth_unsupported' },
      (error, response) => resolve({ error, response }),
    )
  })
  const failureMessage = takeRequest()
  pageWindow.respond(failureMessage.id, {
    error: { code: -32601, message: 'Method not found', data: 'eth_unsupported' },
  })
  const { error, response } = await failure
  assert.equal(response, undefined)
  assert.equal(error.message, 'Method not found')
  assert.equal(error.code, -32601)
  assert.equal(error.data, 'eth_unsupported')
})

test('emits account and group changes after successful provider requests', async () => {
  const accountEvents = []
  const groupEvents = []
  const chainEvents = []
  window.fisco.on('accountsChanged', (value) => accountEvents.push(value))
  window.fisco.on('groupChanged', (value) => groupEvents.push(value))
  window.fisco.on('chainChanged', (value) => chainEvents.push(value))

  const accountsPromise = window.fisco.request({ method: 'eth_requestAccounts' })
  const accountsMessage = takeRequest()
  pageWindow.respond(accountsMessage.id, { result: ['0xABCD'] })
  assert.deepEqual(await accountsPromise, ['0xABCD'])
  assert.deepEqual(accountEvents, [['0xABCD']])

  const switchPromise = window.fisco.request({
    method: 'wallet_switchGroup',
    params: [{ groupId: 'group2' }],
  })
  const switchMessage = takeRequest()
  pageWindow.respond(switchMessage.id, { result: null })
  assert.equal(await switchPromise, null)
  assert.deepEqual(groupEvents, ['group2'])
  assert.deepEqual(accountEvents, [['0xABCD']])

  const chainPromise = window.fisco.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x4ee8' }],
  })
  const chainMessage = takeRequest()
  pageWindow.respond(chainMessage.id, { result: null })
  assert.equal(await chainPromise, null)
  assert.deepEqual(chainEvents, ['0x4ee8'])
})

test('refreshes and emits provider state after an external wallet switch', async () => {
  const accountEvents = []
  const groupEvents = []
  const chainEvents = []
  window.fisco.on('accountsChanged', (value) => accountEvents.push(value))
  window.fisco.on('groupChanged', (value) => groupEvents.push(value))
  window.fisco.on('chainChanged', (value) => chainEvents.push(value))

  pageWindow.providerStateChanged(['group', 'chain', 'accounts'])

  const groupRequest = takeRequest()
  const chainRequest = takeRequest()
  const accountsRequest = takeRequest()
  assert.equal(groupRequest.request.method, 'wallet_getGroup')
  assert.equal(chainRequest.request.method, 'eth_chainId')
  assert.equal(accountsRequest.request.method, 'eth_accounts')

  pageWindow.respond(groupRequest.id, { result: 'group3' })
  pageWindow.respond(chainRequest.id, { result: '0x2' })
  pageWindow.respond(accountsRequest.id, { result: ['0xEEEE'] })
  await Promise.resolve()

  assert.deepEqual(groupEvents, ['group3'])
  assert.deepEqual(chainEvents, ['0x2'])
  assert.deepEqual(accountEvents, [['0xEEEE']])
})

test('rejects and removes a provider request after its local timeout', async () => {
  const provider = new FiscoProvider(5)
  const result = provider.request({ method: 'eth_blockNumber' })
  takeRequest()

  await assert.rejects(
    () => result,
    (error) => error instanceof Error && error.code === 4900 && /timed out/.test(error.message),
  )
})
