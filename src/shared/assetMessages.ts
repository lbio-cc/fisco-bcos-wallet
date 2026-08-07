import type {CryptoKind, Hex, NetworkConfig} from './types'

export const ASSET_STORAGE_KEY = 'wallet:assets'
export const ASSET_ALARM_NAME = 'wallet:asset-refresh'
export const ASSET_REFRESH_INTERVAL_MINUTES = 5
export const NATIVE_BALANCE_REFRESH_INTERVAL_MS = 60_000
export const NATIVE_BALANCE_MIN_REFRESH_INTERVAL_MS = 3_000
export const NFT_AUTO_REFRESH_LIMIT = 50

export type AssetKind = 'erc20' | 'erc721'
export type RefreshState = 'idle' | 'refreshing' | 'success' | 'error'

export interface NftAttribute {
	traitType: string
	value: string | number | boolean
}

export interface NftMetadata {
	tokenId: string
	tokenUri: string
	name?: string
	description?: string
	image?: string
	animationUrl?: string
	externalUrl?: string
	attributes: NftAttribute[]
	lastAccessedAt: number
}

export interface AssetChainIdentity {
	networkName: string
	networkId: string
	chainId: number
	groupId: string
	crypto: CryptoKind
}

export interface TrackedAsset {
	networkId: string
	/** Stable authorization scope derived from crypto + chainId + groupId. */
	chainKey?: string
	/** Legacy source account. Asset definitions are shared by every account on the same chain. */
	account?: Hex
	/** Optional only for definitions persisted by wallet builds predating chain identity snapshots. */
	chainIdentity?: AssetChainIdentity
	/** ABI function-selector dialect detected for this contract. Defaults to the network crypto kind. */
	selectorCrypto?: CryptoKind
	contract: Hex
	kind: AssetKind
	name: string
	symbol: string
	customName?: string
	customSymbol?: string
	decimals?: number
	addedAt: number
}

export const assetChainKey = (
	identity: Pick<AssetChainIdentity, 'crypto' | 'chainId' | 'groupId'>,
): string => JSON.stringify([identity.crypto, identity.chainId, identity.groupId])

export const networkChainKey = (
	network: Pick<NetworkConfig, 'crypto' | 'chainId' | 'groupId'>,
): string => assetChainKey({...network, groupId: network.groupId ?? ''})

export const resolveAssetChainKey = (
	asset: Pick<TrackedAsset, 'chainKey' | 'chainIdentity'>,
): string | undefined => asset.chainKey ?? (asset.chainIdentity ? assetChainKey(asset.chainIdentity) : undefined)

export const effectiveAssetName = (asset: Pick<TrackedAsset, 'name' | 'customName'>): string =>
	asset.customName || asset.name

export const effectiveAssetSymbol = (asset: Pick<TrackedAsset, 'symbol' | 'customSymbol'>): string =>
	asset.customSymbol || asset.symbol

export const assetChainIdentityFromNetwork = (
	network: Pick<NetworkConfig, 'name' | 'id' | 'chainId' | 'groupId' | 'crypto'>,
): AssetChainIdentity => ({
	networkName: network.name,
	networkId: network.id,
	chainId: network.chainId,
	groupId: network.groupId ?? '',
	crypto: network.crypto,
})

export const resolveAssetChainIdentity = (
	asset: Pick<TrackedAsset, 'networkId' | 'chainIdentity'>,
	network?: Pick<NetworkConfig, 'name' | 'id' | 'chainId' | 'groupId' | 'crypto'>,
): AssetChainIdentity | undefined =>
	asset.chainIdentity ?? (network?.id === asset.networkId ? assetChainIdentityFromNetwork(network) : undefined)

export interface AssetSnapshot {
	networkId: string
	account: Hex
	contract: Hex
	rawBalance: string
	tokenIds: string[]
	manualOnly: boolean
	refreshState: RefreshState
	lastSuccessfulRefresh?: number
	lastError?: string
	metadataState: RefreshState
	metadataError?: string
	metadata: Record<string, NftMetadata>
}

export const trackedAssetBelongsToAccount = (
	_asset: Pick<TrackedAsset, 'networkId' | 'account' | 'contract'>,
	_account: string,
	_snapshots: readonly Pick<AssetSnapshot, 'networkId' | 'account' | 'contract'>[],
): boolean => {
	return true
}

export interface AssetHomeSnapshot {
	networkId?: string
	networkName?: string
	account?: Hex
	nativeBalance?: NativeBalanceSnapshot
	assets: Array<TrackedAsset & { snapshot?: AssetSnapshot }>
	metadataBytes: number
	metadataBudgetBytes: number
}

export interface NativeBalanceSnapshot {
	rawBalance: string
	decimals: number
	symbol: string
	refreshState: 'success' | 'error'
	lastError?: string
}

export type AssetRequest =
	| { type: 'ASSET_GET_SNAPSHOT' }
	| { type: 'ASSET_REFRESH_NATIVE' }
	| { type: 'ASSET_ADD'; contract: string }
	| { type: 'ASSET_UPDATE'; contract: string; chainKey: string; customName?: string; customSymbol?: string }
	| { type: 'ASSET_REMOVE'; contract: string; chainKey: string }
	| { type: 'ASSET_REFRESH'; contract: string; chainKey: string }
	| { type: 'ASSET_REFRESH_METADATA'; contract: string; chainKey: string; tokenId: string }
	| { type: 'ASSET_SEND'; contract: string; chainKey: string; recipient: string; amount?: string; tokenId?: string }

export interface AssetSendResult {
	transactionHash: Hex
}

export interface AssetResponse {
	result?: AssetHomeSnapshot | AssetSendResult
	error?: { code: number; message: string }
}

export const isAssetRequest = (value: unknown): value is AssetRequest => {
	if (!value || typeof value !== 'object') return false
	const request = value as {
		type?: unknown
		contract?: unknown
		chainKey?: unknown
		tokenId?: unknown
		customName?: unknown
		customSymbol?: unknown
		recipient?: unknown
		amount?: unknown
	}
	if (request.type === 'ASSET_GET_SNAPSHOT' || request.type === 'ASSET_REFRESH_NATIVE') return true
	if (request.type === 'ASSET_ADD') return typeof request.contract === 'string'
	if (request.type === 'ASSET_SEND') return (
		typeof request.contract === 'string' &&
		typeof request.chainKey === 'string' &&
		typeof request.recipient === 'string' &&
		(request.amount === undefined || typeof request.amount === 'string') &&
		(request.tokenId === undefined || typeof request.tokenId === 'string')
	)
	return (
		(request.type === 'ASSET_REMOVE' ||
			request.type === 'ASSET_REFRESH' ||
			request.type === 'ASSET_REFRESH_METADATA' ||
			request.type === 'ASSET_UPDATE') &&
		typeof request.contract === 'string' &&
		typeof request.chainKey === 'string' &&
		(request.type !== 'ASSET_REFRESH_METADATA' ||
			(typeof request.tokenId === 'string' && request.tokenId.trim().length > 0)) &&
		(request.type !== 'ASSET_UPDATE' ||
			((request.customName === undefined || typeof request.customName === 'string') &&
				(request.customSymbol === undefined || typeof request.customSymbol === 'string')))
	)
}
