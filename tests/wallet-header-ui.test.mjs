import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/layout/WalletHeader.vue', import.meta.url),
  'utf8',
)

test('account dropdown displays non-empty account remarks', () => {
  assert.match(
    source,
    /class="account-option"[\s\S]*?<small v-if="account\.remark" class="account-option-remark">[\s\S]*?\{\{ account\.remark \}\}/,
  )
})
