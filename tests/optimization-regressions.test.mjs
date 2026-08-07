import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { removedAccountAddresses } from '../src/background/chromeWalletRepository.ts'

const account = (index, standard, gm) => ({
  index,
  addresses: { standard, gm },
})

test('account removal identifies both chain addresses for asset cleanup', () => {
  const previous = {
    accounts: [
      account(0, '0xstandard0', '0xgm0'),
      account(1, '0xstandard1', '0xgm1'),
    ],
  }
  const next = { accounts: [account(0, '0xstandard0', '0xgm0')] }
  assert.deepEqual(
    removedAccountAddresses(previous, next),
    ['0xstandard1', '0xgm1'],
  )
})

test('production extension build is minified and does not request tabs permission', async () => {
  const build = await readFile(new URL('../scripts/build-extension.mjs', import.meta.url), 'utf8')
  const manifest = JSON.parse(
    await readFile(new URL('../public/manifest.json', import.meta.url), 'utf8'),
  )
  assert.match(build, /minify:\s*true/)
  assert.equal(manifest.permissions.includes('tabs'), false)
  assert.deepEqual(manifest.permissions, ['storage', 'alarms'])
})

