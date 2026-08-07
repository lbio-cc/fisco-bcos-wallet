import {ref} from 'vue'
import {defineStore} from 'pinia'

export type WalletAccessView =
	| 'loading'
	| 'welcome'
	| 'create'
	| 'restore'
	| 'backup'
	| 'confirm'
	| 'unlock'
	| 'reset'

export type WalletView =
	| WalletAccessView
	| 'secret-export'
	| 'accounts'
	| 'account'
	| 'networks'
	| 'network'
	| 'done'

export type ResetBackView = 'welcome' | 'unlock' | 'done'
export type SecretExportMode = 'mnemonic' | 'private-key'

export interface SecretExportRequest {
	mode: SecretExportMode
	back: 'done' | 'accounts'
	accountIndex?: number
}

const walletAccessViews = new Set<WalletView>([
	'loading',
	'welcome',
	'create',
	'restore',
	'backup',
	'confirm',
	'unlock',
	'reset',
])

export const isWalletAccessView = (view: WalletView): view is WalletAccessView =>
	walletAccessViews.has(view)

export const useWalletUiStore = defineStore('walletUi', () => {
	const expanded =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('expanded') === '1'
	const view = ref<WalletView>('loading')
	const busy = ref(false)
	const error = ref('')
	const resetBack = ref<ResetBackView>('unlock')
	const secretExportRequest = ref<SecretExportRequest>()
	const sensitiveStateRevision = ref(0)

	const navigate = (target: WalletView): void => {
		view.value = target
	}

	const go = (target: WalletView): void => {
		error.value = ''
		navigate(target)
	}

	const openReset = (back: ResetBackView): void => {
		error.value = ''
		resetBack.value = back
		navigate('reset')
	}

	const openSecretExport = (
		mode: SecretExportMode,
		back: SecretExportRequest['back'],
		accountIndex?: number,
	): void => {
		error.value = ''
		secretExportRequest.value = {mode, back, accountIndex}
		navigate('secret-export')
	}

	const closeSecretExport = (): void => {
		const target = secretExportRequest.value?.back ?? 'done'
		secretExportRequest.value = undefined
		navigate(target)
	}

	const cancelSecretExport = (): void => {
		secretExportRequest.value = undefined
	}

	const invalidateSensitiveState = (): void => {
		sensitiveStateRevision.value += 1
	}

	return {
		expanded,
		view,
		busy,
		error,
		resetBack,
		secretExportRequest,
		sensitiveStateRevision,
		navigate,
		go,
		openReset,
		openSecretExport,
		closeSecretExport,
		cancelSecretExport,
		invalidateSensitiveState,
	}
})
