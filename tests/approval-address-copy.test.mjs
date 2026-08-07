import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/approval/ApprovalPage.vue', import.meta.url),
  'utf8',
)

test('approval address copy controls cover only displayed chain account addresses', () => {
  assert.match(source, /copyAddress\(account\.address, `connect-\$\{account\.index\}`\)/)
  assert.match(source, /copyAddress\(transaction\.from, 'transaction-from'\)/)
  assert.match(
    source,
    /v-if="transaction\.to" class="transaction-address"[\s\S]*?copyAddress\(transaction\.to, 'transaction-to'\)/,
  )
  assert.doesNotMatch(source, /copyAddress\([^)]*(rpcUrl|groupId|chainId|创建合约)/)

  for (const label of source.matchAll(/<label[\s\S]*?<\/label>/g)) {
    assert.doesNotMatch(label[0], /<button/)
  }
})

test('every approval address copy target has independent live feedback and fallback copy', () => {
  assert.match(source, /addressCopyAnnouncement\(\s*`connect-\$\{account\.index\}`/)
  assert.match(source, /addressCopyAnnouncement\('transaction-from', '发送方'\)/)
  assert.match(source, /addressCopyAnnouncement\('transaction-to', '接收方'\)/)
  assert.match(source, /<span[^>]*aria-live="polite"[^>]*role="status"/)
  assert.match(source, /document\.execCommand\('copy'\)/)
  assert.match(source, /activeElement\?\.focus\(\)/)
})
