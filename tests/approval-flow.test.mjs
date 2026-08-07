import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readApprovalGate,
  unlockApprovalGate,
} from '../src/approval/approvalFlow.ts'

test('locked approval remains gated until a successful unlock retry', async () => {
  assert.deepEqual(
    await readApprovalGate(async () => ({ initialized: true, locked: true })),
    { state: 'unlock' },
  )

  let attempts = 0
  const unlock = async ({ password }) => {
    attempts += 1
    if (password !== 'correct password') throw new Error('钱包密码错误或加密数据已损坏')
    return { initialized: true, locked: false }
  }
  await assert.rejects(
    unlockApprovalGate('wrong password', unlock),
    /钱包密码错误/,
  )
  assert.deepEqual(await unlockApprovalGate('correct password', unlock), { state: 'ready' })
  assert.equal(attempts, 2)
})

test('final approval gate detects a wallet that was locked again', async () => {
  assert.deepEqual(
    await readApprovalGate(async () => ({ initialized: true, locked: true })),
    { state: 'unlock' },
  )
  assert.deepEqual(
    await readApprovalGate(async () => ({ initialized: false, locked: true })),
    { state: 'error', message: '钱包尚未创建或恢复，请先在钱包中完成初始化' },
  )
})
