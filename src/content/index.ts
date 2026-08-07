import {
	CONTENT_CHANNEL,
	isPageRequest,
	isProviderStateChangedEvent,
	PROVIDER_EVENT_CHANNEL,
	type PageResponseMessage,
	type RuntimeRequestMessage,
} from '@/shared/messages'

const script = document.createElement('script')
script.src = chrome.runtime.getURL('inpage.js')
script.async = false
script.onload = () => script.remove()
;(document.head ?? document.documentElement).appendChild(script)

window.addEventListener('message', (event: MessageEvent<unknown>) => {
	if (event.source !== window || !isPageRequest(event.data)) return
	const pageRequest = event.data

	const runtimeMessage: RuntimeRequestMessage = {
		type: 'FISCO_PROVIDER_REQUEST',
		id: pageRequest.id,
		origin: window.location.origin,
		request: pageRequest.request,
	}
	chrome.runtime.sendMessage(runtimeMessage, (response) => {
		const runtimeError = chrome.runtime.lastError
		const message: PageResponseMessage = {
			channel: CONTENT_CHANNEL,
			id: pageRequest.id,
			...(runtimeError
				? {error: {code: -32603, message: runtimeError.message}}
				: response),
		}
		window.postMessage(message, window.location.origin)
	})
})

chrome.runtime.onMessage.addListener((message: unknown, sender): boolean => {
	if (sender.id !== chrome.runtime.id || !isProviderStateChangedEvent(message)) return false
	window.postMessage(
		{
			channel: PROVIDER_EVENT_CHANNEL,
			changes: message.changes,
		},
		window.location.origin,
	)
	return false
})
