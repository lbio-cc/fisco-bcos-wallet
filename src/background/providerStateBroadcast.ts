import type {
	ProviderStateChange,
	ProviderStateChangedEvent,
} from '../shared/messages.ts'

export type ProviderStateBroadcaster = (
	changes: readonly ProviderStateChange[],
) => void

export const broadcastProviderStateChanged: ProviderStateBroadcaster = (changes) => {
	const tabsApi = chrome.tabs
	if (!tabsApi) return
	const event: ProviderStateChangedEvent = {
		type: 'FISCO_PROVIDER_STATE_CHANGED',
		changes: [...new Set(changes)],
	}
	tabsApi.query({}, (tabs) => {
		const queryError = chrome.runtime.lastError
		if (queryError) return
		for (const tab of tabs) {
			if (tab.id === undefined) continue
			tabsApi.sendMessage(tab.id, event, () => {
				// Tabs without an injected content script are expected. Reading lastError handles it.
				void chrome.runtime.lastError
			})
		}
	})
}

export const runAndBroadcastProviderState = async <T>(
	operation: () => Promise<T>,
	changes: readonly ProviderStateChange[],
	broadcast: ProviderStateBroadcaster,
): Promise<T> => {
	const result = await operation()
	broadcast(changes)
	return result
}
