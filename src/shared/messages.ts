import type {ProviderRequest} from './types'

export const PAGE_CHANNEL = 'fisco-wallet:page'
export const CONTENT_CHANNEL = 'fisco-wallet:content'
export const PROVIDER_EVENT_CHANNEL = 'fisco-wallet:provider-event'

export type ProviderStateChange = 'accounts' | 'group' | 'chain'

export interface ProviderStateChangedEvent {
	type: 'FISCO_PROVIDER_STATE_CHANGED'
	changes: ProviderStateChange[]
}

export interface PageProviderStateChangedMessage {
	channel: typeof PROVIDER_EVENT_CHANNEL
	changes: ProviderStateChange[]
}

export interface PageRequestMessage {
	channel: typeof PAGE_CHANNEL
	id: string
	request: ProviderRequest
}

export interface PageResponseMessage {
	channel: typeof CONTENT_CHANNEL
	id: string
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

export interface RuntimeRequestMessage {
	type: 'FISCO_PROVIDER_REQUEST'
	id: string
	origin: string
	request: ProviderRequest
}

export const isProviderStateChangedEvent = (
	value: unknown,
): value is ProviderStateChangedEvent => {
	if (!value || typeof value !== 'object') return false
	const event = value as Partial<ProviderStateChangedEvent>
	return (
		event.type === 'FISCO_PROVIDER_STATE_CHANGED' &&
		Array.isArray(event.changes) &&
		event.changes.length > 0 &&
		event.changes.every(
			(change) => change === 'accounts' || change === 'group' || change === 'chain',
		)
	)
}

export function isPageRequest(value: unknown): value is PageRequestMessage {
	if (!value || typeof value !== 'object') return false
	const message = value as Partial<PageRequestMessage>
	return (
		message.channel === PAGE_CHANNEL &&
		typeof message.id === 'string' &&
		!!message.request &&
		typeof message.request.method === 'string'
	)
}
