import type {AdapterMode, NetworkConfig} from './types'

export interface AddNetworkInput {
	name: string
	url: string
	mode: AdapterMode
	groupId?: string
	chainId?: number
	isGM: boolean
	billingEnabled: boolean
	balanceDecimals: number
	balanceToken: string
}

export interface UpdateNetworkInput extends AddNetworkInput {
	id: string
}

export type NetworkRuntimeRequest =
	| { type: 'NETWORK_LIST' }
	| { type: 'NETWORK_GET_ACTIVE' }
	| { type: 'NETWORK_ADD'; input: AddNetworkInput }
	| { type: 'NETWORK_UPDATE'; input: UpdateNetworkInput }
	| { type: 'NETWORK_DELETE'; id: string }
	| { type: 'NETWORK_SET_ACTIVE'; id: string }

export type NetworkRuntimeResult = NetworkConfig | NetworkConfig[] | null

export interface NetworkRuntimeResponse<T extends NetworkRuntimeResult = NetworkRuntimeResult> {
	result?: T
	error?: { code: number; message: string }
}

export const isNetworkRuntimeRequest = (value: unknown): value is NetworkRuntimeRequest => {
	if (!value || typeof value !== 'object' || !('type' in value)) return false
	const type = (value as { type?: unknown }).type
	return (
		type === 'NETWORK_LIST' ||
		type === 'NETWORK_GET_ACTIVE' ||
		type === 'NETWORK_ADD' ||
		type === 'NETWORK_UPDATE' ||
		type === 'NETWORK_DELETE' ||
		type === 'NETWORK_SET_ACTIVE'
	)
}
