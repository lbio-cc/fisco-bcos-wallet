import type {VaultEnvelope} from '@/core/vault/encryptedVault'
import type {WalletRepository, WalletSummary} from '@/core/wallet/types'
import {assetRepository} from './assetRepository.ts'

const VAULT_ENVELOPE = 'wallet:vault:envelope'
const WALLET_SUMMARY = 'wallet:summary'

const getValue = <T>(key: string): Promise<T | undefined> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.get(key, (result) => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve(result[key] as T | undefined)
		})
	})

const setValues = (values: Record<string, unknown>): Promise<void> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.set(values, () => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve()
		})
	})

const removeValues = (keys: string[]): Promise<void> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.remove(keys, () => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve()
		})
	})

const getAllKeys = (): Promise<string[]> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.get(null, (result) => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve(Object.keys(result))
		})
	})

export class ChromeWalletRepository implements WalletRepository {
	getEnvelope(): Promise<VaultEnvelope | undefined> {
		return getValue<VaultEnvelope>(VAULT_ENVELOPE)
	}

	getSummary(): Promise<WalletSummary | undefined> {
		return getValue<WalletSummary>(WALLET_SUMMARY)
	}

	async save(envelope: VaultEnvelope, summary: WalletSummary): Promise<void> {
		const previous = await this.getSummary()
		await setValues({[VAULT_ENVELOPE]: envelope, [WALLET_SUMMARY]: summary})
		await cleanupRemovedAccounts(previous, summary)
	}

	async setSummary(summary: WalletSummary): Promise<void> {
		const previous = await this.getSummary()
		await setValues({[WALLET_SUMMARY]: summary})
		await cleanupRemovedAccounts(previous, summary)
	}

	async reset(): Promise<void> {
		const keys = await getAllKeys()
		const walletKeys = keys.filter(
			(key) =>
				key === VAULT_ENVELOPE ||
				key === WALLET_SUMMARY ||
				key === 'wallet:assets' ||
				key === 'wallet:transactionActivities' ||
				key.startsWith('permission:'),
		)
		if (walletKeys.length) await removeValues(walletKeys)
	}
}

export const removedAccountAddresses = (
	previous: WalletSummary | undefined,
	next: WalletSummary,
): string[] => {
	if (!previous) return []
	const keptIndexes = new Set(next.accounts.map((account) => account.index))
	return previous.accounts
		.filter((account) => !keptIndexes.has(account.index))
		.flatMap((account) => Object.values(account.addresses))
}

const cleanupRemovedAccounts = async (
	previous: WalletSummary | undefined,
	next: WalletSummary,
): Promise<void> => {
	const removedAddresses = removedAccountAddresses(previous, next)
	if (!removedAddresses.length) return
	try {
		await assetRepository.cleanupAccounts(removedAddresses)
	} catch (error) {
		console.error('清理已删除账户的资产数据失败', error)
	}
}
