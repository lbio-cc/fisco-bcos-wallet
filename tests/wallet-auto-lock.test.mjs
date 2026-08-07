import assert from 'node:assert/strict'
import test from 'node:test'

import { WalletAutoLockController } from '../src/background/walletAutoLock.ts'

test('auto-lock controller restores alarms and broadcasts an expired lock', async () => {
  let deadline = 1_500
  let lockedStatus
  const scheduled = []
  let clears = 0
  const broadcasts = []
  const controller = new WalletAutoLockController(
    {
      async getAutoLockDeadline() { return deadline },
      async lockIfIdle() {
        deadline = undefined
        return lockedStatus
      },
    },
    {
      schedule(at) { scheduled.push(at) },
      clear() { clears += 1 },
    },
    (status) => broadcasts.push(status),
  )

  await controller.sync()
  assert.deepEqual(scheduled, [1_500])
  lockedStatus = { initialized: true, locked: true }
  await controller.wake()
  assert.deepEqual(broadcasts, [lockedStatus])
  assert.equal(clears, 1)
})

