export type Hex = `0x${string}`
export type AdapterMode = 'web3' | 'legacy'
export type ProviderRpcMode = 'native' | 'web3'
export type CryptoKind = 'standard' | 'gm'
export type LegacyParamStyle = 'endpoint-scoped' | 'explicit'

export interface NetworkConfig {
	id: string
	name: string
	rpcUrl: string
	mode: AdapterMode
	crypto: CryptoKind
	chainId: number
	groupId?: string
	nodeId?: string
	legacyParamStyle?: LegacyParamStyle
	allowInsecureLocalhost?: boolean
	compatibilityVersion?: string
	billingEnabled?: boolean
	balanceDecimals?: number
	balanceToken?: string
}

export interface ProviderRequest {
	method: string
	params?: readonly unknown[] | Record<string, unknown>
}

export interface JsonRpcErrorObject {
	code: number
	message: string
	data?: unknown
}

export interface JsonRpcResponse<T = unknown> {
	jsonrpc: '2.0'
	id: number
	result?: T
	error?: JsonRpcErrorObject
}
