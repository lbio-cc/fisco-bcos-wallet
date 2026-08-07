import {NetworkManager} from '@/core/networks/networkManager'
import {HttpJsonRpcTransport} from '@/core/transport/jsonRpcTransport'
import {
	isNetworkRuntimeRequest,
	type NetworkRuntimeRequest,
	type NetworkRuntimeResponse,
} from '@/shared/networkMessages'
import {networkStore} from './chromeStorage'
import {
	broadcastProviderStateChanged,
	runAndBroadcastProviderState,
	type ProviderStateBroadcaster,
} from './providerStateBroadcast'

const manager = new NetworkManager(
	networkStore,
	(endpoint, allowInsecureLocalhost) =>
		new HttpJsonRpcTransport(endpoint, allowInsecureLocalhost),
)

export const registerNetworkRuntime = (): void => {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): boolean => {
		if (!isNetworkRuntimeRequest(message)) return false
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse({error: {code: 4100, message: '不允许其他扩展访问网络管理接口'}})
			return false
		}

		void handleNetworkRequest(message, broadcastProviderStateChanged)
			.then((result) => sendResponse({result} satisfies NetworkRuntimeResponse))
			.catch((error: unknown) => {
				sendResponse({
					error: {
						code: -32603,
						message: error instanceof Error ? error.message : '网络探测失败',
					},
				} satisfies NetworkRuntimeResponse)
			})
		return true
	})
}

export const handleNetworkRequest = (
	message: NetworkRuntimeRequest,
	broadcast: ProviderStateBroadcaster = broadcastProviderStateChanged,
) => {
	switch (message.type) {
		case 'NETWORK_LIST':
			return manager.list()
		case 'NETWORK_GET_ACTIVE':
			return manager.getActive()
		case 'NETWORK_ADD':
			return manager.add(message.input)
		case 'NETWORK_UPDATE':
			return manager.update(message.input)
		case 'NETWORK_DELETE':
			return manager.delete(message.id)
		case 'NETWORK_SET_ACTIVE':
			return runAndBroadcastProviderState(
				() => manager.setActive(message.id),
				['group', 'accounts'],
				broadcast,
			)
	}
}
