import {providerErrors} from '../errors.ts'
import type {RpcTransport} from '../transport/jsonRpcTransport.ts'
import type {ChainAdapter} from './chainAdapter.ts'
import type {ProviderRequest} from '@/shared/types'

const BLOCKED_NODE_METHODS = new Set([
	'eth_sign',
	'personal_sign',
	'personal_unlockAccount',
])

export class Web3Adapter implements ChainAdapter {
	readonly mode = 'web3' as const

	constructor(private readonly transport: RpcTransport) {
	}

	request<T>({method, params = []}: ProviderRequest): Promise<T> {
		if (BLOCKED_NODE_METHODS.has(method) || method.startsWith('wallet_')) {
			throw providerErrors.unsupported(method)
		}
		return this.transport.request<T>(method, params)
	}
}
