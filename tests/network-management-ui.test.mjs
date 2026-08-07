import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/views/NetworkManagementView.vue', import.meta.url),
  'utf8',
)
const template = source.slice(source.indexOf('<template>'), source.indexOf('</template>'))
const storeSource = await readFile(
  new URL('../src/stores/networkManagement.ts', import.meta.url),
  'utf8',
)

test('network management uses compact rows with a check-only current state', () => {
  assert.match(source, /class="network-row"/)
  assert.match(source, /class="network-select"/)
  assert.match(source, /aria-label="当前网络"/)
  assert.match(source, /class="network-check"[\s\S]*?role="img"[\s\S]*?>✓</)
  assert.match(source, /class="network-check-placeholder"/)
  assert.match(source, /network\.groupId[\s\S]*?network\.crypto[\s\S]*?network\.compatibilityVersion[\s\S]*?network\.billingEnabled/)
  assert.doesNotMatch(source, /class="network-row-actions"/)
  assert.doesNotMatch(source, /<dl>/)
  assert.doesNotMatch(source, /:class="\{\s*current:/)
  assert.doesNotMatch(source, /&\.current/)
})

test('network row main content switches while the current row is disabled', () => {
  assert.match(source, /:disabled="management\.busy \|\| network\.id === session\.activeNetwork\?\.id"[\s\S]*?class="network-select"/)
  assert.match(source, /@click="switchNetwork\(network\.id\)"/)
  assert.match(source, /const switchNetwork[\s\S]*?management\.switchTo\(id\)[\s\S]*?home\.refresh\(\)/)
})

test('network form explicitly supports native and Web3 RPC modes', () => {
  assert.match(source, /management\.form\.mode === 'legacy'/)
  assert.match(source, /management\.selectMode\('legacy'\)[\s\S]*?原生 RPC/)
  assert.match(source, /management\.form\.mode === 'web3'/)
  assert.match(source, /management\.selectMode\('web3'\)[\s\S]*?Web3 RPC/)
  assert.match(source, /eth_chainId/)
  assert.match(source, /v-if="management\.form\.mode === 'legacy'"[\s\S]*?群组 ID/)
  assert.match(source, /v-else[\s\S]*?v-model\.number="management\.form\.chainId"[\s\S]*?type="number"/)
  assert.match(storeSource, /form\.mode === 'web3'[\s\S]*?\{\.\.\.common, mode: 'web3', chainId: form\.chainId, isGM: false\}/)
  assert.match(storeSource, /:\s*\{\.\.\.common, mode: 'legacy', groupId: form\.groupId, isGM: form\.isGM\}/)
  assert.doesNotMatch(storeSource, /addNetwork\(\{\.\.\.form\}\)/)
})

test('Web3 mode visibly disables GM and normalizes crypto selections', () => {
  assert.match(source, /Web3 RPC 使用标准 secp256k1 密码体系/)
  assert.match(source, /:disabled="management\.form\.mode === 'web3'"[\s\S]*?<b>国密<\/b>/)
  assert.match(source, /:aria-describedby="management\.form\.mode === 'web3' \? 'crypto-compatibility-note' : undefined"/)
  assert.match(source, /Web3 原始交易使用 secp256k1 签名，不支持 SM2；国密网络请选择原生 RPC/)
  assert.match(source, /&:disabled[\s\S]*?cursor: not-allowed/)
  assert.match(storeSource, /const selectMode[\s\S]*?form\.mode = mode[\s\S]*?mode === 'web3'\) form\.isGM = false/)
  assert.match(storeSource, /form\.isGM = form\.mode === 'legacy' && network\.crypto === 'gm'/)
})

test('network actions use an accessible overlay menu with protected deletion', () => {
  assert.match(source, /aria-haspopup="menu"/)
  assert.match(source, /:aria-expanded="openNetworkMenuId === network\.id"/)
  assert.match(source, /class="network-menu-panel"[\s\S]*?role="menu"/)
  assert.equal((template.match(/role="menuitem"/g) ?? []).length, 2)
  assert.match(source, /:disabled="management\.busy \|\| network\.id === session\.activeNetwork\?\.id"[\s\S]*?class="danger-text"/)
  assert.match(source, /document\.addEventListener\('pointerdown', handleOutsideNetworkMenu\)/)
  assert.match(source, /const requestDelete[\s\S]*?closeNetworkMenu\(\)[\s\S]*?management\.requestDelete\(network\)/)
})

test('network menu supports keyboard navigation, focus restoration and upward placement', () => {
  assert.match(source, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]\.includes\(event\.key\)/)
  assert.match(source, /role="menuitem"]:not\(:disabled\)/)
  assert.match(source, /event\.key === 'Home'/)
  assert.match(source, /event\.key === 'End'/)
  assert.match(source, /items\[targetIndex\]\?\.focus\(\)/)
  assert.match(source, /event\.key === 'Escape'[\s\S]*?closeNetworkMenu\(true\)/)
  assert.match(source, /activeMenuButton\.value\?\.focus\(\)/)
  assert.match(source, /const spaceBelow = boundaryRect\.bottom - triggerRect\.bottom/)
  assert.match(source, /spaceBelow < panel\.offsetHeight \+ 4/)
  assert.match(source, /networkMenuPlacement\.value = 'up'/)
  assert.match(source, /:class="\{ 'opens-upward': networkMenuPlacement === 'up' \}"/)
  assert.match(source, /&\.opens-upward[\s\S]*?top: auto[\s\S]*?bottom: calc\(100% \+ 4px\)/)
})
