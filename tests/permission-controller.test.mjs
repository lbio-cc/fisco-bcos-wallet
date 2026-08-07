import assert from 'node:assert/strict'
import test from 'node:test'

import { PermissionController } from '../src/core/permissions/permissionController.ts'

class MemoryPermissionStore {
  values = new Map()

  async get(origin) {
    return this.values.get(origin) ?? []
  }

  async set(origin, accounts) {
    this.values.set(origin, [...accounts])
  }
}

test('grants deduplicated accounts to secure and local development origins', async () => {
  for (const origin of [
    'https://dapp.example',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://[::1]:5173',
  ]) {
    const store = new MemoryPermissionStore()
    const controller = new PermissionController(store)
    await controller.grant(origin, ['0x1234', '0x1234'])
    assert.deepEqual(await controller.accountsFor(origin), ['0x1234'])
  }
})

test('rejects account grants to insecure non-loopback origins', async () => {
  const controller = new PermissionController(new MemoryPermissionStore())
  await assert.rejects(
    () => controller.grant('http://dapp.example', ['0x1234']),
    /HTTPS origins or localhost/,
  )
})
