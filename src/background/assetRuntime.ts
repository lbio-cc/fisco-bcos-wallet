import {ChainAdapterFactory} from '../core/adapters/factory.ts'
import {AssetService, fetchSanitizedMetadata} from '../core/assets/assetService.ts'
import {METADATA_BUDGET_BYTES} from '../core/assets/metadataCache.ts'
import {readNativeBalance} from '../core/assets/nativeBalance.ts'
import {encodeCall, normalizeAssetRecipient, parseTokenAmount} from '../core/assets/abi.ts'
import {
	ASSET_ALARM_NAME,
	ASSET_REFRESH_INTERVAL_MINUTES,
	assetChainIdentityFromNetwork,
	type AssetHomeSnapshot,
	type AssetSendResult,
	type AssetSnapshot,
	isAssetRequest,
	type NftMetadata,
	type NativeBalanceSnapshot,
	resolveAssetChainIdentity,
	resolveAssetChainKey,
	networkChainKey,
	type TrackedAsset,
} from '../shared/assetMessages.ts'
import type {Hex, NetworkConfig} from '../shared/types'
import {networkStore} from './chromeStorage.ts'
import {walletManager} from './walletRuntime.ts'
import {assetRepository} from './assetRepository.ts'

export type AssetTransactionSender = (params: [{from: Hex; to: Hex; value: Hex; data: Hex}]) => Promise<Hex>

const running = new Set<string>()
const factory = new ChainAdapterFactory()

const getNativeBalance = async (
	network: NetworkConfig,
	account: Hex,
): Promise<NativeBalanceSnapshot | undefined> => {
	if (!network.billingEnabled) return undefined
	const decimals = network.balanceDecimals ?? 18
	const symbol = network.balanceToken ?? 'FBT'
	try {
		const adapter = await factory.create(network)
		const value = await adapter.request({
			method: adapter.mode === 'legacy' ? 'fisco_getBalance' : 'eth_getBalance',
			params: adapter.mode === 'legacy' ? [account] : [account, 'latest'],
		})
		return {
			rawBalance: readNativeBalance(value),
			decimals,
			symbol,
			refreshState: 'success',
		}
	} catch (error) {
		return {
			rawBalance: '0',
			decimals,
			symbol,
			refreshState: 'error',
			lastError: error instanceof Error ? error.message : '余额读取失败',
		}
	}
}

const withAssetContext = (
	asset: TrackedAsset,
	network: NetworkConfig,
	account: Hex,
): TrackedAsset => ({
	...asset,
	account: asset.account ?? account,
	chainIdentity: resolveAssetChainIdentity(asset, network),
	chainKey: resolveAssetChainKey(asset) ?? (
		!asset.chainIdentity && asset.networkId === network.id ? networkChainKey(network) : undefined
	),
})

const assetMatchesActiveChain = (
	asset: TrackedAsset,
	network: NetworkConfig,
): boolean => {
	const storedKey = resolveAssetChainKey(asset)
	if (storedKey) return storedKey === networkChainKey(network)
	return asset.networkId === network.id
}

const context = async (): Promise<{ network: NetworkConfig; account: Hex }> => {
	const [network, status] = await Promise.all([networkStore.getActive(), walletManager.getStatus()])
	if (!network) throw new Error('请先选择网络')
	const summary = status.summary
	if (!summary) throw new Error('钱包尚未初始化')
	const active = summary.accounts.find((item) => item.index === summary.activeAccountIndex)
	const account = active?.addresses[network.crypto]
	if (!account) throw new Error('当前账户没有该网络密码体系的地址')
	return {network, account}
}

const blankSnapshot = (asset: TrackedAsset, account: Hex): AssetSnapshot => ({
	networkId: asset.networkId,
	account,
	contract: asset.contract,
	rawBalance: '0',
	tokenIds: [],
	manualOnly: false,
	refreshState: 'idle',
	metadataState: 'idle',
	metadata: {},
})

const currentSnapshot = async (asset: TrackedAsset, account: Hex): Promise<AssetSnapshot> => {
	const state = await assetRepository.read()
	return state.snapshots.find((item) =>
		item.networkId === asset.networkId &&
		item.contract === asset.contract &&
		item.account.toLowerCase() === account.toLowerCase(),
	) ?? blankSnapshot(asset, account)
}

const refreshAsset = async (
	asset: TrackedAsset,
	network: NetworkConfig,
	account: Hex,
	includeLargeCollection = false,
): Promise<AssetSnapshot> => {
	const key = `${network.id}:${account}:${asset.contract}:asset`
	if (running.has(key)) throw new Error('该资产正在刷新，请稍候')
	running.add(key)
	const snapshot = await currentSnapshot(asset, account)
	snapshot.refreshState = 'refreshing'
	snapshot.lastError = undefined
	await assetRepository.updateSnapshot(snapshot)
	try {
		const service = new AssetService(await factory.create(network), network)
		const result = await service.enumerate(asset, account, {includeLargeCollection})
		Object.assign(snapshot, result, {
			refreshState: 'success',
			lastSuccessfulRefresh: Date.now(),
			lastError: undefined,
		})
		await assetRepository.updateSnapshot(snapshot)
		if (!asset.chainIdentity || !asset.chainKey) {
			await assetRepository.enrichDefinition(withAssetContext(asset, network, account))
		}
		return snapshot
	} catch (error) {
		snapshot.refreshState = 'error'
		snapshot.lastError = error instanceof Error ? error.message : '资产刷新失败'
		await assetRepository.updateSnapshot(snapshot)
		throw error
	} finally {
		running.delete(key)
	}
}

const mapLimit = async <T>(values: T[], limit: number, task: (value: T) => Promise<void>): Promise<void> => {
	let cursor = 0
	await Promise.all(Array.from({length: Math.min(limit, values.length)}, async () => {
		while (cursor < values.length) {
			const index = cursor++
			await task(values[index]!)
		}
	}))
}

const refreshAllMetadata = async (asset: TrackedAsset, network: NetworkConfig, account: Hex): Promise<void> => {
	if (asset.kind !== 'erc721') throw new Error('ERC20 不包含 metadata')
	const key = `${network.id}:${account}:${asset.contract}:metadata`
	if (running.has(key)) throw new Error('metadata 正在刷新，请稍候')
	running.add(key)
	const snapshot = await currentSnapshot(asset, account)
	snapshot.metadataState = 'refreshing'
	snapshot.metadataError = undefined
	await assetRepository.updateSnapshot(snapshot)
	try {
		const service = new AssetService(await factory.create(network), network)
		const next: Record<string, NftMetadata> = {}
		await mapLimit(snapshot.tokenIds, 4, async (tokenId) => {
			try {
				const tokenUri = await service.tokenUri(
					asset.contract,
					tokenId,
					asset.selectorCrypto ?? network.crypto,
				)
				if (tokenUri) next[tokenId] = await fetchSanitizedMetadata(tokenId, tokenUri)
			} catch {
				// A missing token URI/record is intentionally pruned after the complete pass.
			}
		})
		const fitted = await assetRepository.replaceMetadata(snapshot, next)
		snapshot.metadata = fitted.metadata
		snapshot.metadataState = 'success'
		snapshot.metadataError = fitted.omitted ? `${fitted.omitted} 条 metadata 因缓存预算未保存` : undefined
		await assetRepository.updateSnapshot(snapshot)
	} catch (error) {
		snapshot.metadataState = 'error'
		snapshot.metadataError = error instanceof Error ? error.message : 'metadata 刷新失败'
		await assetRepository.updateSnapshot(snapshot)
		throw error
	} finally {
		running.delete(key)
	}
}

const refreshMetadata = async (
	asset: TrackedAsset,
	network: NetworkConfig,
	account: Hex,
	tokenId: string,
): Promise<void> => {
	if (asset.kind !== 'erc721') throw new Error('ERC20 不包含 metadata')
	const snapshot = await currentSnapshot(asset, account)
	if (!snapshot.tokenIds.includes(tokenId)) throw new Error('该 ERC721 不属于当前资产快照')
	const key = `${network.id}:${account}:${asset.contract}:metadata:${tokenId}`
	if (running.has(key)) throw new Error(`ERC721 #${tokenId} 的 metadata 正在刷新，请稍候`)
	running.add(key)
	try {
		const service = new AssetService(await factory.create(network), network)
		const tokenUri = await service.tokenUri(
			asset.contract,
			tokenId,
			asset.selectorCrypto ?? network.crypto,
		)
		const metadata = await fetchSanitizedMetadata(tokenId, tokenUri)
		await assetRepository.mergeMetadata(snapshot, tokenId, metadata)
	} finally {
		running.delete(key)
	}
}

export const getAssetHomeSnapshot = async (refreshNative = false): Promise<AssetHomeSnapshot> => {
	let active: Awaited<ReturnType<typeof context>>
	try {
		active = await context()
	} catch {
		return {assets: [], metadataBytes: 0, metadataBudgetBytes: METADATA_BUDGET_BYTES}
	}
	const [state, nativeBalance] = await Promise.all([
		assetRepository.read(),
		refreshNative ? getNativeBalance(active.network, active.account) : undefined,
	])
	const definitions = state.definitions.filter(
		(item) => assetMatchesActiveChain(item, active.network),
	)
	const assets = definitions.map((asset) => ({
		...withAssetContext(asset, active.network, active.account),
		snapshot: state.snapshots.find((item) =>
			item.networkId === asset.networkId &&
			item.contract === asset.contract &&
			item.account.toLowerCase() === active.account.toLowerCase()),
	}))
	const metadataBytes = new TextEncoder().encode(JSON.stringify(state.snapshots.map((item) => item.metadata))).byteLength
	return {
		networkId: active.network.id,
		networkName: active.network.name,
		account: active.account,
		nativeBalance,
		assets,
		metadataBytes,
		metadataBudgetBytes: METADATA_BUDGET_BYTES,
	}
}

const findAsset = async (
	network: NetworkConfig,
	account: Hex,
	contract: string,
	requestedChainKey: string,
): Promise<TrackedAsset> => {
	const activeChainKey = networkChainKey(network)
	if (requestedChainKey !== activeChainKey) throw new Error('资产链标识与当前网络不匹配')
	const normalized = contract.trim().toLowerCase()
	const state = await assetRepository.read()
	const asset = state.definitions.find(
		(item) =>
			item.contract === normalized &&
			assetMatchesActiveChain(item, network),
	)
	if (!asset) throw new Error('未找到当前链地址的跟踪资产')
	const scoped = withAssetContext(asset, network, account)
	if (!scoped.chainKey || scoped.chainKey !== activeChainKey) throw new Error('资产链标识与当前网络不匹配')
	if (!asset.chainIdentity || !asset.chainKey) await assetRepository.enrichDefinition(scoped)
	return scoped
}

const sanitizeCustomField = (value: string | undefined, label: string, max: number): string | undefined => {
	const normalized = value?.trim()
	if (!normalized) return undefined
	if (normalized.length > max) throw new Error(`${label}不能超过 ${max} 个字符`)
	if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${label}包含无效字符`)
	return normalized
}

export const handleAssetRequest = async (
	message: Parameters<typeof isAssetRequest>[0],
	sendTransaction?: AssetTransactionSender,
): Promise<AssetHomeSnapshot | AssetSendResult> => {
	if (!isAssetRequest(message)) throw new Error('资产请求无效')
	if (message.type === 'ASSET_GET_SNAPSHOT') return getAssetHomeSnapshot()
	if (message.type === 'ASSET_REFRESH_NATIVE') return getAssetHomeSnapshot(true)
	const {network, account} = await context()
	if (message.type === 'ASSET_SEND') {
		if (!sendTransaction) throw new Error('资产发送服务不可用')
		const asset = await findAsset(network, account, message.contract, message.chainKey)
		const recipient = normalizeAssetRecipient(message.recipient)
		let data: Hex
		if (asset.kind === 'erc20') {
			if (message.amount === undefined || message.tokenId !== undefined) throw new Error('ERC20 发送参数无效')
			const amount = parseTokenAmount(message.amount, asset.decimals ?? 0)
			const snapshot = await currentSnapshot(asset, account)
			if (amount > BigInt(snapshot.rawBalance)) throw new Error('发送数量超过当前余额')
			data = encodeCall('transfer(address,uint256)', asset.selectorCrypto ?? network.crypto, [
				{type: 'address', value: recipient},
				{type: 'uint256', value: amount.toString()},
			])
		} else {
			if (message.tokenId === undefined || message.amount !== undefined || !/^\d+$/.test(message.tokenId)) {
				throw new Error('ERC721 发送参数无效')
			}
			const snapshot = await currentSnapshot(asset, account)
			if (!snapshot.tokenIds.includes(message.tokenId)) throw new Error('该 ERC721 不属于当前账户')
			data = encodeCall('safeTransferFrom(address,address,uint256)', asset.selectorCrypto ?? network.crypto, [
				{type: 'address', value: account},
				{type: 'address', value: recipient},
				{type: 'uint256', value: message.tokenId},
			])
		}
		const transactionHash = await sendTransaction([{from: account, to: asset.contract, value: '0x0', data}])
		return {transactionHash}
	}
	if (message.type === 'ASSET_ADD') {
		const service = new AssetService(await factory.create(network), network)
		const asset = withAssetContext(await service.detect(message.contract, account), network, account)
		asset.chainIdentity = assetChainIdentityFromNetwork(network)
		asset.chainKey = networkChainKey(network)
		await assetRepository.add(asset)
		try {
			const snapshot = await refreshAsset(asset, network, account)
			if (asset.kind === 'erc721' && !snapshot.manualOnly) {
				await refreshAllMetadata(asset, network, account)
			}
		} catch (error) {
			await assetRepository.remove(asset.chainKey, asset.networkId, asset.contract)
			throw error
		}
	} else {
		const asset = await findAsset(network, account, message.contract, message.chainKey)
		if (message.type === 'ASSET_REMOVE') {
			await assetRepository.remove(message.chainKey, asset.networkId, asset.contract)
		}
		if (message.type === 'ASSET_UPDATE') await assetRepository.updateDisplay(
			message.chainKey,
			asset.contract,
			sanitizeCustomField(message.customName, '显示名称', 48),
			sanitizeCustomField(message.customSymbol, '显示符号', 16),
		)
		if (message.type === 'ASSET_REFRESH') await refreshAsset(asset, network, account, true)
		if (message.type === 'ASSET_REFRESH_METADATA') {
			await refreshMetadata(asset, network, account, message.tokenId)
		}
	}
	return getAssetHomeSnapshot()
}

export const registerAssetRuntime = (sendTransaction?: AssetTransactionSender): void => {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): boolean => {
		if (!isAssetRequest(message)) return false
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse({error: {code: 4100, message: '不允许其他扩展访问资产接口'}})
			return false
		}
		void handleAssetRequest(message, sendTransaction)
			.then((result) => sendResponse({result}))
			.catch((error: unknown) => sendResponse({
				error: {
					code: -32603,
					message: error instanceof Error ? error.message : '资产操作失败'
				}
			}))
		return true
	})
	chrome.alarms.create(ASSET_ALARM_NAME, {periodInMinutes: ASSET_REFRESH_INTERVAL_MINUTES})
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name !== ASSET_ALARM_NAME) return
		void (async () => {
			const {network, account} = await context()
			const state = await assetRepository.read()
			for (const asset of state.definitions.filter(
				(item) => assetMatchesActiveChain(item, network),
			)) {
				const snapshot = await currentSnapshot(asset, account)
				if (snapshot.manualOnly) continue
				try {
					await refreshAsset(asset, network, account)
				} catch (error) {
					console.error('自动刷新资产失败', asset.contract, error)
				}
			}
		})()
	})
}
