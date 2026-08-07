import {
	ASSET_STORAGE_KEY,
	type AssetHomeSnapshot,
	type AssetRequest,
	type AssetResponse,
	type AssetSendResult,
} from '../shared/assetMessages.ts'

const empty = (): AssetHomeSnapshot => ({assets: [], metadataBytes: 0, metadataBudgetBytes: 4 * 1024 * 1024})

const send = <T extends AssetHomeSnapshot | AssetSendResult = AssetHomeSnapshot>(request: AssetRequest): Promise<T> => {
	if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return Promise.resolve(empty() as T)
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(request, (response: AssetResponse | undefined) => {
			const runtimeError = chrome.runtime.lastError
			if (runtimeError) return reject(new Error(runtimeError.message))
			if (response?.error) return reject(new Error(response.error.message))
			if (!response?.result) return reject(new Error('钱包后台返回了无效资产响应'))
			resolve(response.result as T)
		})
	})
}

export const getAssetSnapshot = (): Promise<AssetHomeSnapshot> => send({type: 'ASSET_GET_SNAPSHOT'})
export const refreshNativeBalance = (): Promise<AssetHomeSnapshot> => send({type: 'ASSET_REFRESH_NATIVE'})
export const addAsset = (contract: string): Promise<AssetHomeSnapshot> => send({type: 'ASSET_ADD', contract})
export const updateAsset = (contract: string, chainKey: string, customName?: string, customSymbol?: string): Promise<AssetHomeSnapshot> =>
	send({type: 'ASSET_UPDATE', contract, chainKey, customName, customSymbol})
export const removeAsset = (contract: string, chainKey: string): Promise<AssetHomeSnapshot> => send({type: 'ASSET_REMOVE', contract, chainKey})
export const refreshAsset = (contract: string, chainKey: string): Promise<AssetHomeSnapshot> => send({type: 'ASSET_REFRESH', contract, chainKey})
export const refreshAssetMetadata = (contract: string, chainKey: string, tokenId: string): Promise<AssetHomeSnapshot> => send({
	type: 'ASSET_REFRESH_METADATA',
	contract,
	chainKey,
	tokenId,
})

export const sendAsset = (
	contract: string,
	chainKey: string,
	recipient: string,
	input: {amount?: string; tokenId?: string},
): Promise<AssetSendResult> => send<AssetSendResult>({type: 'ASSET_SEND', contract, chainKey, recipient, ...input})

export const subscribeToAssets = (listener: () => void): (() => void) => {
	if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined
	let timer: number | undefined
	const changed = (changes: ChromeStorageChanges, areaName: string): void => {
		if (areaName !== 'local' || !(ASSET_STORAGE_KEY in changes)) return
		if (timer !== undefined) window.clearTimeout(timer)
		timer = window.setTimeout(listener, 80)
	}
	chrome.storage.onChanged.addListener(changed)
	return () => {
		if (timer !== undefined) window.clearTimeout(timer)
		chrome.storage.onChanged.removeListener(changed)
	}
}
