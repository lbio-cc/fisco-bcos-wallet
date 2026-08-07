import {providerErrors} from '../errors.ts'
import {HttpJsonRpcTransport} from '../transport/jsonRpcTransport.ts'
import type {ChainAdapter} from './chainAdapter.ts'
import {LegacyAdapter} from './legacyAdapter.ts'
import {Web3Adapter} from './web3Adapter.ts'
import type {NetworkConfig} from '@/shared/types'

export class ChainAdapterFactory {
	private readonly cache = new Map<string, Promise<ChainAdapter>>()

	create(network: NetworkConfig): Promise<ChainAdapter> {
		const cacheKey = JSON.stringify(network)
		const cached = this.cache.get(cacheKey)
		if (cached) return cached

		const adapter = this.createUncached(network)
		this.cache.set(cacheKey, adapter)
		adapter.catch(() => this.cache.delete(cacheKey))
		return adapter
	}

	private async createUncached(network: NetworkConfig): Promise<ChainAdapter> {
		const transport = new HttpJsonRpcTransport(
			network.rpcUrl,
			network.allowInsecureLocalhost ?? false,
		)
		if (network.mode === 'web3') return new Web3Adapter(transport)
		if (network.mode === 'legacy') return new LegacyAdapter(transport, network)
		throw providerErrors.disconnected(`Unsupported RPC mode: ${String(network.mode)}`)
	}
}
