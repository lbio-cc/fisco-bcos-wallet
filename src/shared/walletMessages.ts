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
	WalletCreationResult,
	WalletStatus,
	WalletSummary,
} from '../core/wallet/types'

export type WalletRuntimeRequest =
	| { type: 'WALLET_GET_STATUS' }
	| { type: 'WALLET_CREATE_MNEMONIC'; input: CreateMnemonicWalletInput }
	| { type: 'WALLET_RESTORE_MNEMONIC'; input: RestoreMnemonicWalletInput }
	| { type: 'WALLET_CONFIRM_MNEMONIC_BACKUP' }
	| { type: 'WALLET_UNLOCK'; input: UnlockWalletInput }
	| { type: 'WALLET_LOCK' }
	| { type: 'WALLET_ADD_ACCOUNT'; input: AddDerivedAccountInput }
	| { type: 'WALLET_UPDATE_ACCOUNT'; input: UpdateAccountInput }
	| { type: 'WALLET_SELECT_ACCOUNT'; input: SelectAccountInput }
	| { type: 'WALLET_DELETE_ACCOUNT'; input: DeleteAccountInput }
	| { type: 'WALLET_EXPORT_MNEMONIC'; input: ExportMnemonicInput }
	| { type: 'WALLET_EXPORT_PRIVATE_KEY'; input: ExportPrivateKeyInput }
	| { type: 'WALLET_RESET'; input: ResetWalletInput }

export type WalletRuntimeResult =
	| WalletStatus
	| WalletCreationResult
	| WalletSummary
	| MnemonicExportResult
	| PrivateKeyExportResult

export interface WalletRuntimeResponse<T extends WalletRuntimeResult = WalletRuntimeResult> {
	result?: T
	error?: { code: number; message: string }
}

export interface WalletStatusChangedEvent {
	type: 'WALLET_STATUS_CHANGED'
	status: WalletStatus
}

const isInteger = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0

const isHex = (value: unknown, byteLength?: number): value is `0x${string}` =>
	typeof value === 'string' &&
	/^0x[0-9a-fA-F]+$/.test(value) &&
	(byteLength === undefined || value.length === byteLength * 2 + 2)

const isWalletAccountSummary = (
	value: unknown,
): value is WalletSummary['accounts'][number] => {
	if (!value || typeof value !== 'object') return false
	const account = value as Partial<WalletSummary['accounts'][number]>
	return (
		isInteger(account.index) &&
		typeof account.name === 'string' &&
		typeof account.remark === 'string' &&
		!!account.addresses &&
		isHex(account.addresses.standard, 20) &&
		isHex(account.addresses.gm, 20) &&
		!!account.publicKeys &&
		isHex(account.publicKeys.standard) &&
		isHex(account.publicKeys.gm) &&
		typeof account.derivationPath === 'string' &&
		account.derivationScheme === 'bip32-secp256k1-v1' &&
		typeof account.createdAt === 'string'
	)
}

const isWalletSummary = (value: unknown): value is WalletSummary => {
	if (!value || typeof value !== 'object') return false
	const summary = value as Partial<WalletSummary>
	return (
		typeof summary.id === 'string' &&
		typeof summary.name === 'string' &&
		typeof summary.derivationPath === 'string' &&
		summary.derivationScheme === 'bip32-secp256k1-v1' &&
		(summary.wordCount === 12 || summary.wordCount === 24) &&
		typeof summary.backupConfirmed === 'boolean' &&
		typeof summary.createdAt === 'string' &&
		isInteger(summary.activeAccountIndex) &&
		Array.isArray(summary.accounts) &&
		summary.accounts.length > 0 &&
		summary.accounts.every(isWalletAccountSummary) &&
		new Set(summary.accounts.map((account) => account.index)).size === summary.accounts.length &&
		summary.accounts.some((account) => account.index === summary.activeAccountIndex)
	)
}

export const isWalletStatus = (value: unknown): value is WalletStatus => {
	if (!value || typeof value !== 'object') return false
	const status = value as Partial<WalletStatus>
	return (
		typeof status.initialized === 'boolean' &&
		typeof status.locked === 'boolean' &&
		(status.summary === undefined || isWalletSummary(status.summary))
	)
}

export const isWalletStatusChangedEvent = (
	value: unknown,
): value is WalletStatusChangedEvent => {
	if (!value || typeof value !== 'object') return false
	const event = value as Partial<WalletStatusChangedEvent>
	return event.type === 'WALLET_STATUS_CHANGED' && isWalletStatus(event.status)
}

export const isWalletRuntimeRequest = (value: unknown): value is WalletRuntimeRequest => {
	if (!value || typeof value !== 'object' || !('type' in value)) return false
	const type = (value as { type?: unknown }).type
	return (
		type === 'WALLET_GET_STATUS' ||
		type === 'WALLET_CREATE_MNEMONIC' ||
		type === 'WALLET_RESTORE_MNEMONIC' ||
		type === 'WALLET_CONFIRM_MNEMONIC_BACKUP' ||
		type === 'WALLET_UNLOCK' ||
		type === 'WALLET_LOCK' ||
		type === 'WALLET_ADD_ACCOUNT' ||
		type === 'WALLET_UPDATE_ACCOUNT' ||
		type === 'WALLET_SELECT_ACCOUNT' ||
		type === 'WALLET_DELETE_ACCOUNT' ||
		type === 'WALLET_EXPORT_MNEMONIC' ||
		type === 'WALLET_EXPORT_PRIVATE_KEY' ||
		type === 'WALLET_RESET'
	)
}
