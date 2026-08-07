import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readSwitchGroupId,
  selectGroupNetwork,
} from '../src/core/networks/groupSelection.ts'

const network = (id, rpcUrl, groupId) => ({
  id,
  name: id,
  rpcUrl,
  mode: 'legacy',
  crypto: 'standard',
  chainId: 1,
  groupId,
})

test('reads wallet_switchGroup parameters and trims the group ID', () => {
  assert.equal(readSwitchGroupId([{ groupId: ' group1 ' }]), 'group1')
  assert.throws(() => readSwitchGroupId([]), (error) => error.code === -32602)
  assert.throws(
    () => readSwitchGroupId([{ groupId: '' }]),
    (error) => error.code === -32602,
  )
})

test('selects a group on the active RPC endpoint before global matches', () => {
  const active = network('active', 'https://node-a.example/', 'group0')
  const expected = network('target-a', 'https://node-a.example', 'group1')
  const other = network('target-b', 'https://node-b.example', 'group1')

  assert.equal(selectGroupNetwork([active, expected, other], active, 'group1'), expected)
})

test('returns standard provider errors for missing or ambiguous groups', () => {
  const first = network('first', 'https://node-a.example', 'group1')
  const second = network('second', 'https://node-b.example', 'group1')

  assert.throws(
    () => selectGroupNetwork([first], undefined, 'missing'),
    (error) => error.code === 4902,
  )
  assert.throws(
    () => selectGroupNetwork([first, second], undefined, 'group1'),
    (error) => error.code === -32602,
  )
})
