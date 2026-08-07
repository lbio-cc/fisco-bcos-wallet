import {ASSET_STORAGE_KEY, resolveAssetChainKey, type AssetSnapshot, type NftMetadata, type TrackedAsset,} from '../shared/assetMessages.ts'
import {fitMetadataBudget, METADATA_BUDGET_BYTES} from '../core/assets/metadataCache.ts'

interface AssetState {
	definitions: TrackedAsset[]
	snapshots: AssetSnapshot[]
}

const empty = (): AssetState => ({definitions: [], snapshots: []})
let queue: Promise<void> = Promise.resolve()

const normalizeState = (state: AssetState): AssetState => {
	const definitions = new Map<string, TrackedAsset>()
	for (const definition of state.definitions ?? []) {
		const chainKey = resolveAssetChainKey(definition)
		const key = `${chainKey ?? `legacy:${definition.networkId}`}:${definition.contract.toLowerCase()}`
		const current = definitions.get(key)
		const shared = {...definition, account: undefined}
		definitions.set(key, current ? {
			...current,
			...shared,
			customName: shared.customName ?? current.customName,
			customSymbol: shared.customSymbol ?? current.customSymbol,
			addedAt: Math.min(current.addedAt, shared.addedAt),
		} : shared)
	}
	return {definitions: [...definitions.values()], snapshots: state.snapshots ?? []}
}

const read = (): Promise<AssetState> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.get(ASSET_STORAGE_KEY, (result) => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve(normalizeState((result[ASSET_STORAGE_KEY] as AssetState | undefined) ?? empty()))
		})
	})

const write = (state: AssetState): Promise<void> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.set({[ASSET_STORAGE_KEY]: state}, () => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve()
		})
	})

const serialize = <T>(operation: (state: AssetState) => Promise<T> | T): Promise<T> => {
	const result = queue.then(async () => {
		const state = await read()
		const value = await operation(state)
		await write(state)
		return value
	})
	queue = result.then(() => undefined, () => undefined)
	return result
}

const snapshotKey = (value: Pick<AssetSnapshot, 'networkId' | 'account' | 'contract'>): string =>
	`${value.networkId}:${value.account.toLowerCase()}:${value.contract.toLowerCase()}`

export const assetRepository = {
	read,
	add: (definition: TrackedAsset): Promise<void> =>
		serialize((state) => {
			if (!definition.chainIdentity || !definition.chainKey) throw new Error('添加资产时缺少稳定链标识')
			if (state.definitions.some(
				(item) =>
					resolveAssetChainKey(item) === definition.chainKey &&
					item.contract === definition.contract,
			)) {
				throw new Error('该合约已添加到当前网络')
			}
			state.definitions.push({...definition, account: undefined})
		}),
	enrichDefinition: (definition: TrackedAsset): Promise<void> =>
		serialize((state) => {
			const requestedChainKey = resolveAssetChainKey(definition)
			const stored = state.definitions.find(
				(item) =>
					item.contract === definition.contract &&
					(requestedChainKey
						? resolveAssetChainKey(item) === requestedChainKey ||
							(!resolveAssetChainKey(item) && item.networkId === definition.networkId)
						: item.networkId === definition.networkId),
			)
			if (!stored) return
			stored.account = undefined
			if (definition.chainIdentity) stored.chainIdentity = definition.chainIdentity
			if (definition.chainKey) stored.chainKey = definition.chainKey
		}),
	updateDisplay: (chainKey: string, contract: string, customName?: string, customSymbol?: string): Promise<void> =>
		serialize((state) => {
			const stored = state.definitions.find((item) =>
				resolveAssetChainKey(item) === chainKey &&
				item.contract === contract,
			)
			if (!stored) throw new Error('未找到当前网络的跟踪资产')
			stored.customName = customName
			stored.customSymbol = customSymbol
		}),
	remove: (chainKey: string, networkId: string, contract: string): Promise<void> =>
		serialize((state) => {
			state.definitions = state.definitions.filter((item) =>
				resolveAssetChainKey(item) !== chainKey || item.contract !== contract,
			)
			state.snapshots = state.snapshots.filter(
				(item) =>
					!(
						item.networkId === networkId &&
						item.contract === contract
					),
			)
		}),
	updateSnapshot: (snapshot: AssetSnapshot): Promise<void> =>
		serialize((state) => {
			const key = snapshotKey(snapshot)
			state.snapshots = [snapshot, ...state.snapshots.filter((item) => snapshotKey(item) !== key)]
		}),
	replaceMetadata: (scope: Pick<AssetSnapshot, 'networkId' | 'account' | 'contract'>, metadata: Record<string, NftMetadata>): Promise<{
		omitted: number;
		metadata: Record<string, NftMetadata>
	}> =>
		serialize((state) => {
			const target = state.snapshots.find((item) => snapshotKey(item) === snapshotKey(scope))
			if (!target) throw new Error('资产快照不存在，请先刷新资产')
			const all: Array<[string, NftMetadata]> = []
			for (const snapshot of state.snapshots) {
				const source = snapshot === target ? metadata : snapshot.metadata
				for (const [tokenId, record] of Object.entries(source)) all.push([`${snapshotKey(snapshot)}:${tokenId}`, record])
			}
			const fitted = fitMetadataBudget(Object.fromEntries(all), METADATA_BUDGET_BYTES)
			for (const snapshot of state.snapshots) {
				const prefix = `${snapshotKey(snapshot)}:`
				snapshot.metadata = Object.fromEntries(
					Object.entries(fitted.records)
						.filter(([key]) => key.startsWith(prefix))
						.map(([key, record]) => [key.slice(prefix.length), record]),
				)
			}
			return {omitted: fitted.omitted, metadata: target.metadata}
		}),
	mergeMetadata: (
		scope: Pick<AssetSnapshot, 'networkId' | 'account' | 'contract'>,
		tokenId: string,
		metadata: NftMetadata,
	): Promise<{omitted: number; metadata: Record<string, NftMetadata>}> =>
		serialize((state) => {
			const target = state.snapshots.find((item) => snapshotKey(item) === snapshotKey(scope))
			if (!target) throw new Error('资产快照不存在，请先刷新资产')
			target.metadata = {...target.metadata, [tokenId]: metadata}
			const all: Array<[string, NftMetadata]> = []
			for (const snapshot of state.snapshots) {
				for (const [storedTokenId, record] of Object.entries(snapshot.metadata)) {
					all.push([`${snapshotKey(snapshot)}:${storedTokenId}`, record])
				}
			}
			const fitted = fitMetadataBudget(Object.fromEntries(all), METADATA_BUDGET_BYTES)
			for (const snapshot of state.snapshots) {
				const prefix = `${snapshotKey(snapshot)}:`
				snapshot.metadata = Object.fromEntries(
					Object.entries(fitted.records)
						.filter(([key]) => key.startsWith(prefix))
						.map(([key, record]) => [key.slice(prefix.length), record]),
				)
			}
			return {omitted: fitted.omitted, metadata: target.metadata}
		}),
	cleanupNetwork: (networkId: string): Promise<void> =>
		serialize((state) => {
			state.definitions = state.definitions.filter((item) => item.networkId !== networkId)
			state.snapshots = state.snapshots.filter((item) => item.networkId !== networkId)
		}),
	cleanupAccounts: (addresses: string[]): Promise<void> => {
		const removed = new Set(addresses.map((address) => address.toLowerCase()))
		return serialize((state) => {
			state.snapshots = state.snapshots.filter((item) => !removed.has(item.account.toLowerCase()))
		})
	},
}
