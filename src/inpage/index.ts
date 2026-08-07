import {
	CONTENT_CHANNEL,
	PAGE_CHANNEL,
	PROVIDER_EVENT_CHANNEL,
	type PageProviderStateChangedMessage,
	type PageResponseMessage,
} from '../shared/messages.ts'
import type {JsonRpcErrorObject, ProviderRequest} from '../shared/types.ts'

type Listener = (...args: unknown[]) => void
type JsonRpcId = string | number | null

export interface JsonRpcRequest extends ProviderRequest {
	id?: JsonRpcId
	jsonrpc?: '2.0'
}

export interface JsonRpcProviderResponse<T = unknown> {
	id: JsonRpcId
	jsonrpc: '2.0'
	result?: T
	error?: JsonRpcErrorObject
}

export type JsonRpcCallback<T = unknown> = (
	error: Error | null,
	response?: JsonRpcProviderResponse<T>,
) => void

export class FiscoProvider {
	readonly isFiscoWallet = true
	private static readonly DEFAULT_REQUEST_TIMEOUT_MS = 60_000
	private readonly pending = new Map<
		string,
		{
			method: string
			params?: ProviderRequest['params']
			emitAccountsChanged?: boolean
			emitGroupChanged?: boolean
			emitChainChanged?: boolean
			resolve: (value: unknown) => void
			reject: (reason: unknown) => void
			timer: ReturnType<typeof setTimeout>
		}
	>()
	private readonly listeners = new Map<string, Set<Listener>>()
	private accounts?: string[]
	private groupId?: string
	private chainId?: string

	constructor(
		private readonly requestTimeoutMs = FiscoProvider.DEFAULT_REQUEST_TIMEOUT_MS,
	) {
		window.addEventListener('message', (event: MessageEvent<PageResponseMessage>) => {
			if (event.source !== window || event.data?.channel !== CONTENT_CHANNEL) return
			const request = this.pending.get(event.data.id)
			if (!request) return
			this.pending.delete(event.data.id)
			globalThis.clearTimeout(request.timer)
			if (event.data.error) {
				request.reject(Object.assign(new Error(event.data.error.message), event.data.error))
			} else {
				this.handleResult(
					request.method,
					request.params,
					event.data.result,
					request.emitAccountsChanged,
					request.emitGroupChanged,
					request.emitChainChanged,
				)
				request.resolve(event.data.result)
			}
		})
		window.addEventListener(
			'message',
			(event: MessageEvent<PageProviderStateChangedMessage>) => {
				if (
					event.source !== window ||
					event.data?.channel !== PROVIDER_EVENT_CHANNEL ||
					!Array.isArray(event.data.changes)
				) {
					return
				}
				const changes = new Set(event.data.changes)
				if (changes.has('group')) {
					void this.requestInternal(
						{method: 'wallet_getGroup'},
						{emitGroupChanged: true},
					).catch(() => undefined)
				}
				if (changes.has('chain')) {
					void this.requestInternal(
						{method: 'eth_chainId'},
						{emitChainChanged: true},
					).catch(() => undefined)
				}
				if (changes.has('accounts')) {
					void this.requestInternal(
						{method: 'eth_accounts'},
						{emitAccountsChanged: true},
					).catch(() => undefined)
				}
			},
		)
	}

	request<T = unknown>(request: ProviderRequest): Promise<T> {
		return this.requestInternal(request)
	}

	private requestInternal<T = unknown>(
		request: ProviderRequest,
		options: {
			emitAccountsChanged?: boolean
			emitGroupChanged?: boolean
			emitChainChanged?: boolean
		} = {},
	): Promise<T> {
		if (!request || typeof request.method !== 'string') {
			return Promise.reject(Object.assign(new Error('Invalid provider request'), {code: -32602}))
		}
		const id = crypto.randomUUID()
		return new Promise<T>((resolve, reject) => {
			const timer = globalThis.setTimeout(() => {
				if (!this.pending.delete(id)) return
				reject(Object.assign(new Error('Provider request timed out'), {code: 4900}))
			}, this.requestTimeoutMs)
			this.pending.set(id, {
				method: request.method,
				params: request.params,
				...options,
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			})
			window.postMessage({channel: PAGE_CHANNEL, id, request}, window.location.origin)
		})
	}

	send<T = unknown>(
		method: string,
		params?: ProviderRequest['params'],
	): Promise<T>
	send<T = unknown>(payload: JsonRpcRequest): Promise<JsonRpcProviderResponse<T>>
	send<T = unknown>(payload: JsonRpcRequest, callback: JsonRpcCallback<T>): void
	send<T = unknown>(
		methodOrPayload: string | JsonRpcRequest,
		paramsOrCallback?: ProviderRequest['params'] | JsonRpcCallback<T>,
	): Promise<T | JsonRpcProviderResponse<T>> | void {
		if (typeof methodOrPayload === 'string') {
			if (typeof paramsOrCallback === 'function') {
				throw new TypeError('A callback can only be used with a JSON-RPC payload')
			}
			return this.request<T>({method: methodOrPayload, params: paramsOrCallback})
		}

		if (typeof paramsOrCallback === 'function') {
			this.sendAsync(methodOrPayload, paramsOrCallback)
			return
		}

		return this.request<T>(methodOrPayload).then((result) =>
			this.createJsonRpcResponse(methodOrPayload, result),
		)
	}

	sendAsync<T = unknown>(payload: JsonRpcRequest, callback: JsonRpcCallback<T>): void {
		if (typeof callback !== 'function') {
			throw new TypeError('JSON-RPC callback must be a function')
		}

		this.request<T>(payload).then(
			(result) => callback(null, this.createJsonRpcResponse(payload, result)),
			(error: unknown) => callback(this.toError(error)),
		)
	}

	on(event: string, listener: Listener): this {
		const listeners = this.listeners.get(event) ?? new Set()
		listeners.add(listener)
		this.listeners.set(event, listeners)
		return this
	}

	removeListener(event: string, listener: Listener): this {
		this.listeners.get(event)?.delete(listener)
		return this
	}

	protected emit(event: string, ...args: unknown[]): void {
		this.listeners.get(event)?.forEach((listener) => {
			try {
				listener(...args)
			} catch (error) {
				queueMicrotask(() => {
					throw error
				})
			}
		})
	}

	private handleResult(
		method: string,
		params: ProviderRequest['params'],
		result: unknown,
		emitAccountsChanged = false,
		emitGroupChanged = false,
		emitChainChanged = false,
	): void {
		if ((method === 'eth_accounts' || method === 'eth_requestAccounts') && Array.isArray(result)) {
			const accounts = result.filter((value): value is string => typeof value === 'string')
			const changed =
				this.accounts !== undefined &&
				(accounts.length !== this.accounts.length ||
					accounts.some((account, index) => account !== this.accounts?.[index]))
			const shouldEmit = method === 'eth_requestAccounts' && this.accounts === undefined
			this.accounts = accounts
			if (changed || shouldEmit || emitAccountsChanged) {
				this.emit('accountsChanged', [...accounts])
			}
			return
		}

		if (method === 'wallet_getGroup' && typeof result === 'string') {
			const changed = this.groupId !== undefined && this.groupId !== result
			const firstEvent = emitGroupChanged && this.groupId === undefined
			this.groupId = result
			if (changed || firstEvent) this.emit('groupChanged', result)
			return
		}

		if (method === 'eth_chainId' && typeof result === 'string') {
			const changed = this.chainId !== undefined && this.chainId !== result
			const firstEvent = emitChainChanged && this.chainId === undefined
			this.chainId = result
			if (changed || firstEvent) this.emit('chainChanged', result)
			return
		}

		if (method === 'wallet_switchGroup' && Array.isArray(params)) {
			const input = params[0]
			const requested =
				input && typeof input === 'object' && 'groupId' in input
					? (input as { groupId?: unknown }).groupId
					: undefined
			if (typeof requested === 'string') {
				const normalized = requested.trim()
				if (normalized !== this.groupId) {
					this.groupId = normalized
					this.emit('groupChanged', normalized)
				}
			}
		}

		if (method === 'wallet_switchEthereumChain' && Array.isArray(params)) {
			const input = params[0]
			const requested =
				input && typeof input === 'object' && 'chainId' in input
					? (input as {chainId?: unknown}).chainId
					: undefined
			if (typeof requested === 'string' && requested !== this.chainId) {
				this.chainId = requested
				this.emit('chainChanged', requested)
			}
		}
	}

	private createJsonRpcResponse<T>(
		payload: JsonRpcRequest,
		result: T,
	): JsonRpcProviderResponse<T> {
		return {
			id: payload.id ?? null,
			jsonrpc: '2.0',
			result,
		}
	}

	private toError(error: unknown): Error {
		return error instanceof Error ? error : new Error(String(error))
	}
}

Object.defineProperty(window, 'fisco', {
	value: new FiscoProvider(),
	configurable: false,
	enumerable: false,
	writable: false,
})
