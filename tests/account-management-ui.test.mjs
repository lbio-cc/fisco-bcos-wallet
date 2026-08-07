import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/views/AccountManagementView.vue', import.meta.url),
  'utf8',
)
const template = source.slice(source.indexOf('<template>'), source.indexOf('</template>'))

test('account management uses a compact row with check-only selection state', () => {
  assert.match(source, /class="account-row"/)
  assert.match(source, /aria-label="当前账户"/)
  assert.match(source, /class="account-check"[\s\S]*?role="img"[\s\S]*?>✓</)
  assert.match(source, /class="account-check-placeholder"/)
  assert.doesNotMatch(source, /:class="\{\s*active:/)
  assert.doesNotMatch(source, /暂无备注/)
  assert.doesNotMatch(source, /\.account-list-item[\s\S]*?&\.active/)
  assert.doesNotMatch(source, /\.account-actions/)
})

test('each account exposes accessible actions in an overlay menu', () => {
  assert.match(source, /aria-haspopup="menu"/)
  assert.match(source, /:aria-expanded="openAccountMenuIndex === account\.index"/)
  assert.match(source, /class="account-menu-panel"[\s\S]*?role="menu"/)
  assert.equal((template.match(/role="menuitem"/g) ?? []).length, 3)
  assert.match(source, /document\.addEventListener\('pointerdown', handleOutsideAccountMenu\)/)
  assert.match(source, /openAccountMenuIndex\.value = index/)
})

test('account menus avoid shell clipping and preserve every action', () => {
  assert.match(source, /const spaceBelow = boundaryRect\.bottom - triggerRect\.bottom/)
  assert.match(source, /spaceBelow < panel\.offsetHeight \+ 4/)
  assert.match(source, /accountMenuPlacement\.value = 'up'/)
  assert.match(source, /:class="\{ 'opens-upward': accountMenuPlacement === 'up' \}"/)
  assert.match(source, /&\.opens-upward[\s\S]*?top: auto[\s\S]*?bottom: calc\(100% \+ 4px\)/)
  assert.equal((template.match(/role="menuitem"/g) ?? []).length, 3)
  assert.match(source, /:disabled="management\.busy \|\| session\.summary\?\.accounts\.length === 1"/)
  assert.match(source, /const exportPrivateKey[\s\S]*?closeAccountMenu\(\)/)
  assert.match(source, /const openEdit[\s\S]*?closeAccountMenu\(\)/)
  assert.match(source, /const requestDelete[\s\S]*?closeAccountMenu\(\)/)
})

test('ARIA menu supports standard keyboard navigation and focus restoration', () => {
  assert.match(source, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]\.includes\(event\.key\)/)
  assert.match(source, /role="menuitem"]:not\(:disabled\)/)
  assert.match(source, /event\.key === 'Home'/)
  assert.match(source, /event\.key === 'End'/)
  assert.match(source, /event\.key === 'ArrowDown'/)
  assert.match(source, /items\[targetIndex\]\?\.focus\(\)/)
  assert.match(source, /event\.key === 'Escape'[\s\S]*?closeAccountMenu\(true\)/)
  assert.match(source, /activeMenuButton\.value\?\.focus\(\)/)
})
