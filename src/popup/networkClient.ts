import type {
	AddNetworkInput,
	NetworkRuntimeRequest,
	NetworkRuntimeResponse,
	NetworkRuntimeResult,
	UpdateNetworkInput,
} from '@/shared/networkMessages'
import type {NetworkConfig} from '@/shared/types'

const send = <T extends NetworkRuntimeResult>(request: NetworkRuntimeRequest): Promise<T> =>
	new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(request, (response: NetworkRuntimeResponse<T> | undefined) => {
			const runtimeError = chrome.runtime.lastError
			if (runtimeError) return reject(new Error(runtimeError.message))
			if (!response) return reject(new Error('钱包后台没有响应'))
			if (response.error) {
				return reject(
					Object.assign(new Error(response.error.message), {code: response.error.code}),
				)
			}
			if (!('result' in response)) return reject(new Error('钱包后台返回了无效响应'))
			resolve(response.result as T)
		})
	})

export const getActiveNetwork = (): Promise<NetworkConfig | null> =>
	send<NetworkConfig | null>({type: 'NETWORK_GET_ACTIVE'})

export const addNetwork = (input: AddNetworkInput): Promise<NetworkConfig> =>
	send<NetworkConfig>({type: 'NETWORK_ADD', input})

export const listNetworks = (): Promise<NetworkConfig[]> =>
	send<NetworkConfig[]>({type: 'NETWORK_LIST'})

export const updateNetwork = (input: UpdateNetworkInput): Promise<NetworkConfig> =>
	send<NetworkConfig>({type: 'NETWORK_UPDATE', input})

export const deleteNetwork = (id: string): Promise<NetworkConfig[]> =>
	send<NetworkConfig[]>({type: 'NETWORK_DELETE', id})

export const setActiveNetwork = (id: string): Promise<NetworkConfig> =>
	send<NetworkConfig>({type: 'NETWORK_SET_ACTIVE', id})
