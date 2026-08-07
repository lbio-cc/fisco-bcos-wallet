import type {WalletHomeRequest, WalletHomeResponse, WalletHomeSnapshot,} from '@/shared/walletHomeMessages'
import {TRANSACTION_ACTIVITIES_STORAGE_KEY} from '../shared/walletHomeMessages.ts'

const emptySnapshot = (): WalletHomeSnapshot => ({
	permissions: [],
	activities: [],
})

const send = (request: WalletHomeRequest): Promise<WalletHomeSnapshot> => {
	if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
		return Promise.resolve(emptySnapshot())
	}
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(request, (response: WalletHomeResponse | undefined) => {
			const runtimeError = chrome.runtime.lastError
			if (runtimeError) return reject(new Error(runtimeError.message))
			if (!response) return reject(new Error('钱包后台没有响应'))
			if (response.error) return reject(new Error(response.error.message))
			if (!response.result) return reject(new Error('钱包后台返回了无效响应'))
			resolve(response.result)
		})
	})
}

export const getWalletHomeSnapshot = (): Promise<WalletHomeSnapshot> =>
	send({type: 'WALLET_HOME_GET_SNAPSHOT'})

export const revokeSitePermission = (origin: string): Promise<WalletHomeSnapshot> =>
	send({type: 'WALLET_HOME_REVOKE_PERMISSION', origin})

export const subscribeToTransactionActivities = (listener: () => void): (() => void) => {
	if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined
	let timer: number | undefined
	const handleChange = (changes: ChromeStorageChanges, areaName: string): void => {
		if (areaName !== 'local' || !(TRANSACTION_ACTIVITIES_STORAGE_KEY in changes)) return
		if (timer !== undefined) window.clearTimeout(timer)
		timer = window.setTimeout(listener, 80)
	}
	chrome.storage.onChanged.addListener(handleChange)
	return () => {
		if (timer !== undefined) window.clearTimeout(timer)
		chrome.storage.onChanged.removeListener(handleChange)
	}
}

export const subscribeToSubmittedTransactions = (listener: () => void): (() => void) => {
	if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined
	const handleChange = (changes: ChromeStorageChanges, areaName: string): void => {
		if (areaName !== 'local') return
		const change = changes[TRANSACTION_ACTIVITIES_STORAGE_KEY]
		if (!change) return
		const previous = Array.isArray(change.oldValue) ? change.oldValue : []
		const current = Array.isArray(change.newValue) ? change.newValue : []
		const previousIds = new Set(previous.flatMap((item) =>
			item && typeof item === 'object' && typeof item.id === 'string' ? [item.id] : [],
		))
		if (current.some((item) =>
			item &&
			typeof item === 'object' &&
			typeof item.id === 'string' &&
			item.status === 'submitted' &&
			!previousIds.has(item.id),
		)) listener()
	}
	chrome.storage.onChanged.addListener(handleChange)
	return () => chrome.storage.onChanged.removeListener(handleChange)
}
