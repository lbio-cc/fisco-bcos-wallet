import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheetSources = await Promise.all(
  [
    '../src/App.vue',
    '../src/styles/wallet.scss',
    '../src/components/layout/WalletHeader.vue',
    '../src/components/home/WalletHomeView.vue',
    '../src/components/home/WalletAssetsView.vue',
    '../src/components/home/WalletActivityView.vue',
    '../src/components/views/WalletAccessFlow.vue',
    '../src/components/views/AccountManagementView.vue',
    '../src/components/views/NetworkManagementView.vue',
    '../src/components/views/SecretExportView.vue',
    '../src/approval/approval.scss',
  ].map(async (path) => ({
    path,
    source: await readFile(new URL(path, import.meta.url), 'utf8'),
  })),
)

test('visible wallet typography never uses 7px, 8px, or 9px text', () => {
  const fontDeclaration = /\b(font(?:-size)?)\s*:\s*([^;{}]+)/g

  for (const { path, source } of stylesheetSources) {
    const matches = [...source.matchAll(fontDeclaration)].filter((match) => {
      const pixelSize = match[2].match(/\b([0-9.]+)px\b/)
      return pixelSize !== null && Number(pixelSize[1]) < 10
    })
    assert.equal(
      matches.length,
      0,
      `${path} contains undersized visible font declarations: ${matches
        .map((match) => match[0].trim())
        .join(', ')}`,
    )
  }
})
