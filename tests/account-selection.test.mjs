import assert from 'node:assert/strict'
import test from 'node:test'

import { readSwitchAccountAddress } from '../src/core/wallet/accountSelection.ts'

test('reads and normalizes wallet_switchAccount parameters', () => {
  const address = `0x${'ab'.repeat(20)}`
  assert.equal(
    readSwitchAccountAddress([{ account: ` ${address.toUpperCase().replace('0X', '0x')} ` }]),
    `0x${'AB'.repeat(20)}`,
  )
})

test('rejects malformed wallet_switchAccount parameters', () => {
  for (const params of [
    undefined,
    [],
    [{ account: '' }],
    [{ account: '0x1234' }],
    [{ account: `0x${'gg'.repeat(20)}` }],
    [{ address: `0x${'11'.repeat(20)}` }],
    [{ account: `0x${'11'.repeat(20)}` }, { account: `0x${'22'.repeat(20)}` }],
  ]) {
    assert.throws(
      () => readSwitchAccountAddress(params),
      (error) => error.code === -32602,
    )
  }
})
