import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readProviderTransaction,
  readTransactionHash,
} from '../src/core/transaction/providerTransaction.ts'

const from = '0x1111111111111111111111111111111111111111'
const to = '0x435407f2be59a102edc42077027b92093349d4c7'

test('validates and preserves an eth_sendTransaction request', () => {
  const transaction = {
    from,
    to,
    data: '0x1234',
    value: '0x0',
    gas: '0x5208',
  }
  assert.equal(readProviderTransaction([transaction]), transaction)
})

test('rejects unauthorized shapes and malformed transaction fields', () => {
  for (const params of [
    [],
    [{ to }],
    [{ from: '0x1234', to }],
    [{ from, to: 'not-an-address' }],
    [{ from, to, data: '0x123' }],
    [{ from, to, value: '0x00' }],
  ]) {
    assert.throws(
      () => readProviderTransaction(params),
      (error) => error.code === -32602,
    )
  }
})

test('normalizes direct hashes and receipt-shaped RPC results', () => {
  const hash = `0x${'ab'.repeat(32)}`
  assert.equal(readTransactionHash(hash), hash)
  assert.equal(readTransactionHash({ transactionHash: hash, status: 0 }), hash)
  assert.throws(() => readTransactionHash({ status: 0 }), /malformed transaction hash/)
})
