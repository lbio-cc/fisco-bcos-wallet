import {providerErrors} from '../core/errors.ts'
import type {
	ApprovalData,
	ApprovalKind,
	ConnectApprovalData,
	SwitchApprovalData,
	TransactionApprovalData,
} from '../shared/approvalMessages.ts'

export interface ApprovalGateway {
	approveConnect(data: ConnectApprovalData): Promise<number[]>

	approveTransaction(data: TransactionApprovalData): Promise<void>

	approveSwitch(data: SwitchApprovalData): Promise<void>
}

export interface ApprovalWindowApi {
	create(url: string): Promise<number>

	close(windowId: number): Promise<void>

	onRemoved(listener: (windowId: number) => void): void
}

export interface ApprovalTiming {
	now(): number

	setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>

	clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

const systemApprovalTiming: ApprovalTiming = {
	now: Date.now,
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (timer) => clearTimeout(timer),
}

export const isExpectedApprovalPage = (
	sender: { id?: string; url?: string },
	kind: ApprovalKind,
	runtimeId: string,
	extensionRootUrl: string,
): boolean => {
	if (sender.id !== runtimeId || !sender.url) return false
	try {
		const candidate = new URL(sender.url)
		const root = new URL(extensionRootUrl)
		return (
			candidate.protocol === root.protocol &&
			candidate.host === root.host &&
			candidate.pathname === `/${kind}-approval.html`
		)
	} catch {
		return false
	}
}

interface PendingApproval {
	token: string
	kind: ApprovalKind
	data: ApprovalData
	expiresBy?: number
	windowId?: number
	timer?: ReturnType<typeof setTimeout>

	resolve(value: number[] | void): void

	reject(error: unknown): void
}

export class ApprovalController implements ApprovalGateway {
	private readonly queue: PendingApproval[] = []
	private readonly pending = new Map<string, PendingApproval>()
	private readonly windows = new Map<number, string>()
	private readonly connectByContext = new Map<string, Promise<number[]>>()
	private active?: PendingApproval

	constructor(
		private readonly windowApi: ApprovalWindowApi,
		private readonly timeoutMs = 5 * 60_000,
		private readonly tokenFactory = () => crypto.randomUUID(),
		private readonly maxLifetimeMs = timeoutMs * 6,
		private readonly timing: ApprovalTiming = systemApprovalTiming,
	) {
		windowApi.onRemoved((windowId) => this.handleWindowRemoved(windowId))
	}

	approveConnect(data: ConnectApprovalData): Promise<number[]> {
		const contextKey = this.connectContextKey(data)
		const existing = this.connectByContext.get(contextKey)
		if (existing) return existing
		const request = this.enqueue(data) as Promise<number[]>
		this.connectByContext.set(contextKey, request)
		void request.finally(() => {
			if (this.connectByContext.get(contextKey) === request) {
				this.connectByContext.delete(contextKey)
			}
		}).catch(() => undefined)
		return request
	}

	approveTransaction(data: TransactionApprovalData): Promise<void> {
		return this.enqueue(data) as Promise<void>
	}

	approveSwitch(data: SwitchApprovalData): Promise<void> {
		return this.enqueue(data) as Promise<void>
	}

	get(token: string, kind: ApprovalKind): ApprovalData | undefined {
		const item = this.pending.get(token)
		return item?.kind === kind ? item.data : undefined
	}

	heartbeat(token: string, kind: ApprovalKind): boolean {
		const item = this.pending.get(token)
		if (!item || item.kind !== kind) return false
		// Only an opened approval window has an expiry timer to renew. Queued
		// requests receive their full timeout when their window is created.
		if (item.windowId !== undefined) this.scheduleExpiry(item)
		return this.pending.has(token)
	}

	resolve(
		token: string,
		kind: ApprovalKind,
		approved: boolean,
		accountIndexes?: number[],
	): boolean {
		const item = this.pending.get(token)
		if (!item || item.kind !== kind) return false
		if (!approved) {
			this.settle(item, undefined, providerErrors.userRejected())
			return true
		}
		if (kind === 'connect') {
			if (!Array.isArray(accountIndexes)) return false
			this.settle(item, [...accountIndexes])
		} else {
			this.settle(item)
		}
		return true
	}

	private enqueue(data: ApprovalData): Promise<number[] | void> {
		const token = this.tokenFactory()
		return new Promise((resolve, reject) => {
			const item: PendingApproval = {
				token,
				kind: data.kind,
				data,
				resolve,
				reject,
			}
			this.pending.set(token, item)
			this.queue.push(item)
			void this.pump()
		})
	}

	private connectContextKey(data: ConnectApprovalData): string {
		return JSON.stringify({
			origin: data.origin,
			network: {
				id: data.network.id,
				rpcUrl: data.network.rpcUrl,
				groupId: data.network.groupId,
				chainId: data.network.chainId,
				crypto: data.network.crypto,
			},
			accounts: data.accounts.map((account) => ({
				index: account.index,
				address: account.address.toLowerCase(),
			})),
		})
	}

	private async pump(): Promise<void> {
		if (this.active) return
		const item = this.queue.shift()
		if (!item) return
		this.active = item
		try {
			const windowId = await this.windowApi.create(
				`${item.kind}-approval.html?approval=${encodeURIComponent(item.token)}`,
			)
			if (!this.pending.has(item.token)) return
			item.windowId = windowId
			this.windows.set(windowId, item.token)
			item.expiresBy = this.timing.now() + this.maxLifetimeMs
			this.scheduleExpiry(item)
		} catch (error) {
			this.settle(item, undefined, error)
		}
	}

	private handleWindowRemoved(windowId: number): void {
		const token = this.windows.get(windowId)
		if (!token) return
		const item = this.pending.get(token)
		if (item) this.settle(item, undefined, providerErrors.userRejected(), false)
	}

	private scheduleExpiry(item: PendingApproval): void {
		if (item.timer) this.timing.clearTimeout(item.timer)
		const now = this.timing.now()
		const remainingLifetime = (item.expiresBy ?? now + this.maxLifetimeMs) - now
		if (remainingLifetime <= 0) {
			this.settle(item, undefined, providerErrors.userRejected())
			return
		}
		item.timer = this.timing.setTimeout(
			() => this.settle(item, undefined, providerErrors.userRejected()),
			Math.min(this.timeoutMs, remainingLifetime),
		)
	}

	private settle(
		item: PendingApproval,
		value?: number[] | void,
		error?: unknown,
		closeWindow = true,
	): void {
		if (!this.pending.delete(item.token)) return
		if (item.timer) this.timing.clearTimeout(item.timer)
		if (item.windowId !== undefined) {
			this.windows.delete(item.windowId)
			if (closeWindow) void this.windowApi.close(item.windowId).catch(() => undefined)
		}
		if (this.active === item) this.active = undefined
		if (error) item.reject(error)
		else item.resolve(value)
		void this.pump()
	}
}

export const createChromeApprovalWindowApi = (): ApprovalWindowApi => ({
	create: (path) =>
		new Promise((resolve, reject) => {
			chrome.windows.create(
				{
					url: chrome.runtime.getURL(path),
					type: 'popup',
					focused: true,
					width: 420,
					height: 680,
				},
				(window) => {
					const error = chrome.runtime.lastError
					if (error) reject(new Error(error.message))
					else if (window?.id === undefined) reject(new Error('无法创建审批窗口'))
					else resolve(window.id)
				},
			)
		}),
	close: (windowId) =>
		new Promise((resolve) => chrome.windows.remove(windowId, () => resolve())),
	onRemoved: (listener) => chrome.windows.onRemoved.addListener(listener),
})
