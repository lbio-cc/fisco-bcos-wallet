import type {WalletSessionStore} from '@/core/wallet/types'

const WALLET_SESSION_KEY = 'wallet:vault:session-key'
const WALLET_SESSION_EXPIRES_AT = 'wallet:vault:session-expires-at'

const getSessionArea = (): ChromeStorageArea => {
	if (!chrome.storage.session) throw new Error('当前浏览器不支持钱包会话存储')
	return chrome.storage.session
}

export class ChromeWalletSessionStore implements WalletSessionStore {
	getKey(): Promise<string | undefined> {
		return new Promise((resolve, reject) => {
			getSessionArea().get(WALLET_SESSION_KEY, (result) => {
				const error = chrome.runtime.lastError
				if (error) reject(new Error(error.message))
				else resolve(result[WALLET_SESSION_KEY] as string | undefined)
			})
		})
	}

	setKey(key: string): Promise<void> {
		return new Promise((resolve, reject) => {
			getSessionArea().set({[WALLET_SESSION_KEY]: key}, () => {
				const error = chrome.runtime.lastError
				if (error) reject(new Error(error.message))
				else resolve()
			})
		})
	}

	getExpiresAt(): Promise<number | undefined> {
		return new Promise((resolve, reject) => {
			getSessionArea().get(WALLET_SESSION_EXPIRES_AT, (result) => {
				const error = chrome.runtime.lastError
				const value = result[WALLET_SESSION_EXPIRES_AT]
				if (error) reject(new Error(error.message))
				else resolve(typeof value === 'number' && Number.isFinite(value) ? value : undefined)
			})
		})
	}

	setExpiresAt(expiresAt: number): Promise<void> {
		return new Promise((resolve, reject) => {
			getSessionArea().set({[WALLET_SESSION_EXPIRES_AT]: expiresAt}, () => {
				const error = chrome.runtime.lastError
				if (error) reject(new Error(error.message))
				else resolve()
			})
		})
	}

	clear(): Promise<void> {
		return new Promise((resolve, reject) => {
			getSessionArea().remove([WALLET_SESSION_KEY, WALLET_SESSION_EXPIRES_AT], () => {
				const error = chrome.runtime.lastError
				if (error) reject(new Error(error.message))
				else resolve()
			})
		})
	}
}
