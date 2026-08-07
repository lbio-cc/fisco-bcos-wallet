import assert from 'node:assert/strict'
import test from 'node:test'

import { isApprovalRuntimeRequest } from '../src/shared/approvalMessages.ts'

test('accepts only approval messages with a non-empty token and valid kind', () => {
  assert.equal(
    isApprovalRuntimeRequest({ type: 'APPROVAL_GET', token: 'token-1', kind: 'connect' }),
    true,
  )
  assert.equal(
    isApprovalRuntimeRequest({ type: 'APPROVAL_HEARTBEAT', token: 'token-1', kind: 'transaction' }),
    true,
  )
  assert.equal(
    isApprovalRuntimeRequest({ type: 'APPROVAL_GET', token: 'token-1', kind: 'switch' }),
    true,
  )
  for (const value of [
    null,
    {},
    { type: 'APPROVAL_GET', token: '', kind: 'connect' },
    { type: 'APPROVAL_GET', token: 1, kind: 'connect' },
    { type: 'APPROVAL_GET', token: 'token-1', kind: 'unknown' },
  ]) {
    assert.equal(isApprovalRuntimeRequest(value), false)
  }
})

test('strictly validates approval resolve decisions and account indexes', () => {
  assert.equal(
    isApprovalRuntimeRequest({
      type: 'APPROVAL_RESOLVE',
      token: 'token-1',
      kind: 'connect',
      approved: true,
      accountIndexes: [0, 2],
    }),
    true,
  )
  assert.equal(
    isApprovalRuntimeRequest({
      type: 'APPROVAL_RESOLVE',
      token: 'token-1',
      kind: 'connect',
      approved: false,
    }),
    true,
  )
  for (const value of [
    { type: 'APPROVAL_RESOLVE', token: 'token-1', kind: 'connect' },
    {
      type: 'APPROVAL_RESOLVE',
      token: 'token-1',
      kind: 'connect',
      approved: 'yes',
      accountIndexes: [0],
    },
    {
      type: 'APPROVAL_RESOLVE',
      token: 'token-1',
      kind: 'connect',
      approved: true,
      accountIndexes: [0.5],
    },
    {
      type: 'APPROVAL_RESOLVE',
      token: 'token-1',
      kind: 'connect',
      approved: true,
      accountIndexes: '0',
    },
    {
      type: 'APPROVAL_RESOLVE',
      token: 'token-1',
      kind: 'transaction',
      approved: true,
      accountIndexes: [0],
    },
    {
      type: 'APPROVAL_RESOLVE',
      token: 'token-1',
      kind: 'switch',
      approved: true,
      accountIndexes: [0],
    },
  ]) {
    assert.equal(isApprovalRuntimeRequest(value), false)
  }
})
