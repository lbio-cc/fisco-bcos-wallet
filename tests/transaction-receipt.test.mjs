import assert from 'node:assert/strict'
import test from 'node:test'

import { parseFiscoTransactionReceipt } from '../src/core/transaction/fiscoTransactionReceipt.ts'

const hash = `0x${'ab'.repeat(32)}`

for (const status of [0, 0n, '0', '0x0', '0x00']) {
  test(`parses successful receipt status ${String(status)}`, () => {
    const parsed = parseFiscoTransactionReceipt({ transactionHash: hash, status }, hash)
    assert.equal(parsed.kind, 'receipt')
    assert.equal(parsed.receipt.successful, true)
    assert.equal(parsed.receipt.status, '0')
  })
}

test('parses non-zero status as failure and normalizes block number', () => {
  const parsed = parseFiscoTransactionReceipt(
    { transactionHash: hash.toUpperCase(), status: '0x16', blockNumber: '0x2a' },
    hash,
  )
  assert.deepEqual(parsed, {
    kind: 'receipt',
    receipt: { status: '22', successful: false, blockNumber: '42' },
  })
})

test('treats null as pending', () => {
  assert.deepEqual(parseFiscoTransactionReceipt(null, hash), { kind: 'pending' })
})

for (const value of [
  {},
  { status: -1 },
  { status: 'nope' },
  { status: 0, transactionHash: `0x${'cd'.repeat(32)}` },
  { status: 0, blockNumber: 'broken' },
]) {
  test(`rejects malformed receipt ${JSON.stringify(value)}`, () => {
    assert.equal(parseFiscoTransactionReceipt(value, hash).kind, 'malformed')
  })
}
