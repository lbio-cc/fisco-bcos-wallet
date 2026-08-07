import {
	deriveAccountMaterial,
	deriveMnemonicAccount,
	generateMnemonic,
	normalizeMnemonic,
	validateMnemonic,
} from '../mnemonic/mnemonicService.ts'
import type {OpenedVault} from '../vault/encryptedVault.ts'
import {EncryptedVault} from '../vault/encryptedVault.ts'
import {
	type FiscoV0TransactionData,
	signAndEncodeFiscoV0Transaction,
	type SignedFiscoTransaction,
} from '../transaction/fiscoV0Transaction.ts'
import {
	signAndEncodeWeb3Transaction,
	type SignedWeb3Transaction,
	type Web3TransactionData,
} from '../transaction/web3Transaction.ts'
import type {
	AddDerivedAccountInput,
	CreateMnemonicWalletInput,
	DeleteAccountInput,
	ExportMnemonicInput,
	ExportPrivateKeyInput,
	MnemonicExportResult,
	PrivateKeyExportResult,
	ResetWalletInput,
	RestoreMnemonicWalletInput,
	SelectAccountInput,
	UnlockWalletInput,
	UpdateAccountInput,
	WalletAccountSummary,
	WalletCreationResult,
	WalletRepository,
	WalletSessionStore,
	WalletStatus,
	WalletSummary,
	WalletVaultPayload,
} from './types.ts'

export const DEFAULT_WALLET_IDLE_TIMEOUT_MS = 15 * 60_000

export class MnemonicWalletManager {
	private unlockedPayload?: WalletVaultPayload
	private unlockedVault?: OpenedVault<WalletVaultPayload>
	private mutationQueue: Promise<void> = Promise.resolve()

	constructor(
		private readonly repository: WalletRepository,
		private readonly vault = new EncryptedVault(),
		private readonly sessionStore?: WalletSessionStore,
		private readonly idleTimeoutMs = DEFAULT_WALLET_IDLE_TIMEOUT_MS,
		private readonly now: () => number = Date.now,
	) {
	}

	async getStatus(): Promise<WalletStatus> {
		await this.expireUnlockedSessionIfNeeded()
		const [summary, envelope] = await Promise.all([
			this.repository.getSummary(),
			this.repository.getEnvelope(),
		])
		if (!!summary !== !!envelope) throw new Error('钱包存储不完整，需要进行恢复或重置')
		if (summary && envelope && !this.unlockedPayload) {
			await this.restoreSession(envelope, summary)
		}
		return summary
			? {initialized: true, locked: !this.unlockedPayload, summary}
			: {initialized: false, locked: true}
	}

	async getSummary(): Promise<WalletSummary | undefined> {
		return (await this.getStatus()).summary
	}

	async signFiscoV0Transaction(
		from: string,
		data: FiscoV0TransactionData,
		expectedCrypto: 'standard' | 'gm',
	): Promise<SignedFiscoTransaction> {
		const {payload, summary} = await this.requireUnlocked()
		const accountSummary = summary.accounts.find(
			(candidate) => candidate.addresses[expectedCrypto].toLowerCase() === from.toLowerCase(),
		)
		if (!accountSummary) throw new Error('签名账户不属于当前钱包或当前群组')
		const account = payload.accounts.find((candidate) => candidate.index === accountSummary.index)
		if (!account) throw new Error('钱包账户数据不完整')
		const material = deriveAccountMaterial(account.privateKey, expectedCrypto)

		return signAndEncodeFiscoV0Transaction(data, {
			crypto: expectedCrypto,
			privateKey: account.privateKey,
			publicKey: material.publicKey,
		})
	}

	async signWeb3Transaction(
		from: string,
		data: Web3TransactionData,
	): Promise<SignedWeb3Transaction> {
		const {payload, summary} = await this.requireUnlocked()
		const accountSummary = summary.accounts.find(
			(candidate) => candidate.addresses.standard.toLowerCase() === from.toLowerCase(),
		)
		if (!accountSummary) throw new Error('签名账户不属于当前钱包或当前 Web3 网络')
		const account = payload.accounts.find((candidate) => candidate.index === accountSummary.index)
		if (!account) throw new Error('钱包账户数据不完整')
		return signAndEncodeWeb3Transaction(data, account.privateKey)
	}

	async create(input: CreateMnemonicWalletInput): Promise<WalletCreationResult> {
		const mnemonic = generateMnemonic(input.wordCount)
		return this.serializeMutation(() =>
			this.initialize(input.name, mnemonic, input.password, false),
		)
	}

	async restore(input: RestoreMnemonicWalletInput): Promise<WalletCreationResult> {
		const mnemonic = normalizeMnemonic(input.mnemonic)
		if (!validateMnemonic(mnemonic)) throw new Error('助记词无效，请检查单词和顺序')
		return this.serializeMutation(() =>
			this.initialize(input.name, mnemonic, input.password, true),
		)
	}

	async confirmBackup(): Promise<WalletSummary> {
		return this.serializeMutation(async () => {
			const summary = await this.repository.getSummary()
			if (!summary) throw new Error('钱包尚未初始化')
			if (summary.backupConfirmed) return summary
			const updated = {...summary, backupConfirmed: true}
			await this.repository.setSummary(updated)
			return updated
		})
	}

	async unlock(input: UnlockWalletInput): Promise<WalletStatus> {
		return this.serializeMutation(async () => {
			const [summary, envelope] = await Promise.all([
				this.repository.getSummary(),
				this.repository.getEnvelope(),
			])
			if (!summary && !envelope) throw new Error('钱包尚未初始化')
			if (!summary || !envelope) throw new Error('钱包存储不完整，需要进行恢复或重置')
			if (!input.password) throw new Error('请输入钱包密码')

			const opened = await this.vault.openWithSession<WalletVaultPayload>(envelope, input.password)
			this.assertPayloadMatchesSummary(opened.value, summary)
			await this.setUnlocked(opened)
			return {initialized: true, locked: false, summary}
		})
	}

	async lock(): Promise<WalletStatus> {
		return this.serializeMutation(async () => {
			this.unlockedPayload = undefined
			this.unlockedVault = undefined
			await this.sessionStore?.clear()
			return this.getStatus()
		})
	}

	getAutoLockDeadline(): Promise<number | undefined> {
		return this.sessionStore?.getExpiresAt?.() ?? Promise.resolve(undefined)
	}

	lockIfIdle(): Promise<WalletStatus | undefined> {
		return this.serializeMutation(async () => {
			const expiresAt = await this.sessionStore?.getExpiresAt?.()
			if (expiresAt !== undefined && expiresAt > this.now()) return undefined
			const summary = await this.repository.getSummary()
			const hadSession = !!this.unlockedPayload || !!(await this.sessionStore?.getKey())
			if (!hadSession) return undefined
			this.unlockedPayload = undefined
			this.unlockedVault = undefined
			await this.sessionStore?.clear()
			return summary
				? {initialized: true, locked: true, summary}
				: {initialized: false, locked: true}
		})
	}

	async addAccount(input: AddDerivedAccountInput): Promise<WalletSummary> {
		return this.serializeMutation(async () => {
			const {payload: current, summary} = await this.requireUnlocked()
			const payload = cloneWalletPayload(current)
			const name = this.validateAccountName(input.name)
			const remark = this.validateRemark(input.remark ?? '')
			const index = payload.wallet.nextAccountIndex
			if (index >= 0x80000000) throw new Error('账户派生索引已达到上限')
			const derived = deriveMnemonicAccount(payload.wallet.mnemonic, index)
			const createdAt = new Date().toISOString()
			payload.wallet.nextAccountIndex = index + 1
			payload.accounts.push({
				index,
				name,
				remark,
				privateKey: derived.privateKey,
				derivationPath: derived.derivationPath,
				derivationScheme: derived.derivationScheme,
				createdAt,
			})
			const updated = this.summaryWithAccounts(summary, payload, index)
			await this.persist(payload, updated)
			return updated
		})
	}

	async updateAccount(input: UpdateAccountInput): Promise<WalletSummary> {
		return this.serializeMutation(async () => {
			const {payload: current, summary} = await this.requireUnlocked()
			const payload = cloneWalletPayload(current)
			const account = payload.accounts.find((candidate) => candidate.index === input.index)
			if (!account) throw new Error('账户不存在')
			account.name = this.validateAccountName(input.name)
			account.remark = this.validateRemark(input.remark)
			const updated = this.summaryWithAccounts(summary, payload, summary.activeAccountIndex)
			await this.persist(payload, updated)
			return updated
		})
	}

	async selectAccount(input: SelectAccountInput): Promise<WalletSummary> {
		return this.serializeMutation(async () => {
			const {payload, summary} = await this.requireUnlocked()
			if (!payload.accounts.some((account) => account.index === input.index)) {
				throw new Error('账户不存在')
			}
			const updated = this.summaryWithAccounts(summary, payload, input.index)
			await this.repository.setSummary(updated)
			return updated
		})
	}

	async deleteAccount(input: DeleteAccountInput): Promise<WalletSummary> {
		return this.serializeMutation(async () => {
			const {payload: current, summary} = await this.requireUnlocked()
			const payload = cloneWalletPayload(current)
			if (payload.accounts.length <= 1) throw new Error('至少需要保留一个账户')
			const position = payload.accounts.findIndex((account) => account.index === input.index)
			if (position < 0) throw new Error('账户不存在')
			payload.accounts.splice(position, 1)
			const activeIndex =
				summary.activeAccountIndex === input.index
					? payload.accounts[0]!.index
					: summary.activeAccountIndex
			const updated = this.summaryWithAccounts(summary, payload, activeIndex)
			await this.persist(payload, updated)
			return updated
		})
	}

	async exportMnemonic(input: ExportMnemonicInput): Promise<MnemonicExportResult> {
		const {payload} = await this.openForExport(input)
		return {mnemonic: payload.wallet.mnemonic}
	}

	async exportPrivateKey(input: ExportPrivateKeyInput): Promise<PrivateKeyExportResult> {
		const {payload} = await this.openForExport(input)
		if (!Number.isInteger(input.accountIndex) || input.accountIndex < 0) {
			throw new Error('账户索引无效')
		}
		const account = payload.accounts.find((candidate) => candidate.index === input.accountIndex)
		if (!account) throw new Error('账户不存在')
		return {accountIndex: account.index, privateKey: account.privateKey}
	}

	async reset(input: ResetWalletInput): Promise<WalletStatus> {
		return this.serializeMutation(async () => {
			if (input.confirmation.trim() !== '重置钱包') {
				throw new Error('请输入“重置钱包”以确认永久删除')
			}
			const [summary, envelope] = await Promise.all([
				this.repository.getSummary(),
				this.repository.getEnvelope(),
			])
			if (!summary && !envelope) throw new Error('钱包尚未初始化')

			this.unlockedPayload = undefined
			this.unlockedVault = undefined
			await this.sessionStore?.clear()
			await this.repository.reset()
			return {initialized: false, locked: true}
		})
	}

	private async initialize(
		rawName: string,
		mnemonic: string,
		password: string,
		backupConfirmed: boolean,
	): Promise<WalletCreationResult> {
		if (await this.repository.getEnvelope()) throw new Error('钱包已经初始化，不能覆盖现有钱包')
		const name = rawName.trim()
		if (!name || name.length > 40) throw new Error('钱包名称长度必须为 1–40 个字符')
		if (password.length < 10) throw new Error('钱包密码至少需要 10 个字符')
		if (password.length > 256) throw new Error('钱包密码不能超过 256 个字符')

		const account = deriveMnemonicAccount(mnemonic, 0)
		const createdAt = new Date().toISOString()
		const id = cryptoRandomId()
		const wordCount = mnemonic.split(' ').length as 12 | 24
		const accountSummary: WalletAccountSummary = {
			index: 0,
			name: '账户 1',
			remark: '',
			addresses: account.addresses,
			publicKeys: account.publicKeys,
			derivationPath: account.derivationPath,
			derivationScheme: account.derivationScheme,
			createdAt,
		}
		const summary: WalletSummary = {
			id,
			name,
			derivationPath: account.derivationPath,
			derivationScheme: account.derivationScheme,
			wordCount,
			backupConfirmed,
			createdAt,
			activeAccountIndex: 0,
			accounts: [accountSummary],
		}
		const payload: WalletVaultPayload = {
			version: 2,
			wallet: {
				id,
				name,
				source: 'mnemonic',
				mnemonic,
				wordCount,
				createdAt,
				nextAccountIndex: 1,
			},
			accounts: [
				{
					index: 0,
					name: '账户 1',
					remark: '',
					privateKey: account.privateKey,
					derivationPath: account.derivationPath,
					derivationScheme: account.derivationScheme,
					createdAt,
				},
			],
		}
		const envelope = await this.vault.seal(payload, password)
		await this.repository.save(envelope, summary)
		await this.setUnlocked(await this.vault.openWithSession(envelope, password))
		return {mnemonic, summary}
	}

	private async setUnlocked(opened: OpenedVault<WalletVaultPayload>): Promise<void> {
		try {
			await this.sessionStore?.setKey(opened.sessionKey)
			await this.sessionStore?.setExpiresAt?.(this.now() + this.idleTimeoutMs)
		} catch (error) {
			await this.sessionStore?.clear().catch(() => undefined)
			throw error
		}
		this.unlockedVault = opened
		this.unlockedPayload = opened.value
	}

	private async restoreSession(
		envelope: Parameters<EncryptedVault['resumeWithSession']>[0],
		summary: WalletSummary,
	): Promise<void> {
		const sessionKey = await this.sessionStore?.getKey()
		if (!sessionKey) return
		if (this.sessionStore?.getExpiresAt) {
			const expiresAt = await this.sessionStore.getExpiresAt()
			if (expiresAt === undefined || expiresAt <= this.now()) {
				await this.sessionStore.clear()
				return
			}
		}
		try {
			const opened = await this.vault.resumeWithSession<WalletVaultPayload>(envelope, sessionKey)
			this.assertPayloadMatchesSummary(opened.value, summary)
			this.unlockedVault = opened
			this.unlockedPayload = opened.value
		} catch {
			this.unlockedVault = undefined
			this.unlockedPayload = undefined
			await this.sessionStore?.clear()
		}
	}

	private assertPayloadMatchesSummary(payload: WalletVaultPayload, summary: WalletSummary): void {
		if (
			payload?.version !== 2 ||
			payload.wallet?.id !== summary.id ||
			payload.accounts.length !== summary.accounts.length ||
			!payload.accounts.every((account) => {
				const publicAccount = summary.accounts.find((candidate) => candidate.index === account.index)
				if (!publicAccount) return false
				const material = deriveSummaryMaterial(account.privateKey)
				return (
					account.derivationPath === publicAccount.derivationPath &&
					account.derivationScheme === publicAccount.derivationScheme &&
					material.addresses.standard === publicAccount.addresses.standard &&
					material.addresses.gm === publicAccount.addresses.gm &&
					material.publicKeys.standard === publicAccount.publicKeys.standard &&
					material.publicKeys.gm === publicAccount.publicKeys.gm
				)
			})
		) {
			throw new Error('钱包数据已损坏，无法安全解锁')
		}
		const active = summary.accounts.find(
			(candidate) => candidate.index === summary.activeAccountIndex,
		)
		if (
			!active ||
			active.derivationPath !== summary.derivationPath ||
			active.derivationScheme !== summary.derivationScheme
		) {
			throw new Error('钱包数据已损坏，无法安全解锁')
		}
	}

	private async requireUnlocked(): Promise<{
		payload: WalletVaultPayload
		summary: WalletSummary
	}> {
		await this.expireUnlockedSessionIfNeeded()
		if (!this.unlockedPayload || !this.unlockedVault) throw new Error('钱包已锁定，请先解锁')
		const summary = await this.repository.getSummary()
		if (!summary) throw new Error('钱包尚未初始化')
		await this.sessionStore?.setExpiresAt?.(this.now() + this.idleTimeoutMs)
		return {payload: this.unlockedPayload, summary}
	}

	private async expireUnlockedSessionIfNeeded(): Promise<void> {
		if (!this.unlockedPayload || !this.sessionStore?.getExpiresAt) return
		const expiresAt = await this.sessionStore.getExpiresAt()
		if (expiresAt !== undefined && expiresAt > this.now()) return
		this.unlockedPayload = undefined
		this.unlockedVault = undefined
		await this.sessionStore.clear()
	}

	private async openForExport(input: {
		password: string
		riskAccepted: true
	}): Promise<{ payload: WalletVaultPayload; summary: WalletSummary }> {
		if (input.riskAccepted !== true) throw new Error('请先确认并接受密钥泄露风险')
		if (!input.password) throw new Error('请输入钱包密码')
		const [summary, envelope] = await Promise.all([
			this.repository.getSummary(),
			this.repository.getEnvelope(),
		])
		if (!summary && !envelope) throw new Error('钱包尚未初始化')
		if (!summary || !envelope) throw new Error('钱包存储不完整，需要进行恢复或重置')
		const payload = await this.vault.open<WalletVaultPayload>(envelope, input.password)
		this.assertPayloadMatchesSummary(payload, summary)
		return {payload, summary}
	}

	private async persist(payload: WalletVaultPayload, summary: WalletSummary): Promise<void> {
		if (!this.unlockedVault) throw new Error('钱包已锁定，请先解锁')
		const envelope = await this.unlockedVault.reseal(payload)
		await this.repository.save(envelope, summary)
		this.unlockedPayload = payload
	}

	private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutationQueue.then(operation)
		this.mutationQueue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	private summaryWithAccounts(
		summary: WalletSummary,
		payload: WalletVaultPayload,
		activeAccountIndex: number,
	): WalletSummary {
		const accounts: WalletAccountSummary[] = payload.accounts.map((account) => ({
			index: account.index,
			name: account.name,
			remark: account.remark,
			...deriveSummaryMaterial(account.privateKey),
			derivationPath: account.derivationPath,
			derivationScheme: account.derivationScheme,
			createdAt: account.createdAt,
		}))
		const active = accounts.find((account) => account.index === activeAccountIndex)
		if (!active) throw new Error('当前账户不存在')
		return {
			...summary,
			derivationPath: active.derivationPath,
			derivationScheme: active.derivationScheme,
			activeAccountIndex,
			accounts,
		}
	}

	private validateAccountName(rawName: string): string {
		const name = rawName.trim()
		if (!name || name.length > 40) throw new Error('账户名称长度必须为 1–40 个字符')
		return name
	}

	private validateRemark(rawRemark: string): string {
		const remark = rawRemark.trim()
		if (remark.length > 120) throw new Error('账户备注不能超过 120 个字符')
		return remark
	}
}

const cloneWalletPayload = (payload: WalletVaultPayload): WalletVaultPayload => ({
	...payload,
	wallet: {...payload.wallet},
	accounts: payload.accounts.map((account) => ({...account})),
})

const deriveSummaryMaterial = (
	privateKey: `0x${string}`,
): Pick<WalletAccountSummary, 'addresses' | 'publicKeys'> => {
	const standard = deriveAccountMaterial(privateKey, 'standard')
	const gm = deriveAccountMaterial(privateKey, 'gm')
	return {
		addresses: {standard: standard.address, gm: gm.address},
		publicKeys: {standard: standard.publicKey, gm: gm.publicKey},
	}
}

const cryptoRandomId = (): string => {
	if (!globalThis.crypto?.randomUUID) throw new Error('Secure random UUID is unavailable')
	return globalThis.crypto.randomUUID()
}
