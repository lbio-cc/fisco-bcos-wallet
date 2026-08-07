import type {VaultEnvelope} from '../vault/encryptedVault'
import type {MnemonicWordCount} from '../mnemonic/mnemonicService'
import type {CryptoKind, Hex} from '../../shared/types'

export interface WalletAccountSummary {
	index: number
	name: string
	remark: string
	addresses: Record<CryptoKind, Hex>
	publicKeys: Record<CryptoKind, Hex>
	derivationPath: string
	derivationScheme: 'bip32-secp256k1-v1'
	createdAt: string
}

export interface WalletSummary {
	id: string
	name: string
	derivationPath: string
	derivationScheme: 'bip32-secp256k1-v1'
	wordCount: MnemonicWordCount
	backupConfirmed: boolean
	createdAt: string
	activeAccountIndex: number
	accounts: WalletAccountSummary[]
}

export interface WalletStatus {
	initialized: boolean
	locked: boolean
	summary?: WalletSummary
}

export interface UnlockWalletInput {
	password: string
}

export interface ResetWalletInput {
	confirmation: string
}

export interface ExportMnemonicInput {
	password: string
	riskAccepted: true
}

export interface ExportPrivateKeyInput {
	accountIndex: number
	password: string
	riskAccepted: true
}

export interface MnemonicExportResult {
	mnemonic: string
}

export interface PrivateKeyExportResult {
	accountIndex: number
	privateKey: Hex
}

export interface CreateMnemonicWalletInput {
	name: string
	wordCount: MnemonicWordCount
	password: string
}

export interface RestoreMnemonicWalletInput {
	name: string
	mnemonic: string
	password: string
}

export interface WalletCreationResult {
	mnemonic: string
	summary: WalletSummary
}

export interface AddDerivedAccountInput {
	name: string
	remark?: string
}

export interface UpdateAccountInput {
	index: number
	name: string
	remark: string
}

export interface SelectAccountInput {
	index: number
}

export interface DeleteAccountInput {
	index: number
}

export interface WalletVaultPayload {
	version: 2
	wallet: {
		id: string
		name: string
		source: 'mnemonic'
		mnemonic: string
		wordCount: MnemonicWordCount
		createdAt: string
		nextAccountIndex: number
	}
	accounts: Array<{
		index: number
		name: string
		remark: string
		privateKey: Hex
		derivationPath: string
		derivationScheme: WalletSummary['derivationScheme']
		createdAt: string
	}>
}

export interface WalletRepository {
	getEnvelope(): Promise<VaultEnvelope | undefined>

	getSummary(): Promise<WalletSummary | undefined>

	save(envelope: VaultEnvelope, summary: WalletSummary): Promise<void>

	setSummary(summary: WalletSummary): Promise<void>

	reset(): Promise<void>
}

export interface WalletSessionStore {
	getKey(): Promise<string | undefined>

	setKey(key: string): Promise<void>

	getExpiresAt?(): Promise<number | undefined>

	setExpiresAt?(expiresAt: number): Promise<void>

	clear(): Promise<void>
}
