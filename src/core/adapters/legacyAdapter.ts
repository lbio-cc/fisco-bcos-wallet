import {providerErrors} from '../errors.ts'
import {readTransactionHash} from '../transaction/providerTransaction.ts'
import type {RpcTransport} from '../transport/jsonRpcTransport'
import type {ChainAdapter} from './chainAdapter'
import type {NetworkConfig, ProviderRequest} from '@/shared/types'

type Mapping = {
	method: string
	transformParams?: (params: readonly unknown[]) => readonly unknown[]
	transformResult?: (value: unknown) => unknown
}

const quantity = (value: unknown): `0x${string}` => {
	if (typeof value === 'string' && value.startsWith('0x')) return value as `0x${string}`
	const parsed = typeof value === 'number' ? BigInt(value) : BigInt(String(value))
	return `0x${parsed.toString(16)}`
}

const callParams = (params: readonly unknown[]): readonly unknown[] => {
	const [transaction, blockTag] = params
	if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
		throw providerErrors.invalidParams('eth_call requires a transaction object')
	}
	if (blockTag !== undefined && blockTag !== 'latest') {
		throw providerErrors.invalidParams('Legacy FISCO eth_call only supports the latest block')
	}

	const {to, data = '0x'} = transaction as { to?: unknown; data?: unknown }
	if (typeof to !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
		throw providerErrors.invalidParams('eth_call requires a valid contract address')
	}
	if (typeof data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) {
		throw providerErrors.invalidParams('eth_call data must be even-length hexadecimal')
	}
	return [to, data]
}

const callResult = (value: unknown): `0x${string}` => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Malformed legacy FISCO call response')
	}
	const output = (value as { output?: unknown }).output
	if (typeof output !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(output)) {
		throw new Error('Malformed legacy FISCO call output')
	}
	return output as `0x${string}`
}

const METHOD_MAP: Record<string, Mapping> = {
	eth_blockNumber: {method: 'getBlockNumber', transformResult: quantity},
	eth_getCode: {method: 'getCode', transformParams: (params) => params.slice(0, 1)},
	eth_call: {
		method: 'call',
		transformParams: callParams,
		transformResult: callResult,
	},
	eth_getTransactionReceipt: {method: 'getTransactionReceipt'},
	eth_getTransactionByHash: {method: 'getTransaction'},
	eth_sendRawTransaction: {method: 'sendTransaction', transformResult: readTransactionHash},
}

export class LegacyAdapter implements ChainAdapter {
	readonly mode = 'legacy' as const

	constructor(
		private readonly transport: RpcTransport,
		private readonly network: NetworkConfig,
	) {
	}

	async request<T>({method, params = []}: ProviderRequest): Promise<T> {
		if (method === 'eth_chainId') return quantity(this.network.chainId) as T
		if (method === 'net_version') return String(this.network.chainId) as T

		const mapping = METHOD_MAP[method]
		const nativeMethod = mapping?.method ?? this.unwrapNativeMethod(method)
		const positionalParams = this.asArray(params)
		const transformedParams = mapping?.transformParams
			? mapping.transformParams(positionalParams)
			: positionalParams
		const result = await this.transport.request<unknown>(nativeMethod, transformedParams)
		return (mapping?.transformResult ? mapping.transformResult(result) : result) as T
	}

	private unwrapNativeMethod(method: string): string {
		if (method.startsWith('fisco_') && method.length > 6) return method.slice(6)
		throw providerErrors.unsupported(method)
	}

	private asArray(params: readonly unknown[] | Record<string, unknown>): readonly unknown[] {
		if (!Array.isArray(params)) {
			throw providerErrors.invalidParams('Legacy FISCO RPC requires positional parameters')
		}
		return params
	}
}
