import type {ProviderRequest} from '@/shared/types'

export type ResolvedAdapterMode = 'web3' | 'legacy'

export interface ChainAdapter {
	readonly mode: ResolvedAdapterMode

	request<T = unknown>(request: ProviderRequest): Promise<T>
}

