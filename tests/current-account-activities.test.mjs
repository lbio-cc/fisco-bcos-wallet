import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { filterActivitiesForAccount } from '../src/popup/currentAccountActivities.ts'

const account = {
  index: 0,
  name: '当前账户',
  remark: '',
  addresses: {
    standard: '0xAa00000000000000000000000000000000000001',
    gm: '0xBb00000000000000000000000000000000000002',
  },
  publicKeys: { standard: '0x01', gm: '0x02' },
  derivationPath: "m/44'/60'/0'/0/0",
  derivationScheme: 'bip32-secp256k1-v1',
  createdAt: '2026-07-30T00:00:00.000Z',
}

const standardNetwork = {
  id: 'network-a',
  name: '网络 A',
  rpcUrl: 'https://node.example',
  mode: 'legacy',
  crypto: 'standard',
  chainId: 1,
  groupId: 'group0',
}

const gmNetwork = {
  ...standardNetwork,
  id: 'network-gm',
  name: '国密网络',
  crypto: 'gm',
  groupId: 'group1',
}

const activity = (overrides = {}) => ({
  id: 'activity',
  hash: '0x01',
  origin: 'https://dapp.example',
  from: '0xCc00000000000000000000000000000000000003',
  to: '0xDd00000000000000000000000000000000000004',
  networkId: 'network-a',
  networkName: '网络 A',
  groupId: 'group0',
  crypto: 'standard',
  createdAt: '2026-07-30T00:00:00.000Z',
  status: 'submitted',
  ...overrides,
})

test('keeps standard and GM activities that match the corresponding account address', () => {
  const standard = activity({
    id: 'standard',
    from: account.addresses.standard,
  })
  const gm = activity({
    id: 'gm',
    networkId: 'network-gm',
    groupId: 'group1',
    crypto: 'gm',
    from: account.addresses.gm,
  })

  assert.deepEqual(filterActivitiesForAccount([standard, gm], account, standardNetwork), [standard])
  assert.deepEqual(filterActivitiesForAccount([standard, gm], account, gmNetwork), [gm])
})

test('keeps only activities from the active network and group', () => {
  const first = activity({
    id: 'first',
    networkId: 'network-a',
    groupId: 'group0',
    from: account.addresses.standard,
  })
  const second = activity({
    id: 'second',
    networkId: 'network-b',
    groupId: 'group8',
    to: account.addresses.standard,
  })
  const wrongGroup = activity({
    id: 'wrong-group',
    networkId: 'network-a',
    groupId: 'group8',
    from: account.addresses.standard,
  })

  assert.deepEqual(
    filterActivitiesForAccount([first, second, wrongGroup], account, standardNetwork),
    [first],
  )
})

test('includes recipient matches case-insensitively and excludes other accounts', () => {
  const incoming = activity({
    id: 'incoming',
    to: account.addresses.standard.toUpperCase(),
  })
  const unrelated = activity({
    id: 'unrelated',
    from: '0xEe00000000000000000000000000000000000005',
    to: '0xFf00000000000000000000000000000000000006',
  })

  assert.deepEqual(filterActivitiesForAccount([incoming, unrelated], account, standardNetwork), [incoming])
})

test('does not match a standard address against a GM activity', () => {
  const wrongCryptoAddress = activity({
    id: 'wrong-crypto',
    crypto: 'gm',
    from: account.addresses.standard,
  })

  assert.deepEqual(filterActivitiesForAccount([wrongCryptoAddress], account, standardNetwork), [])
})

test('returns no activities when there is no active account', () => {
  assert.deepEqual(
    filterActivitiesForAccount(
      [activity({ from: account.addresses.standard })],
      undefined,
      standardNetwork,
    ),
    [],
  )
  assert.deepEqual(
    filterActivitiesForAccount([activity({from: account.addresses.standard})], account, null),
    [],
  )
})

test('activity count, empty state, and list all bind to the account-filtered computed', async () => {
  const source = (
    await Promise.all(
      [
        '../src/stores/walletHome.ts',
        '../src/components/home/WalletHomeView.vue',
        '../src/components/home/WalletActivityView.vue',
      ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
    )
  ).join('\n')

  assert.match(
    source,
    /const currentAccountActivities = computed\(\(\) =>[\s\S]*?filterActivitiesForAccount\([\s\S]*?snapshot\.value\.activities,[\s\S]*?session\.activeAccount,[\s\S]*?session\.activeNetwork/,
  )
  assert.match(
    source,
    /<span v-if="home\.currentAccountActivities\.length">[\s\S]*?\{\{\s*home\.currentAccountActivities\.length\s*\}\}[\s\S]*?<\/span>/,
  )
  assert.match(source, /v-else-if="!currentAccountActivities\.length"/)
  assert.match(source, /v-for="activity in currentAccountActivities"/)
  assert.doesNotMatch(source, /v-(?:if|else-if|for)="[^"]*homeSnapshot\.activities/)
})
