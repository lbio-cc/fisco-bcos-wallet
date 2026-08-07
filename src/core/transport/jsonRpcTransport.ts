import {ProviderError, providerErrors} from '../errors.ts'
import type {JsonRpcResponse} from '@/shared/types'
import {fetchJsonWithLimits} from './httpLimits.ts'

export const RPC_REQUEST_TIMEOUT_MS = 30_000
export const RPC_RESPONSE_LIMIT_BYTES = 8 * 1024 * 1024

export interface RpcTransport {
	request<T>(method: string, params?: readonly unknown[] | Record<string, unknown>): Promise<T>
}

export class HttpJsonRpcTransport implements RpcTransport {
	private nextId = 1

	constructor(
		private readonly endpoint: string,
		private readonly allowInsecureLocalhost = false,
		private readonly timeoutMs = RPC_REQUEST_TIMEOUT_MS,
		private readonly maxResponseBytes = RPC_RESPONSE_LIMIT_BYTES,
	) {
		this.assertSafeEndpoint()
	}

	async request<T>(
		method: string,
		params: readonly unknown[] | Record<string, unknown> = [],
	): Promise<T> {
		let response: Response
		let value: unknown
		const requestId = this.nextId++
		try {
			const bounded = await fetchJsonWithLimits(
				this.endpoint,
				{
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({jsonrpc: '2.0', id: requestId, method, params}),
				},
				{
					timeoutMs: this.timeoutMs,
					maxResponseBytes: this.maxResponseBytes,
					label: 'RPC',
				},
			)
			response = bounded.response
			value = bounded.value
		} catch (error) {
			throw providerErrors.disconnected(
				error instanceof Error ? error.message : 'Unable to reach the RPC endpoint',
			)
		}

		if (!response.ok) {
			throw providerErrors.disconnected(`RPC endpoint returned HTTP ${response.status}`)
		}

		const payload = readJsonRpcResponse<T>(value, requestId)
		if (payload.error) {
			throw new ProviderError(payload.error.code, payload.error.message, payload.error.data)
		}
		if (!('result' in payload)) throw new ProviderError(-32603, 'Malformed JSON-RPC response')
		return payload.result as T
	}

	private assertSafeEndpoint(): void {
		const url = new URL(this.endpoint)
		const isLoopback =
			url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
		if (url.protocol !== 'https:' && !(this.allowInsecureLocalhost && isLoopback)) {
			throw new Error(
				'RPC endpoint must use HTTPS; HTTP is only allowed for explicit loopback development',
			)
		}
	}
}

export const readJsonRpcResponse = <T>(value: unknown, requestId: number): JsonRpcResponse<T> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ProviderError(-32603, 'Malformed JSON-RPC response')
	}
	const payload = value as Record<string, unknown>
	const hasResult = Object.prototype.hasOwnProperty.call(payload, 'result')
	const hasError = Object.prototype.hasOwnProperty.call(payload, 'error')
	if (
		payload.jsonrpc !== '2.0' ||
		payload.id !== requestId ||
		hasResult === hasError
	) {
		throw new ProviderError(-32603, 'Malformed JSON-RPC response')
	}
	if (hasError) {
		const error = payload.error
		if (
			!error ||
			typeof error !== 'object' ||
			Array.isArray(error) ||
			!Number.isInteger((error as Record<string, unknown>).code) ||
			typeof (error as Record<string, unknown>).message !== 'string'
		) {
			throw new ProviderError(-32603, 'Malformed JSON-RPC response')
		}
	}
	return value as JsonRpcResponse<T>
}
