import type {RpcTransport} from '../transport/jsonRpcTransport.ts'
import type {AddNetworkInput, UpdateNetworkInput} from '../../shared/networkMessages.ts'
import type {NetworkConfig} from '../../shared/types.ts'

export interface NetworkRepository {
	getAll(): Promise<NetworkConfig[]>

	getActive(): Promise<NetworkConfig | undefined>

	add(network: NetworkConfig): Promise<void>

	update(network: NetworkConfig): Promise<void>

	delete(id: string): Promise<void>

	setActive(network: NetworkConfig): Promise<void>
}

export type NetworkTransportFactory = (
	endpoint: string,
	allowInsecureLocalhost: boolean,
) => RpcTransport

const GROUP_ID_KEYS = ['groupId', 'groupID', 'id'] as const
const CONFIG_VALUE_KEYS = [
	'value',
	'configValue',
	'config_value',
	'compatibility_version',
	'feature_balance',
] as const
const BILLING_ENABLED_VALUES = new Set(['1', 'true', 'on', 'enable', 'enabled'])
export const DEFAULT_BALANCE_DECIMALS = 18
export const DEFAULT_BALANCE_TOKEN = 'FBT'

export class NetworkManager {
	constructor(
		private readonly repository: NetworkRepository,
		private readonly createTransport: NetworkTransportFactory,
		private readonly createId: () => string = () => crypto.randomUUID(),
	) {
	}

	async getActive(): Promise<NetworkConfig | null> {
		return (await this.repository.getActive()) ?? null
	}

	list(): Promise<NetworkConfig[]> {
		return this.repository.getAll()
	}

	async add(input: AddNetworkInput): Promise<NetworkConfig> {
		const networks = await this.repository.getAll()
		this.assertNotDuplicate(networks, input)
		const network = await this.validate(input, this.createId())
		await this.repository.add(network)
		return network
	}

	async update(input: UpdateNetworkInput): Promise<NetworkConfig> {
		const networks = await this.repository.getAll()
		const existing = this.findById(networks, input.id)
		this.assertNotDuplicate(networks, input, input.id)
		const network = await this.validate(input, existing.id, existing)
		await this.repository.update(network)
		return network
	}

	async setActive(id: string): Promise<NetworkConfig> {
		const network = this.findById(await this.repository.getAll(), id)
		await this.repository.setActive(network)
		return network
	}

	async delete(id: string): Promise<NetworkConfig[]> {
		const networks = await this.repository.getAll()
		this.findById(networks, id)
		const active = await this.repository.getActive()
		if (active?.id === id) throw new Error('当前网络不能删除，请先切换到其他网络')
		await this.repository.delete(id)
		return networks.filter((network) => network.id !== id)
	}

	private async validate(
		input: AddNetworkInput,
		id: string,
		existing?: NetworkConfig,
	): Promise<NetworkConfig> {
		const name = input.name.trim()
		const groupId = input.mode === 'legacy' ? input.groupId?.trim() ?? '' : ''
		const rpcUrl = input.url.trim()
		if (input.mode !== 'legacy' && input.mode !== 'web3') {
			throw new Error('请选择有效的 RPC 类型')
		}
		if (input.mode === 'web3' && input.isGM) {
			throw new Error('Web3 RPC 不支持 SM2/SM3，请选择标准密码体系或改用原生 RPC')
		}
		if (!name) throw new Error('请输入网络名称')
		if (!rpcUrl) throw new Error('请输入 RPC URL')
		if (input.mode === 'legacy' && !groupId) throw new Error('请输入群组 ID')
		const balanceDecimals = input.billingEnabled
			? normalizeBalanceDecimals(input.balanceDecimals)
			: undefined
		const balanceToken = input.billingEnabled
			? normalizeBalanceToken(input.balanceToken)
			: undefined

		const allowInsecureLocalhost = isHttpLoopback(rpcUrl)
		const transport = this.createTransport(rpcUrl, allowInsecureLocalhost)
		const validation = input.mode === 'web3'
			? await this.validateWeb3(transport, normalizeWeb3ChainId(input.chainId))
			: await this.validateLegacy(transport, groupId)

		if (input.billingEnabled && input.mode === 'legacy') {
			const billingResult = await transport.request<unknown>(
				'getSystemConfigByKey',
				['feature_balance'],
			)
			if (!isBillingEnabled(billingResult)) {
				throw new Error('节点未开启计费功能（feature_balance）')
			}
		}

		const network: NetworkConfig = {
			...existing,
			id,
			name,
			rpcUrl,
			mode: input.mode,
			crypto: input.isGM ? 'gm' : 'standard',
			chainId: validation.chainId ?? existing?.chainId ?? 1,
			allowInsecureLocalhost,
			compatibilityVersion: validation.compatibilityVersion,
			billingEnabled: input.billingEnabled,
			balanceDecimals,
			balanceToken,
		}
		if (input.mode === 'legacy') {
			network.groupId = groupId
			network.legacyParamStyle = existing?.legacyParamStyle ?? 'endpoint-scoped'
		} else {
			delete network.groupId
			delete network.legacyParamStyle
		}
		return network
	}

	private async validateLegacy(
		transport: RpcTransport,
		groupId: string,
	): Promise<{chainId?: number; compatibilityVersion: string}> {
		const groupInfoList = await transport.request<unknown>('getGroupInfoList', [])
		const availableGroups = extractGroupIds(groupInfoList)
		if (!availableGroups.includes(groupId)) {
			const available =
				availableGroups.length > 0 ? `；节点可用群组：${availableGroups.join('、')}` : ''
			throw new Error(`节点未返回群组 ${groupId}${available}`)
		}
		const compatibilityResult = await transport.request<unknown>('getSystemConfigByKey', [
			'compatibility_version',
		])
		const compatibilityVersion = extractConfigValue(compatibilityResult)
		if (!compatibilityVersion) throw new Error('节点未返回有效的兼容版本')
		return {compatibilityVersion}
	}

	private async validateWeb3(
		transport: RpcTransport,
		configuredChainId: number,
	): Promise<{chainId: number; compatibilityVersion?: string}> {
		const chainId = readWeb3ChainId(await transport.request<unknown>('eth_chainId', []))
		if (chainId !== configuredChainId) {
			throw new Error(`Web3 RPC 返回的 Chain ID 为 ${chainId}，与配置的 ${configuredChainId} 不一致`)
		}
		await transport.request<unknown>('eth_blockNumber', [])
		return {chainId}
	}

	private assertNotDuplicate(
		networks: readonly NetworkConfig[],
		input: AddNetworkInput,
		ignoredId?: string,
	): void {
		const normalizedUrl = normalizeRpcUrl(input.url)
		const groupId = input.groupId?.trim() ?? ''
		if (
			networks.some(
				(network) =>
					network.id !== ignoredId &&
					normalizeRpcUrl(network.rpcUrl) === normalizedUrl &&
					(input.mode === 'web3'
						? network.mode === 'web3' && network.chainId === input.chainId
						: network.mode === 'legacy' && network.groupId === groupId),
			)
		) {
			throw new Error(
				input.mode === 'web3'
					? '已存在相同 RPC URL 和 Chain ID 的 Web3 网络'
					: '已存在相同 RPC URL 和群组 ID 的原生网络',
			)
		}
	}

	private findById(networks: readonly NetworkConfig[], id: string): NetworkConfig {
		const network = networks.find((candidate) => candidate.id === id)
		if (!network) throw new Error(`网络不存在：${id}`)
		return network
	}
}

export const readWeb3ChainId = (value: unknown): number => {
	if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
		throw new Error('Web3 RPC 未返回有效的 eth_chainId')
	}
	const chainId = BigInt(value)
	if (chainId <= 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('Web3 RPC 返回的 chainId 超出支持范围')
	}
	return Number(chainId)
}

const normalizeWeb3ChainId = (value: unknown): number => {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new Error('请输入有效的 Chain ID')
	}
	return value as number
}

export const normalizeRpcUrl = (value: string): string => {
	let url: URL
	try {
		url = new URL(value.trim())
	} catch {
		throw new Error('RPC URL 格式无效')
	}
	url.hash = ''
	if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
	return url.toString()
}

export const extractGroupIds = (value: unknown): string[] => {
	const list = unwrapGroupList(value)
	if (!list) return []

	const ids = list.flatMap((entry): string[] => {
		if (typeof entry === 'string' || typeof entry === 'number') return [String(entry)]
		if (!entry || typeof entry !== 'object') return []
		const record = entry as Record<string, unknown>
		for (const key of GROUP_ID_KEYS) {
			const candidate = record[key]
			if (typeof candidate === 'string' || typeof candidate === 'number') {
				return [String(candidate)]
			}
		}
		return []
	})
	return [...new Set(ids)]
}

export const extractConfigValue = (value: unknown): string | undefined => {
	if (typeof value === 'string') return value.trim() || undefined
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

	const record = value as Record<string, unknown>
	for (const key of CONFIG_VALUE_KEYS) {
		const candidate = record[key]
		if (
			typeof candidate === 'string' ||
			typeof candidate === 'number' ||
			typeof candidate === 'boolean'
		) {
			const normalized = String(candidate).trim()
			if (normalized) return normalized
		}
	}
	return undefined
}

export const isBillingEnabled = (value: unknown): boolean => {
	const normalized = extractConfigValue(value)
	return normalized ? BILLING_ENABLED_VALUES.has(normalized.toLowerCase()) : false
}

export const normalizeBalanceDecimals = (value: number | undefined): number => {
	const decimals = value ?? DEFAULT_BALANCE_DECIMALS
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new Error('余额小数位数必须是 0 到 255 之间的整数')
	}
	return decimals
}

export const normalizeBalanceToken = (value: string | undefined): string => {
	const token = value?.trim() || DEFAULT_BALANCE_TOKEN
	if (token.length > 16) throw new Error('余额 Token 不能超过 16 个字符')
	if (/[\u0000-\u001f\u007f]/.test(token)) throw new Error('余额 Token 包含无效字符')
	return token
}

const unwrapGroupList = (value: unknown): unknown[] | undefined => {
	if (Array.isArray(value)) return value
	if (!value || typeof value !== 'object') return undefined
	const record = value as Record<string, unknown>
	for (const key of ['groupInfoList', 'groupList', 'groups']) {
		if (Array.isArray(record[key])) return record[key]
	}
	return undefined
}

const isHttpLoopback = (endpoint: string): boolean => {
	let url: URL
	try {
		url = new URL(endpoint)
	} catch {
		throw new Error('RPC URL 格式无效')
	}
	const isLoopback =
		url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
	return url.protocol === 'http:' && isLoopback
}
