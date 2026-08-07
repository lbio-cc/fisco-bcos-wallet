import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveFiscoGmAddress,
  deriveMnemonicAccount,
  generateMnemonic,
  normalizeMnemonic,
  validateMnemonic,
} from '../src/core/mnemonic/mnemonicService.ts'
import { MnemonicWalletManager } from '../src/core/wallet/mnemonicWalletManager.ts'
import { EncryptedVault } from '../src/core/vault/encryptedVault.ts'

const VECTOR =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

class MemoryWalletRepository {
  envelope
  summary

  async getEnvelope() {
    return this.envelope
  }

  async getSummary() {
    return this.summary
  }

  async save(envelope, summary) {
    this.envelope = envelope
    this.summary = summary
  }

  async setSummary(summary) {
    this.summary = summary
  }

  async reset() {
    this.envelope = undefined
    this.summary = undefined
  }
}

class ObservedWalletRepository extends MemoryWalletRepository {
  activeSaves = 0
  maxConcurrentSaves = 0
  failNextSave = false

  async save(envelope, summary) {
    this.activeSaves += 1
    this.maxConcurrentSaves = Math.max(this.maxConcurrentSaves, this.activeSaves)
    try {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (this.failNextSave) {
        this.failNextSave = false
        throw new Error('模拟存储失败')
      }
      await super.save(envelope, summary)
    } finally {
      this.activeSaves -= 1
    }
  }
}

class MemoryWalletSessionStore {
  key
  expiresAt

  async getKey() {
    return this.key
  }

  async setKey(key) {
    this.key = key
  }

  async getExpiresAt() {
    return this.expiresAt
  }

  async setExpiresAt(expiresAt) {
    this.expiresAt = expiresAt
  }

  async clear() {
    this.key = undefined
    this.expiresAt = undefined
  }
}

test('generates valid 12 and 24 word BIP-39 mnemonics', () => {
  for (const wordCount of [12, 24]) {
    const mnemonic = generateMnemonic(wordCount)
    assert.equal(mnemonic.split(' ').length, wordCount)
    assert.equal(validateMnemonic(mnemonic), true)
  }
})

test('normalizes and rejects malformed mnemonics', () => {
  assert.equal(validateMnemonic(`  ${VECTOR.toUpperCase()}  `), true)
  assert.equal(normalizeMnemonic('  abandon   abandon  '), 'abandon abandon')
  assert.equal(validateMnemonic(`${VECTOR} wrong`), false)
})

test('matches the standard Ethereum BIP-44 vector used by FISCO standard accounts', () => {
  const account = deriveMnemonicAccount(VECTOR)
  assert.equal(account.derivationPath, "m/44'/60'/0'/0/0")
  assert.equal(account.addresses.standard, '0x9858effd232b4033e47d90003d41ec34ecaeda94')
  assert.equal(
    account.privateKey,
    '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727',
  )
})

test('uses one BIP-32 private key for standard and GM account views', () => {
  const account = deriveMnemonicAccount(VECTOR)
  assert.equal(account.derivationPath, "m/44'/60'/0'/0/0")
  assert.equal(account.derivationScheme, 'bip32-secp256k1-v1')
  assert.equal(
    account.privateKey,
    '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727',
  )
  assert.equal(account.addresses.gm, '0x54439a2fd6f2422c623160db529fc5114361fbde')
  assert.equal(account.publicKeys.gm.length, 130)
  assert.equal(account.privateKey.length, 66)

  const account12 = deriveMnemonicAccount(VECTOR, 12)
  assert.equal(account12.derivationPath, "m/44'/60'/0'/0/12")
  assert.equal(account12.addresses.gm, '0xc48d6734bddc6bbf4d9d564d5e158341f3176c91')
  assert.notEqual(account12.privateKey, account.privateKey)
})

test('calculates GM addresses like FISCO BCOS Java SDK CryptoKeyPair', () => {
  const account = deriveMnemonicAccount(VECTOR)
  assert.equal(deriveFiscoGmAddress(account.publicKeys.gm), account.addresses.gm)
  assert.equal(
    deriveFiscoGmAddress(`04${account.publicKeys.gm.slice(2)}`),
    account.addresses.gm,
  )
  assert.throws(() => deriveFiscoGmAddress('0x1234'), /64-byte uncompressed key/)
  const prefixLikeCoordinate = `0x04${'00'.repeat(63)}`
  assert.match(deriveFiscoGmAddress(prefixLikeCoordinate), /^0x[0-9a-f]{40}$/)
})

test('creates an encrypted wallet and marks backup only after confirmation', async () => {
  const repository = new MemoryWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  const result = await manager.create({
    name: '测试钱包',
    wordCount: 12,
    password: 'correct horse battery staple',
  })

  assert.equal(result.summary.backupConfirmed, false)
  assert.equal(JSON.stringify(repository.envelope).includes(result.mnemonic), false)
  const payload = await new EncryptedVault().open(
    repository.envelope,
    'correct horse battery staple',
  )
  assert.equal(payload.wallet.mnemonic, result.mnemonic)
  assert.equal(payload.accounts[0].privateKey.length, 66)
  assert.equal(result.summary.accounts[0].addresses.standard.length, 42)
  assert.equal(result.summary.accounts[0].addresses.gm.length, 42)
  const confirmed = await manager.confirmBackup()
  assert.equal(confirmed.backupConfirmed, true)
  await assert.rejects(
    () =>
      manager.create({
        name: '覆盖钱包',
        wordCount: 12,
        password: 'another safe password',
      }),
    /不能覆盖/,
  )
})

test('restores the same standard account from the same mnemonic', async () => {
  const repository = new MemoryWalletRepository()
  const result = await new MnemonicWalletManager(repository).restore({
    name: '恢复钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })
  assert.equal(
    result.summary.accounts[0].addresses.standard,
    '0x9858effd232b4033e47d90003d41ec34ecaeda94',
  )
  assert.equal(
    result.summary.accounts[0].addresses.gm,
    '0x54439a2fd6f2422c623160db529fc5114361fbde',
  )
  assert.equal(result.summary.backupConfirmed, true)
})

test('locks a restarted manager when no browser session store is configured', async () => {
  const repository = new MemoryWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  await manager.restore({
    name: '生命周期钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })

  assert.equal((await manager.getStatus()).locked, false)
  assert.equal((await manager.lock()).locked, true)
  await assert.rejects(
    () => manager.unlock({ password: 'wrong password' }),
    /密码错误或加密数据已损坏/,
  )
  assert.equal((await manager.getStatus()).locked, true)
  assert.equal(
    (await manager.unlock({ password: 'correct horse battery staple' })).locked,
    false,
  )

  const restartedManager = new MnemonicWalletManager(repository)
  assert.equal((await restartedManager.getStatus()).locked, true)
})

test('restores an unlocked wallet after a service worker restart within the browser session', async () => {
  const repository = new MemoryWalletRepository()
  const sessionStore = new MemoryWalletSessionStore()
  const manager = new MnemonicWalletManager(repository, undefined, sessionStore)
  await manager.restore({
    name: '会话钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })

  assert.equal(typeof sessionStore.key, 'string')
  assert.equal(sessionStore.key.includes('correct horse battery staple'), false)
  assert.equal(sessionStore.key.includes(VECTOR), false)

  const restartedManager = new MnemonicWalletManager(repository, undefined, sessionStore)
  assert.equal((await restartedManager.getStatus()).locked, false)
  const added = await restartedManager.addAccount({ name: '重启后账户' })
  assert.equal(added.accounts.length, 2)

  assert.equal((await restartedManager.lock()).locked, true)
  assert.equal(sessionStore.key, undefined)
  const afterExplicitLock = new MnemonicWalletManager(repository, undefined, sessionStore)
  assert.equal((await afterExplicitLock.getStatus()).locked, true)
})

test('discards an invalid browser session key and remains safely locked', async () => {
  const repository = new MemoryWalletRepository()
  const sessionStore = new MemoryWalletSessionStore()
  const manager = new MnemonicWalletManager(repository, undefined, sessionStore)
  await manager.restore({
    name: '失效会话钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })

  sessionStore.key = 'invalid-session-key'
  const restartedManager = new MnemonicWalletManager(repository, undefined, sessionStore)
  assert.equal((await restartedManager.getStatus()).locked, true)
  assert.equal(sessionStore.key, undefined)
})

test('extends the idle deadline on wallet use and locks after inactivity', async () => {
  const repository = new MemoryWalletRepository()
  const sessionStore = new MemoryWalletSessionStore()
  let now = 1_000
  const manager = new MnemonicWalletManager(
    repository,
    undefined,
    sessionStore,
    100,
    () => now,
  )
  await manager.restore({
    name: '自动锁定钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })
  assert.equal(sessionStore.expiresAt, 1_100)

  now = 1_050
  await manager.addAccount({ name: '延长会话' })
  assert.equal(sessionStore.expiresAt, 1_150)

  now = 1_151
  assert.equal((await manager.getStatus()).locked, true)
  assert.equal(sessionStore.key, undefined)
  assert.equal(sessionStore.expiresAt, undefined)
})

test('auto-lock wake returns a locked status only after the persisted deadline', async () => {
  const repository = new MemoryWalletRepository()
  const sessionStore = new MemoryWalletSessionStore()
  let now = 2_000
  const manager = new MnemonicWalletManager(
    repository,
    undefined,
    sessionStore,
    100,
    () => now,
  )
  await manager.restore({
    name: '闹钟钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })

  now = 2_099
  assert.equal(await manager.lockIfIdle(), undefined)
  now = 2_100
  const status = await manager.lockIfIdle()
  assert.equal(status.locked, true)
  assert.equal(status.initialized, true)
  assert.equal(await manager.lockIfIdle(), undefined)
})

test('adds, selects, annotates and deletes accounts under one mnemonic wallet', async () => {
  const repository = new MemoryWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  const created = await manager.restore({
    name: '多账户钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })

  const added = await manager.addAccount({ name: '部署账户', remark: '仅用于发布合约' })
  assert.equal(added.accounts.length, 2)
  assert.equal(added.activeAccountIndex, 1)
  assert.equal(added.accounts[1].derivationPath, "m/44'/60'/0'/0/1")
  assert.equal(added.accounts[1].remark, '仅用于发布合约')
  assert.notEqual(
    added.accounts[1].addresses.standard,
    created.summary.accounts[0].addresses.standard,
  )

  const renamed = await manager.updateAccount({
    index: 1,
    name: '运营账户',
    remark: '日常调用',
  })
  assert.equal(renamed.accounts[1].name, '运营账户')
  assert.equal(renamed.accounts[1].remark, '日常调用')

  const selected = await manager.selectAccount({ index: 0 })
  assert.equal(selected.activeAccountIndex, 0)
  assert.equal(
    selected.accounts[0].addresses.standard,
    created.summary.accounts[0].addresses.standard,
  )

  const removed = await manager.deleteAccount({ index: 1 })
  assert.equal(removed.accounts.length, 1)
  await assert.rejects(() => manager.deleteAccount({ index: 0 }), /至少需要保留一个账户/)

  const payload = await new EncryptedVault().open(
    repository.envelope,
    'correct horse battery staple',
  )
  assert.equal(payload.accounts.length, 1)
  await manager.lock()
  await assert.rejects(
    () => manager.addAccount({ name: '锁定后添加' }),
    /钱包已锁定/,
  )
})

test('uses monotonically increasing derivation indexes after account deletion', async () => {
  const repository = new MemoryWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  await manager.restore({
    name: '索引钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })
  await manager.addAccount({ name: '账户 2' })
  await manager.addAccount({ name: '账户 3' })
  await manager.deleteAccount({ index: 2 })

  const summary = await manager.addAccount({ name: '账户 4' })
  assert.deepEqual(
    summary.accounts.map((account) => account.index),
    [0, 1, 3],
  )
  assert.equal(summary.activeAccountIndex, 3)
  assert.equal(summary.accounts[2].derivationPath, "m/44'/60'/0'/0/3")
})

test('serializes concurrent wallet mutations without losing accounts', async () => {
  const repository = new ObservedWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  await manager.restore({
    name: '并发钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })
  repository.maxConcurrentSaves = 0

  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      manager.addAccount({ name: `并发账户 ${index + 2}` }),
    ),
  )

  assert.equal(repository.maxConcurrentSaves, 1)
  assert.deepEqual(
    repository.summary.accounts.map((account) => account.index),
    [0, 1, 2, 3, 4, 5],
  )
  const payload = await new EncryptedVault().open(
    repository.envelope,
    'correct horse battery staple',
  )
  assert.deepEqual(
    payload.accounts.map((account) => account.index),
    [0, 1, 2, 3, 4, 5],
  )
})

test('failed wallet persistence does not mutate the unlocked payload', async () => {
  const repository = new ObservedWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  await manager.restore({
    name: '失败恢复钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })

  repository.failNextSave = true
  await assert.rejects(
    () => manager.addAccount({ name: '不会保存的账户' }),
    /模拟存储失败/,
  )
  const summary = await manager.addAccount({ name: '正确账户' })

  assert.deepEqual(
    summary.accounts.map((account) => account.index),
    [0, 1],
  )
  assert.equal(summary.accounts[1].name, '正确账户')
})

test('requires explicit confirmation before permanently resetting a wallet', async () => {
  const repository = new MemoryWalletRepository()
  const sessionStore = new MemoryWalletSessionStore()
  const manager = new MnemonicWalletManager(repository, undefined, sessionStore)
  await manager.restore({
    name: '待重置钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })

  await assert.rejects(() => manager.reset({ confirmation: 'reset' }), /重置钱包/)
  assert.equal((await manager.getStatus()).initialized, true)

  const status = await manager.reset({ confirmation: '重置钱包' })
  assert.deepEqual(status, { initialized: false, locked: true })
  assert.equal(repository.envelope, undefined)
  assert.equal(repository.summary, undefined)
  assert.equal(sessionStore.key, undefined)
})

test('exports the mnemonic only after fresh password verification and risk confirmation', async () => {
  const repository = new MemoryWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  await manager.restore({
    name: '导出测试钱包',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })
  await manager.lock()

  await assert.rejects(
    () =>
      manager.exportMnemonic({
        password: 'correct horse battery staple',
        riskAccepted: false,
      }),
    /确认并接受/,
  )
  await assert.rejects(
    () => manager.exportMnemonic({ password: '', riskAccepted: true }),
    /请输入钱包密码/,
  )
  await assert.rejects(
    () => manager.exportMnemonic({ password: 'wrong password', riskAccepted: true }),
    /密码错误或加密数据已损坏/,
  )

  const exported = await manager.exportMnemonic({
    password: 'correct horse battery staple',
    riskAccepted: true,
  })
  assert.deepEqual(exported, { mnemonic: VECTOR })
  assert.equal((await manager.getStatus()).locked, true)
})

test('exports only the requested account private key after password verification', async () => {
  const repository = new MemoryWalletRepository()
  const manager = new MnemonicWalletManager(repository)
  await manager.restore({
    name: '私钥导出测试',
    mnemonic: VECTOR,
    password: 'correct horse battery staple',
  })
  await manager.addAccount({ name: '账户 2' })

  await assert.rejects(
    () =>
      manager.exportPrivateKey({
        accountIndex: 1,
        password: 'correct horse battery staple',
        riskAccepted: false,
      }),
    /确认并接受/,
  )
  await assert.rejects(
    () =>
      manager.exportPrivateKey({
        accountIndex: 99,
        password: 'correct horse battery staple',
        riskAccepted: true,
      }),
    /账户不存在/,
  )

  const exported = await manager.exportPrivateKey({
    accountIndex: 1,
    password: 'correct horse battery staple',
    riskAccepted: true,
  })
  assert.equal(exported.accountIndex, 1)
  assert.equal(exported.privateKey, deriveMnemonicAccount(VECTOR, 1).privateKey)
  assert.notEqual(exported.privateKey, deriveMnemonicAccount(VECTOR, 0).privateKey)
})
