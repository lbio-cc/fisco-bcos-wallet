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
} from '@/core/wallet/types'
import type {
	WalletRuntimeRequest,
	WalletRuntimeResponse,
	WalletRuntimeResult,
	WalletStatusChangedEvent,
} from '@/shared/walletMessages'
import {isWalletStatusChangedEvent} from '../shared/walletMessages.ts'

const send = <T extends WalletRuntimeResult>(request: WalletRuntimeRequest): Promise<T> =>
	new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(request, (response: WalletRuntimeResponse<T> | undefined) => {
			const runtimeError = chrome.runtime.lastError
			if (runtimeError) return reject(new Error(runtimeError.message))
			if (!response) return reject(new Error('钱包后台没有响应'))
			if (response.error) {
				return reject(
					Object.assign(new Error(response.error.message), {code: response.error.code}),
				)
			}
			if (!response.result) return reject(new Error('钱包后台返回了无效响应'))
			resolve(response.result)
		})
	})

export const getWalletStatus = (): Promise<WalletStatus> =>
	send<WalletStatus>({type: 'WALLET_GET_STATUS'})

export const createMnemonicWallet = (
	input: CreateMnemonicWalletInput,
): Promise<WalletCreationResult> => send({type: 'WALLET_CREATE_MNEMONIC', input})

export const restoreMnemonicWallet = (
	input: RestoreMnemonicWalletInput,
): Promise<WalletCreationResult> => send({type: 'WALLET_RESTORE_MNEMONIC', input})

export const confirmMnemonicBackup = (): Promise<WalletSummary> =>
	send<WalletSummary>({type: 'WALLET_CONFIRM_MNEMONIC_BACKUP'})

export const unlockWallet = (input: UnlockWalletInput): Promise<WalletStatus> =>
	send<WalletStatus>({type: 'WALLET_UNLOCK', input})

export const lockWallet = (): Promise<WalletStatus> => send<WalletStatus>({type: 'WALLET_LOCK'})

export const addDerivedAccount = (input: AddDerivedAccountInput): Promise<WalletSummary> =>
	send<WalletSummary>({type: 'WALLET_ADD_ACCOUNT', input})

export const updateAccount = (input: UpdateAccountInput): Promise<WalletSummary> =>
	send<WalletSummary>({type: 'WALLET_UPDATE_ACCOUNT', input})

export const selectAccount = (input: SelectAccountInput): Promise<WalletSummary> =>
	send<WalletSummary>({type: 'WALLET_SELECT_ACCOUNT', input})

export const deleteAccount = (input: DeleteAccountInput): Promise<WalletSummary> =>
	send<WalletSummary>({type: 'WALLET_DELETE_ACCOUNT', input})

export const exportMnemonic = (input: ExportMnemonicInput): Promise<MnemonicExportResult> =>
	send<MnemonicExportResult>({type: 'WALLET_EXPORT_MNEMONIC', input})

export const exportPrivateKey = (
	input: ExportPrivateKeyInput,
): Promise<PrivateKeyExportResult> =>
	send<PrivateKeyExportResult>({type: 'WALLET_EXPORT_PRIVATE_KEY', input})

export const resetWallet = (input: ResetWalletInput): Promise<WalletStatus> =>
	send<WalletStatus>({type: 'WALLET_RESET', input})

export const subscribeToWalletStatusChanges = (
	listener: (event: WalletStatusChangedEvent) => void,
): (() => void) => {
	const runtimeListener = (message: unknown, sender: { id?: string }): boolean => {
		if (sender.id !== chrome.runtime.id || !isWalletStatusChangedEvent(message)) return false
		listener(message)
		return false
	}
	chrome.runtime.onMessage.addListener(runtimeListener)
	return () => chrome.runtime.onMessage.removeListener(runtimeListener)
}

export interface WalletStatusSynchronizer {
	refresh(): Promise<WalletStatus | undefined>

	dispose(): void
}

export const createWalletStatusSynchronizer = (
	readStatus: () => Promise<WalletStatus>,
	applyStatus: (
		status: WalletStatus,
		isCurrent: () => boolean,
	) => void | Promise<void>,
	onSignal?: (event: WalletStatusChangedEvent) => void,
): WalletStatusSynchronizer => {
	let requestRevision = 0
	let disposed = false

	const refresh = async (): Promise<WalletStatus | undefined> => {
		const revision = ++requestRevision
		const status = await readStatus()
		if (disposed || revision !== requestRevision) return undefined
		await applyStatus(status, () => !disposed && revision === requestRevision)
		return status
	}

	const unsubscribe = subscribeToWalletStatusChanges((event) => {
		onSignal?.(event)
		void refresh().catch((cause) => {
			console.error('同步钱包锁定状态失败', cause)
		})
	})

	return {
		refresh,
		dispose() {
			if (disposed) return
			disposed = true
			requestRevision += 1
			unsubscribe()
		},
	}
}
