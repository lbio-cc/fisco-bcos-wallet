import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  decodeBool,
  decodeString,
  decodeUint,
  encodeCall,
  erc165InterfaceId,
  functionSelector,
  normalizeContractAddress,
  normalizeAssetRecipient,
  parseTokenAmount,
} from '../src/core/assets/abi.ts'
import {
  fitMetadataBudget,
  replaceMetadataAfterCompletePass,
} from '../src/core/assets/metadataCache.ts'
import { AssetService } from '../src/core/assets/assetService.ts'
import { readNativeBalance } from '../src/core/assets/nativeBalance.ts'
import { ERC721_ENUMERABLE_SIGNATURES, ERC721_SIGNATURES } from '../src/core/assets/assetService.ts'
import {
  assetChainKey,
  effectiveAssetName,
  effectiveAssetSymbol,
  isAssetRequest,
  networkChainKey,
  NFT_AUTO_REFRESH_LIMIT,
  resolveAssetChainIdentity,
  trackedAssetBelongsToAccount,
} from '../src/shared/assetMessages.ts'

const uintWord = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`

test('asset ABI codec validates addresses, selectors, and strict primitive decodes', () => {
  assert.equal(functionSelector('supportsInterface(bytes4)', 'standard'), '01ffc9a7')
  assert.equal(functionSelector('supportsInterface(bytes4)', 'gm'), 'ea7eb798')
  assert.equal(erc165InterfaceId(ERC721_SIGNATURES, 'standard'), '0x80ac58cd')
  assert.equal(erc165InterfaceId(ERC721_ENUMERABLE_SIGNATURES, 'standard'), '0x780e9d63')
  assert.equal(erc165InterfaceId(ERC721_SIGNATURES, 'gm'), '0x30933fef')
  assert.equal(erc165InterfaceId(ERC721_ENUMERABLE_SIGNATURES, 'gm'), '0x111daba6')
  assert.throws(() => erc165InterfaceId([], 'standard'), /至少一个/)
  assert.equal(
    normalizeContractAddress(' 0x1234567890ABCDEF1234567890abcdef12345678 '),
    '0x1234567890abcdef1234567890abcdef12345678',
  )
  assert.throws(() => normalizeContractAddress('0x0000000000000000000000000000000000000000'), /零地址/)
  assert.equal(normalizeAssetRecipient('0x1234567890ABCDEF1234567890abcdef12345678'), '0x1234567890abcdef1234567890abcdef12345678')
  assert.throws(() => normalizeAssetRecipient('0x0000000000000000000000000000000000000000'), /零地址/)
  assert.equal(parseTokenAmount('12.345', 6), 12345000n)
  assert.throws(() => parseTokenAmount('1.001', 2), /2 位小数/)
  assert.equal(
    encodeCall('balanceOf(address)', 'standard', [
      { type: 'address', value: '0x1234567890abcdef1234567890abcdef12345678' },
    ]),
    '0x70a082310000000000000000000000001234567890abcdef1234567890abcdef12345678',
  )
  assert.equal(decodeUint(uintWord(42)), 42n)
  assert.equal(decodeBool(uintWord(1)), true)
  assert.throws(() => decodeBool(uintWord(2)), /布尔/)
  assert.equal(decodeString(`0x${'20'.padStart(64, '0')}${'3'.padStart(64, '0')}414243${'0'.repeat(58)}`), 'ABC')
})

test('normalizes native chain balances without mixing them into tracked assets', () => {
  assert.equal(readNativeBalance('0xde0b6b3a7640000'), '1000000000000000000')
  assert.equal(readNativeBalance({balance: '42'}), '42')
  assert.equal(readNativeBalance({value: 7}), '7')
  assert.throws(() => readNativeBalance('invalid'), /无效的余额/)
  assert.throws(() => readNativeBalance(-1), /无效的余额/)
})

test('GM ERC721 detection uses SM3 selector and left-aligned GM interface IDs', async () => {
  const calls = []
  const adapter = {
    mode: 'web3',
    async request(request) {
      if (request.method === 'eth_getCode') return '0x6001'
      const data = request.params[0].data
      calls.push(data)
      if (data.startsWith('0xea7eb798')) return uintWord(1)
      if (data.startsWith(`0x${functionSelector('name()', 'gm')}`)) {
        return `0x${Buffer.from('国密ERC721').toString('hex').padEnd(64, '0')}`
      }
      if (data.startsWith(`0x${functionSelector('symbol()', 'gm')}`)) {
        return `0x${Buffer.from('GMNFT').toString('hex').padEnd(64, '0')}`
      }
      if (data.startsWith(`0x${functionSelector('balanceOf(address)', 'gm')}`)) return uintWord(1)
      throw new Error(`unexpected call ${data}`)
    },
  }
  const network = {
    id: 'gm-net',
    name: 'FISCO 国密链',
    rpcUrl: 'https://rpc.example',
    mode: 'web3',
    crypto: 'gm',
    chainId: 20200,
    groupId: 'group0',
  }
  const service = new AssetService(adapter, network)
  const asset = await service.detect(
    '0x1234567890abcdef1234567890abcdef12345678',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  )
  assert.equal(asset.kind, 'erc721')
  assert.equal(asset.account, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(asset.selectorCrypto, 'gm')
  assert.deepEqual(asset.chainIdentity, {
    networkName: 'FISCO 国密链',
    networkId: 'gm-net',
    chainId: 20200,
    groupId: 'group0',
    crypto: 'gm',
  })
  assert.equal(
    calls[0],
    `0xea7eb798${'30933fef'.padEnd(64, '0')}`,
  )
  assert.equal(
    calls[1],
    `0xea7eb798${'111daba6'.padEnd(64, '0')}`,
  )
  assert.ok(calls.includes(`0x01ffc9a7${'80ac58cd'.padEnd(64, '0')}`))
  assert.ok(calls.includes(`0x01ffc9a7${'780e9d63'.padEnd(64, '0')}`))
})

test('GM-network ERC721 detection also accepts the standard ERC165 selector dialect', async () => {
  const calls = []
  const adapter = {
    mode: 'web3',
    async request(request) {
      if (request.method === 'eth_getCode') return '0x6001'
      const data = request.params[0].data
      calls.push(data)
      if (data.startsWith('0x01ffc9a7')) return uintWord(1)
      if (data.startsWith(`0x${functionSelector('name()', 'standard')}`)) {
        return `0x${Buffer.from('Standard NFT').toString('hex').padEnd(64, '0')}`
      }
      if (data.startsWith(`0x${functionSelector('symbol()', 'standard')}`)) {
        return `0x${Buffer.from('SNFT').toString('hex').padEnd(64, '0')}`
      }
      if (data.startsWith(`0x${functionSelector('balanceOf(address)', 'standard')}`)) {
        return uintWord(1)
      }
      throw new Error(`unsupported selector ${data.slice(0, 10)}`)
    },
  }
  const network = {
    id: 'gm-net',
    name: 'FISCO 国密链',
    rpcUrl: 'https://rpc.example',
    mode: 'web3',
    crypto: 'gm',
    chainId: 20200,
    groupId: 'group0',
  }
  const service = new AssetService(adapter, network)
  const asset = await service.detect(
    '0x1234567890abcdef1234567890abcdef12345678',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  )
  assert.equal(asset.kind, 'erc721')
  assert.equal(asset.selectorCrypto, 'standard')
  assert.ok(calls.some((data) => data.startsWith('0xea7eb798')))
  assert.ok(calls.some((data) => data.startsWith('0x01ffc9a7')))
  assert.equal(calls.some((data) => data.startsWith('0x46b13615')), false)
})

test('enumerable threshold becomes manual-only only above the exact 50 boundary', async () => {
  let count = 50n
  const adapter = {
    mode: 'web3',
    async request(request) {
      const selector = request.params[0].data.slice(0, 10)
      if (selector === '0x70a08231') return uintWord(count)
      if (selector === '0x2f745c59') {
        const index = BigInt(`0x${request.params[0].data.slice(-64)}`)
        return uintWord(index + 100n)
      }
      throw new Error(`unexpected selector ${selector}`)
    },
  }
  const network = { id: 'net', crypto: 'standard' }
  const service = new AssetService(adapter, network)
  const asset = {
    networkId: 'net',
    contract: '0x1234567890abcdef1234567890abcdef12345678',
    kind: 'erc721',
    name: 'Cabinet',
    symbol: 'CAB',
    addedAt: 1,
  }
  const atLimit = await service.enumerate(asset, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(NFT_AUTO_REFRESH_LIMIT, 50)
  assert.equal(atLimit.manualOnly, false)
  assert.equal(atLimit.tokenIds.length, 50)
  count = 51n
  const overLimit = await service.enumerate(asset, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(overLimit.manualOnly, true)
  assert.equal(overLimit.tokenIds.length, 0)
  const manual = await service.enumerate(
    asset,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    { includeLargeCollection: true, concurrency: 4 },
  )
  assert.equal(manual.manualOnly, true)
  assert.equal(manual.tokenIds.length, 51)
})

test('metadata cache only prunes after a complete pass and evicts deterministic LRU records', () => {
  const previous = {
    old: { tokenId: 'old', tokenUri: 'ipfs://old', attributes: [], lastAccessedAt: 1 },
  }
  const next = {
    new: { tokenId: 'new', tokenUri: 'ipfs://new', attributes: [], lastAccessedAt: 2 },
  }
  assert.deepEqual(replaceMetadataAfterCompletePass(previous, next, false), previous)
  assert.deepEqual(replaceMetadataAfterCompletePass(previous, next, true), next)

  const records = {
    oldest: { ...previous.old, description: 'x'.repeat(80), lastAccessedAt: 1 },
    newest: { ...next.new, description: 'x'.repeat(80), lastAccessedAt: 3 },
    middle: { ...next.new, tokenId: 'middle', description: 'x'.repeat(80), lastAccessedAt: 2 },
  }
  const fitted = fitMetadataBudget(records, 260)
  assert.ok(fitted.bytes <= 260)
  assert.ok(fitted.records.newest)
  assert.equal(fitted.records.oldest, undefined)
  assert.ok(fitted.omitted > 0)
})

test('asset runtime request guard rejects malformed and spoofable payload shapes', () => {
  assert.equal(isAssetRequest({ type: 'ASSET_GET_SNAPSHOT' }), true)
  assert.equal(isAssetRequest({ type: 'ASSET_ADD', contract: '0x1' }), true)
  assert.equal(isAssetRequest({ type: 'ASSET_ADD', contract: 1 }), false)
  assert.equal(isAssetRequest({ type: 'ASSET_REMOVE', contract: '0x1' }), false)
  assert.equal(isAssetRequest({ type: 'ASSET_REMOVE', contract: '0x1', chainKey: 'scope' }), true)
  assert.equal(isAssetRequest({ type: 'ASSET_REFRESH_METADATA', contract: '0x1', chainKey: 'scope' }), false)
  assert.equal(isAssetRequest({ type: 'ASSET_REFRESH_METADATA', contract: '0x1', chainKey: 'scope', tokenId: '' }), false)
  assert.equal(isAssetRequest({ type: 'ASSET_REFRESH_METADATA', contract: '0x1', chainKey: 'scope', tokenId: '42' }), true)
  assert.equal(isAssetRequest({ type: 'ASSET_UPDATE', contract: '0x1', chainKey: 'scope', customName: 'My token' }), true)
  assert.equal(isAssetRequest({ type: 'ASSET_UPDATE', contract: '0x1', chainKey: 'scope', customName: 12 }), false)
  assert.equal(isAssetRequest({ type: 'ASSET_SEND', contract: '0x1', chainKey: 'scope', recipient: '0x2', amount: '1' }), true)
  assert.equal(isAssetRequest({ type: 'ASSET_SEND', contract: '0x1', chainKey: 'scope', recipient: 2 }), false)
  assert.equal(isAssetRequest({ type: 'WALLET_HOME_GET_SNAPSHOT' }), false)
})

test('stable chain key ignores mutable network ids and display overrides remain optional', () => {
  const identity = {networkId: 'saved-a', networkName: 'A', crypto: 'gm', chainId: 20200, groupId: 'group0'}
  assert.equal(assetChainKey(identity), JSON.stringify(['gm', 20200, 'group0']))
  assert.equal(networkChainKey({...identity, id: 'saved-b'}), assetChainKey(identity))
  assert.notEqual(assetChainKey(identity), assetChainKey({...identity, groupId: 'group1'}))
  assert.equal(effectiveAssetName({name: 'Detected', customName: 'Custom'}), 'Custom')
  assert.equal(effectiveAssetName({name: 'Detected', customName: undefined}), 'Detected')
  assert.equal(effectiveAssetSymbol({symbol: 'DET', customSymbol: 'CUS'}), 'CUS')
})

test('tracked asset definitions are shared across accounts on the same chain', () => {
  const contract = '0x1111111111111111111111111111111111111111'
  const accountA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const accountB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const current = { networkId: 'n', account: accountA, contract }
  assert.equal(trackedAssetBelongsToAccount(current, accountA.toUpperCase(), []), true)
  assert.equal(trackedAssetBelongsToAccount(current, accountB, []), true)

  const legacy = { networkId: 'n', contract }
  const snapshots = [{ networkId: 'n', account: accountA, contract }]
  assert.equal(trackedAssetBelongsToAccount(legacy, accountA, snapshots), true)
  assert.equal(trackedAssetBelongsToAccount(legacy, accountB, snapshots), true)
  assert.equal(
    trackedAssetBelongsToAccount(legacy, accountA, [
      { networkId: 'other', account: accountA, contract },
    ]),
    true,
  )
})

test('asset repository serializes concurrent storage mutations', async () => {
  const storage = {}
  const previousChrome = globalThis.chrome
  globalThis.chrome = {
    runtime: { lastError: undefined },
    storage: {
      local: {
        get(key, callback) {
          setTimeout(() => callback({ [key]: storage[key] }), 2)
        },
        set(values, callback) {
          setTimeout(() => {
            Object.assign(storage, structuredClone(values))
            callback()
          }, 2)
        },
      },
    },
  }
  const { assetRepository } = await import(`../src/background/assetRepository.ts?test=${Date.now()}`)
  const accountA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const accountB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const contract = '0x1111111111111111111111111111111111111111'
  const chainIdentity = {networkId: 'n', networkName: 'N', crypto: 'standard', chainId: 1, groupId: 'group0'}
  const chainKey = assetChainKey(chainIdentity)
  const base = { networkId: 'n', chainIdentity, chainKey, kind: 'erc20', name: 'Token', symbol: 'T', decimals: 18, addedAt: 1 }
  await assetRepository.add({ ...base, account: accountA, contract })
  assert.equal((await assetRepository.read()).definitions.length, 1)
  assert.equal((await assetRepository.read()).definitions[0].account, undefined)
  await assert.rejects(
    assetRepository.add({ ...base, account: accountB, contract }),
    /当前网络/,
  )
  storage['wallet:assets'] = {
    definitions: [
      {...base, account: accountA, contract},
      {...base, account: accountB, contract, customName: 'Shared Token'},
    ],
    snapshots: [],
  }
  const migrated = await assetRepository.read()
  assert.equal(migrated.definitions.length, 1)
  assert.equal(migrated.definitions[0].account, undefined)
  assert.equal(migrated.definitions[0].customName, 'Shared Token')

  const snapshot = (account) => ({
    networkId: 'n',
    account,
    contract,
    rawBalance: '1',
    tokenIds: [],
    manualOnly: false,
    refreshState: 'success',
    metadataState: 'idle',
    metadata: {},
  })
  await assetRepository.updateSnapshot(snapshot(accountA))
  await assetRepository.updateSnapshot(snapshot(accountB))
  await assetRepository.updateSnapshot({
    ...snapshot(accountB),
    tokenIds: ['1', '2'],
    metadata: {
      '1': {tokenId: '1', tokenUri: 'ipfs://one', attributes: [], lastAccessedAt: 1},
    },
  })
  await assetRepository.mergeMetadata(
    {networkId: 'n', account: accountB, contract},
    '2',
    {tokenId: '2', tokenUri: 'ipfs://two', attributes: [], lastAccessedAt: 2},
  )
  assert.deepEqual(
    Object.keys((await assetRepository.read()).snapshots.find((item) => item.account === accountB).metadata),
    ['1', '2'],
  )
  await assetRepository.updateDisplay(chainKey, contract, 'Network Token', 'NT')
  await assetRepository.cleanupAccounts([accountA])
  const accountCleanup = await assetRepository.read()
  assert.equal(accountCleanup.definitions[0].customName, 'Network Token')
  assert.deepEqual(accountCleanup.snapshots.map((item) => item.account), [accountB])
  await assetRepository.remove(chainKey, 'n', contract)
  const scopedState = await assetRepository.read()
  assert.deepEqual(scopedState.definitions, [])
  assert.deepEqual(scopedState.snapshots, [])

  const legacy = {
    networkId: 'n', kind: 'erc20', name: 'Token', symbol: 'T', decimals: 18, addedAt: 1,
    contract: '0x3333333333333333333333333333333333333333',
  }
  const persisted = await assetRepository.read()
  storage['wallet:assets'] = {
    definitions: [...persisted.definitions, legacy],
    snapshots: [
      ...persisted.snapshots,
      { ...snapshot(accountA), contract: legacy.contract },
    ],
  }
  const matchingNetwork = {
    id: 'n',
    name: '旧资产匹配链',
    chainId: 20200,
    groupId: 'group0',
    crypto: 'gm',
  }
  const fallbackIdentity = resolveAssetChainIdentity(legacy, matchingNetwork)
  assert.deepEqual(fallbackIdentity, {
    networkName: '旧资产匹配链',
    networkId: 'n',
    chainId: 20200,
    groupId: 'group0',
    crypto: 'gm',
  })
  assert.equal(resolveAssetChainIdentity(legacy, { ...matchingNetwork, id: 'other' }), undefined)
  await assetRepository.enrichDefinition({
    ...legacy,
    account: accountA,
    chainIdentity: fallbackIdentity,
  })
  const enriched = (await assetRepository.read()).definitions.find((item) => item.contract === legacy.contract)
  assert.equal(enriched.account, undefined)
  assert.deepEqual(enriched.chainIdentity, fallbackIdentity)
  if (previousChrome === undefined) delete globalThis.chrome
  else globalThis.chrome = previousChrome
})

test('asset views separate tokens and default-visible collectibles while management owns mutations', async () => {
  const source = await readFile(
    new URL('../src/components/home/WalletAssetsView.vue', import.meta.url),
    'utf8',
  )
  for (const binding of [
    'AssetManagementDialog',
    'AssetNativeBalance',
    'AssetTokenList',
    'AssetNftGallery',
    'erc20Assets',
    'erc721Assets',
    'activeAssetContext',
    'watch(activeAssetContext',
    '管理资产',
    'class="asset-title"',
  ]) {
    assert.match(source, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(source, /CopyButton|asset-account|查看ERC721/)
  assert.doesNotMatch(source, /nft-card|token-mark/)

  const home = await readFile(
    new URL('../src/components/home/WalletHomeView.vue', import.meta.url),
    'utf8',
  )
  for (const binding of [
    'assets.invalidate()',
    'NATIVE_BALANCE_REFRESH_INTERVAL_MS',
    'NATIVE_BALANCE_MIN_REFRESH_INTERVAL_MS',
    'window.setInterval(refreshNativeBalance',
    'subscribeToSubmittedTransactions(refreshNativeBalance)',
    '@refresh-native="refreshNativeBalance"',
  ]) {
    assert.match(home, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  const nativeBalance = await readFile(
    new URL('../src/components/home/AssetNativeBalance.vue', import.meta.url),
    'utf8',
  )
  for (const binding of ['链余额', '原生资产', 'balance.rawBalance', 'balance.symbol', "@click=\"$emit('refresh')\""]) {
    assert.match(nativeBalance, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(nativeBalance, /ERC20|ERC721|TrackedAsset/)

  const tokenList = await readFile(new URL('../src/components/home/AssetTokenList.vue', import.meta.url), 'utf8')
  for (const binding of ['ERC20', 'effectiveAssetName', 'effectiveAssetSymbol', 'balance(asset)']) {
    assert.match(tokenList, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  const nftGallery = await readFile(new URL('../src/components/home/AssetNftGallery.vue', import.meta.url), 'utf8')
  for (const binding of [
    "const mode = ref<'grouped' | 'flat'>('flat')",
    "mode === 'grouped'",
    'asset.snapshot?.tokenIds',
    'flatNfts',
    'nft-card',
    'refreshNftMetadata',
    'metadata-refresh',
    '@click.stop',
    'role="alert"',
  ]) {
    assert.match(nftGallery, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  const sendView = await readFile(new URL('../src/components/views/AssetSendView.vue', import.meta.url), 'utf8')
  assert.match(sendView, /await assets\.runAction\('refresh', props\.asset\.contract, chainKey\)/)

  const receiveView = await readFile(new URL('../src/components/views/AssetReceiveView.vue', import.meta.url), 'utf8')
  for (const binding of ['我的接收地址', '选择链', 'chainDetail', 'QrcodeVue', '复制接收地址']) {
    assert.match(receiveView, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(receiveView, /defineProps|effectiveAssetName|effectiveAssetSymbol/)

  const sendSelection = await readFile(new URL('../src/components/views/AssetSendSelectionView.vue', import.meta.url), 'utf8')
  for (const binding of ['选择要发送的资产', 'erc20Assets', 'nftChoices', "emit('select', {asset})", '没有可发送的资产']) {
    assert.match(sendSelection, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  for (const binding of ['class="wallet-command-bar"', 'class="wallet-actions"', 'openSendSelection', "mode: 'select-send'", 'selectSendAsset', 'backFromSend']) {
    assert.match(home, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(home, /walletActionContext|wallet-context|当前网络|无活动账户|等待选择网络/)
  assert.match(home, /class="wallet-command-bar">\s*<nav[^>]*class="wallet-actions">[\s\S]*?发送[\s\S]*?接收[\s\S]*?<\/nav>\s*<\/section>/)
  assert.doesNotMatch(home, /#2457d6/)
  for (const assetView of [source, tokenList, nftGallery]) {
    assert.doesNotMatch(assetView, /@receive|emit\('receive'|receive:/)
  }

  const header = await readFile(new URL('../src/components/layout/WalletHeader.vue', import.meta.url), 'utf8')
  for (const menuDescription of [
    '在新标签页打开',
    '添加、切换或编辑备注',
    '验证或更新节点',
    '验证密码并确认风险',
    '结束当前会话',
    '进入二次确认',
  ]) {
    assert.doesNotMatch(header, new RegExp(menuDescription))
  }
  const dialog = await readFile(new URL('../src/components/home/AssetManagementDialog.vue', import.meta.url), 'utf8')
  for (const binding of ['submitAsset', 'saveEdit', 'refreshAll', 'cacheUsage', '确认删除', 'aria-modal="true"']) {
    assert.match(dialog, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(dialog, /刷新 metadata|run\('metadata'/)
})

test('touched asset components use nested scoped SCSS instead of flat selector lists', async () => {
  for (const file of ['WalletAssetsView.vue', 'AssetNativeBalance.vue', 'AssetTokenList.vue', 'AssetNftGallery.vue', 'AssetManagementDialog.vue']) {
    const source = await readFile(new URL(`../src/components/home/${file}`, import.meta.url), 'utf8')
    assert.match(source, /<style scoped lang="scss">/)
    assert.match(source, /\.[\w-]+\s*\{[\s\S]*?\n\s+\.[\w-]+\s*\{/)
  }
})

test('runtime shares definitions by stable chain key while snapshots remain account scoped', async () => {
  const runtime = await readFile(new URL('../src/background/assetRuntime.ts', import.meta.url), 'utf8')
  assert.match(runtime, /assetMatchesActiveChain/)
  assert.match(runtime, /storedKey === networkChainKey\(network\)/)
  assert.doesNotMatch(runtime, /trackedAssetBelongsToAccount/)
  assert.match(runtime, /requestedChainKey !== activeChainKey/)
  assert.match(runtime, /updateDisplay\(\s*message\.chainKey,\s*asset\.contract/)
  assert.match(runtime, /remove\(message\.chainKey, asset\.networkId, asset\.contract/)
  assert.match(runtime, /snapshot\.tokenIds\.includes\(tokenId\)/)
  assert.match(runtime, /mergeMetadata\(snapshot, tokenId, metadata\)/)
  assert.match(runtime, /refreshMetadata\(asset, network, account, message\.tokenId\)/)
  assert.match(runtime, /adapter\.mode === 'legacy' \? 'fisco_getBalance' : 'eth_getBalance'/)
  assert.match(runtime, /nativeBalance/)
  assert.match(runtime, /message\.type === 'ASSET_REFRESH_NATIVE'/)
})
