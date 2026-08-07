import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchWithTimeout,
  readJsonResponse,
} from '../src/core/transport/httpLimits.ts'
import {
  fetchSanitizedMetadata,
  METADATA_RESPONSE_LIMIT_BYTES,
} from '../src/core/assets/assetService.ts'
import { readJsonRpcResponse } from '../src/core/transport/jsonRpcTransport.ts'

test('aborts an external request after its deadline', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      )
    })
  try {
    await assert.rejects(
      () => fetchWithTimeout('https://rpc.example', {}, 5, 'RPC'),
      /RPC请求超时/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('enforces the actual streamed response size when content-length is absent or false', async () => {
  const body = JSON.stringify({ value: 'x'.repeat(256) })
  const response = new Response(body, { headers: { 'content-length': '8' } })
  await assert.rejects(
    () => readJsonResponse(response, 64, 'RPC'),
    /响应超过 64 字节限制/,
  )
})

test('rejects oversized inline NFT metadata before decoding it', async () => {
  const oversized = 'x'.repeat(METADATA_RESPONSE_LIMIT_BYTES + 1)
  const uri = `data:application/json,${encodeURIComponent(JSON.stringify({ name: oversized }))}`
  await assert.rejects(
    () => fetchSanitizedMetadata('1', uri),
    /metadata data URI 过大/,
  )
})

test('strictly validates JSON-RPC version, id, and result/error shape', () => {
  assert.deepEqual(
    readJsonRpcResponse({ jsonrpc: '2.0', id: 7, result: '0x1' }, 7),
    { jsonrpc: '2.0', id: 7, result: '0x1' },
  )
  assert.deepEqual(
    readJsonRpcResponse({ jsonrpc: '2.0', id: 7, error: { code: -1, message: 'bad' } }, 7),
    { jsonrpc: '2.0', id: 7, error: { code: -1, message: 'bad' } },
  )
  for (const malformed of [
    null,
    { jsonrpc: '1.0', id: 7, result: null },
    { jsonrpc: '2.0', id: 8, result: null },
    { jsonrpc: '2.0', id: 7 },
    { jsonrpc: '2.0', id: 7, result: null, error: { code: -1, message: 'bad' } },
    { jsonrpc: '2.0', id: 7, error: { code: 'bad', message: 'bad' } },
  ]) {
    assert.throws(() => readJsonRpcResponse(malformed, 7), /Malformed JSON-RPC response/)
  }
})
