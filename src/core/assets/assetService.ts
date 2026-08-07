import type {ChainAdapter} from '../adapters/chainAdapter'
import type {Hex, NetworkConfig} from '../../shared/types'
import type {NftAttribute, NftMetadata, TrackedAsset} from '../../shared/assetMessages'
import {NFT_AUTO_REFRESH_LIMIT} from '../../shared/assetMessages.ts'
import {decodeBool, decodeString, decodeUint, encodeCall, erc165InterfaceId, normalizeContractAddress} from './abi.ts'
import {fetchJsonWithLimits} from '../transport/httpLimits.ts'

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'
export const METADATA_REQUEST_TIMEOUT_MS = 10_000
export const METADATA_RESPONSE_LIMIT_BYTES = 128 * 1024
const METADATA_DATA_URI_LIMIT_CHARS = METADATA_RESPONSE_LIMIT_BYTES * 3
export const ERC721_SIGNATURES = [
	'balanceOf(address)',
	'ownerOf(uint256)',
	'safeTransferFrom(address,address,uint256)',
	'transferFrom(address,address,uint256)',
	'approve(address,uint256)',
	'setApprovalForAll(address,bool)',
	'getApproved(uint256)',
	'isApprovedForAll(address,address)',
	'safeTransferFrom(address,address,uint256,bytes)',
] as const
export const ERC721_ENUMERABLE_SIGNATURES = [
	'totalSupply()',
	'tokenOfOwnerByIndex(address,uint256)',
	'tokenByIndex(uint256)',
] as const

const call = (adapter: ChainAdapter, to: Hex, data: Hex): Promise<unknown> =>
	adapter.request({method: 'eth_call', params: [{to, data}, 'latest']})

const safeText = (value: unknown, max: number): string | undefined =>
	typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max) : undefined

export const resolveDisplayUri = (value: unknown): string | undefined => {
	const uri = safeText(value, 2048)
	if (!uri) return undefined
	if (uri.startsWith('ipfs://')) return `${IPFS_GATEWAY}${uri.slice(7).replace(/^ipfs\//, '')}`
	if (/^https:\/\//i.test(uri) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(uri)) return uri
	return undefined
}

const metadataDocument = async (uri: string): Promise<unknown> => {
	if (uri.length > METADATA_DATA_URI_LIMIT_CHARS) throw new Error('metadata data URI 过大')
	if (uri.startsWith('data:application/json;base64,')) {
		const encoded = uri.slice('data:application/json;base64,'.length)
		const binary = atob(encoded)
		if (binary.length > METADATA_RESPONSE_LIMIT_BYTES) throw new Error('metadata data URI 过大')
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
		return JSON.parse(new TextDecoder().decode(bytes))
	}
	if (uri.startsWith('data:application/json,')) {
		const decoded = decodeURIComponent(uri.slice('data:application/json,'.length))
		if (new TextEncoder().encode(decoded).byteLength > METADATA_RESPONSE_LIMIT_BYTES) {
			throw new Error('metadata data URI 过大')
		}
		return JSON.parse(decoded)
	}
	const target = resolveDisplayUri(uri)
	if (!target) throw new Error('metadata URI 协议不受支持')
	const {response, value} = await fetchJsonWithLimits(
		target,
		{},
		{
			timeoutMs: METADATA_REQUEST_TIMEOUT_MS,
			maxResponseBytes: METADATA_RESPONSE_LIMIT_BYTES,
			label: 'metadata',
		},
	)
	if (!response.ok) throw new Error(`metadata 请求失败 (${response.status})`)
	return value
}

export const fetchSanitizedMetadata = async (tokenId: string, tokenUri: string): Promise<NftMetadata> => {
	const value = await metadataDocument(tokenUri)
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('metadata 不是 JSON 对象')
	const input = value as Record<string, unknown>
	const attributes: NftAttribute[] = Array.isArray(input.attributes)
		? input.attributes.slice(0, 24).flatMap((item) => {
			if (!item || typeof item !== 'object' || Array.isArray(item)) return []
			const field = item as Record<string, unknown>
			const traitType = safeText(field.trait_type, 80)
			const primitive = field.value
			return traitType && (typeof primitive === 'string' || typeof primitive === 'number' || typeof primitive === 'boolean')
				? [{traitType, value: typeof primitive === 'string' ? primitive.slice(0, 160) : primitive}]
				: []
		})
		: []
	return {
		tokenId,
		tokenUri: tokenUri.slice(0, 2048),
		name: safeText(input.name, 160),
		description: safeText(input.description, 1200),
		image: resolveDisplayUri(input.image),
		animationUrl: resolveDisplayUri(input.animation_url),
		externalUrl: resolveDisplayUri(input.external_url),
		attributes,
		lastAccessedAt: Date.now(),
	}
}

export class AssetService {
	constructor(private readonly adapter: ChainAdapter, private readonly network: NetworkConfig) {
	}

	async detect(input: string, account: Hex): Promise<TrackedAsset> {
		const contract = normalizeContractAddress(input)
		const code = await this.adapter.request<unknown>({method: 'eth_getCode', params: [contract, 'latest']})
		if (typeof code !== 'string' || !/^0x[0-9a-fA-F]+$/.test(code) || /^0x0*$/.test(code)) {
			throw new Error('该地址没有合约字节码')
		}
		const supports = async (
			interfaceId: string,
			selectorCrypto: NetworkConfig['crypto'],
		): Promise<boolean> => {
			try {
				return decodeBool(
					await this.probe(
						contract,
						'supportsInterface(bytes4)',
						[{type: 'bytes4', value: interfaceId}],
						selectorCrypto,
					),
				)
			} catch {
				return false
			}
		}
		const selectorDialects: NetworkConfig['crypto'][] =
			this.network.crypto === 'gm' ? ['gm', 'standard'] : ['standard', 'gm']
		const erc721DialectResults = await Promise.all(
			selectorDialects.map(async (selectorCrypto) => {
				const [erc721, enumerable] = await Promise.all([
					supports(erc165InterfaceId(ERC721_SIGNATURES, selectorCrypto), selectorCrypto),
					supports(
						erc165InterfaceId(ERC721_ENUMERABLE_SIGNATURES, selectorCrypto),
						selectorCrypto,
					),
				])
				return {selectorCrypto, supported: erc721 && enumerable}
			}),
		)
		const detectedErc721Dialect = erc721DialectResults.find((result) => result.supported)
		const chainIdentity = {
			networkName: this.network.name,
			networkId: this.network.id,
			chainId: this.network.chainId,
			groupId: this.network.groupId ?? '',
			crypto: this.network.crypto,
		}
		if (detectedErc721Dialect) {
			const selectorCrypto = detectedErc721Dialect.selectorCrypto
			const [name, symbol] = await Promise.all([
				this.probe(contract, 'name()', [], selectorCrypto).then(decodeString),
				this.probe(contract, 'symbol()', [], selectorCrypto).then(decodeString),
				this.probe(
					contract,
					'balanceOf(address)',
					[{type: 'address', value: account}],
					selectorCrypto,
				).then(decodeUint),
			])
			return {
				networkId: this.network.id,
				account,
				chainIdentity,
				selectorCrypto,
				contract,
				kind: 'erc721',
				name,
				symbol,
				addedAt: Date.now(),
			}
		}
		try {
			const [name, symbol, decimals] = await Promise.all([
				this.probe(contract, 'name()').then(decodeString),
				this.probe(contract, 'symbol()').then(decodeString),
				this.probe(contract, 'decimals()').then(decodeUint),
				this.probe(contract, 'totalSupply()').then(decodeUint),
				this.probe(contract, 'balanceOf(address)', [{type: 'address', value: account}]).then(decodeUint),
			])
			if (decimals > 255n) throw new Error('ERC20 decimals 超出范围')
			return {
				networkId: this.network.id,
				account,
				chainIdentity,
				contract,
				kind: 'erc20',
				name,
				symbol,
				decimals: Number(decimals),
				addedAt: Date.now(),
			}
		} catch (error) {
			throw new Error(`仅支持 ERC20 或实现 ERC721Enumerable 的 ERC721：${error instanceof Error ? error.message : '探测失败'}`)
		}
	}

	async enumerate(
		asset: TrackedAsset,
		account: Hex,
		options: {includeLargeCollection?: boolean; concurrency?: number} = {},
	): Promise<{
		rawBalance: string;
		tokenIds: string[];
		manualOnly: boolean
	}> {
		const selectorCrypto = asset.selectorCrypto ?? this.network.crypto
		const balance = await this.probe(
			asset.contract,
			'balanceOf(address)',
			[{type: 'address', value: account}],
			selectorCrypto,
		).then(decodeUint)
		if (asset.kind === 'erc20') return {rawBalance: balance.toString(), tokenIds: [], manualOnly: false}
		if (balance > 10000n) throw new Error('ERC721 数量异常，已停止枚举')
		const manualOnly = balance > BigInt(NFT_AUTO_REFRESH_LIMIT)
		if (manualOnly && !options.includeLargeCollection) {
			return {rawBalance: balance.toString(), tokenIds: [], manualOnly: true}
		}

		const count = Number(balance)
		const tokenIds = new Array<string>(count)
		const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, count))
		let cursor = 0
		await Promise.all(Array.from({length: concurrency}, async () => {
			while (cursor < count) {
				const index = cursor++
				tokenIds[index] = (
					await this.probe(
						asset.contract,
						'tokenOfOwnerByIndex(address,uint256)',
						[
							{type: 'address', value: account},
							{type: 'uint256', value: String(index)},
						],
						selectorCrypto,
					).then(decodeUint)
				).toString()
			}
		}))
		return {rawBalance: balance.toString(), tokenIds, manualOnly}
	}

	tokenUri(
		contract: Hex,
		tokenId: string,
		selectorCrypto: NetworkConfig['crypto'] = this.network.crypto,
	): Promise<string> {
		return this.probe(
			contract,
			'tokenURI(uint256)',
			[{type: 'uint256', value: tokenId}],
			selectorCrypto,
		).then(decodeString)
	}

	private probe(
		to: Hex,
		signature: string,
		args: Parameters<typeof encodeCall>[2] = [],
		selectorCrypto: NetworkConfig['crypto'] = this.network.crypto,
	): Promise<unknown> {
		return call(this.adapter, to, encodeCall(signature, selectorCrypto, args))
	}
}
