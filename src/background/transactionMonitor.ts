import type {ChainAdapter} from '../core/adapters/chainAdapter.ts'
import {ChainAdapterFactory} from '../core/adapters/factory.ts'
import {readFiscoBlockNumber} from '../core/transaction/fiscoNetworkMetadata.ts'
import {parseFiscoTransactionReceipt} from '../core/transaction/fiscoTransactionReceipt.ts'
import type {TransactionActivity, TransactionWatch,} from '../shared/walletHomeMessages.ts'

export const TRANSACTION_POLL_INTERVAL_MS = 30_000
export const TRANSACTION_MAX_ATTEMPTS = 40
export const TRANSACTION_MONITOR_TIMEOUT_MS = 20 * 60_000
export const TRANSACTION_FAST_POLL_DELAYS_MS = [
	2_000,
	2_000,
	2_000,
	2_000,
	2_000,
	5_000,
	5_000,
	5_000,
	5_000,
] as const

interface LocalWakeTiming {
	setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>

	clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

const defaultTiming: LocalWakeTiming = {
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (timer) => clearTimeout(timer),
}

export interface TransactionRepository {
	listWatches(): Promise<TransactionWatch[]>

	track(activity: TransactionActivity, watch: TransactionWatch): Promise<void>

	saveWatch(watch: TransactionWatch): Promise<void>

	complete(activityId: string, update: Partial<TransactionActivity>): Promise<void>
}

export interface TransactionWakeScheduler {
	schedule(at: number | undefined): Promise<void>
}

interface AdapterFactory {
	create(network: TransactionWatch['network']): Promise<ChainAdapter>
}

interface MonitorOptions {
	pollIntervalMs?: number
	maxAttempts?: number
	fastPollDelaysMs?: readonly number[]
	localWakeThresholdMs?: number
	timing?: LocalWakeTiming
	now?: () => number
}

const errorMessage = (reason: unknown): string =>
	reason instanceof Error ? reason.message : 'RPC 查询失败'

export class TransactionMonitor {
	readonly pollIntervalMs: number
	readonly maxAttempts: number
	readonly initialPollDelayMs: number
	private readonly inFlight = new Map<string, Promise<void>>()
	private localWakeTimer?: ReturnType<typeof setTimeout>
	private readonly fastPollDelaysMs: readonly number[]
	private readonly localWakeThresholdMs: number
	private readonly timing: LocalWakeTiming
	private readonly now: () => number

	constructor(
		private readonly repository: TransactionRepository,
		private readonly scheduler: TransactionWakeScheduler,
		private readonly adapters: AdapterFactory = new ChainAdapterFactory(),
		options: MonitorOptions = {},
	) {
		this.pollIntervalMs = options.pollIntervalMs ?? TRANSACTION_POLL_INTERVAL_MS
		this.maxAttempts = options.maxAttempts ?? TRANSACTION_MAX_ATTEMPTS
		this.fastPollDelaysMs =
			options.fastPollDelaysMs ??
			(options.pollIntervalMs === undefined ? TRANSACTION_FAST_POLL_DELAYS_MS : [])
		this.initialPollDelayMs = this.fastPollDelaysMs[0] ?? this.pollIntervalMs
		this.localWakeThresholdMs =
			options.localWakeThresholdMs ??
			(options.pollIntervalMs === undefined ? TRANSACTION_POLL_INTERVAL_MS : 0)
		this.timing = options.timing ?? defaultTiming
		this.now = options.now ?? Date.now
	}

	async track(activity: TransactionActivity, watch: TransactionWatch): Promise<void> {
		await this.repository.track(activity, watch)
		await this.scheduleNext()
	}

	async resumePending(): Promise<void> {
		await this.scheduleNext()
	}

	async pollDue(): Promise<void> {
		try {
			const now = this.now()
			const watches = await this.repository.listWatches()
			for (const watch of watches.filter((candidate) => candidate.nextCheckAt <= now)) {
				await this.pollOne(watch)
			}
		} finally {
			await this.scheduleNext()
		}
	}

	pollOne(watch: TransactionWatch): Promise<void> {
		const active = this.inFlight.get(watch.activityId)
		if (active) return active
		const operation = this.runPoll(watch).finally(() => this.inFlight.delete(watch.activityId))
		this.inFlight.set(watch.activityId, operation)
		return operation
	}

	private async runPoll(original: TransactionWatch): Promise<void> {
		const checkedAt = this.now()
		const watch: TransactionWatch = {
			...original,
			attempts: original.attempts + 1,
			lastCheckedAt: checkedAt,
		}
		// Persist before RPC so a suspended worker cannot retry forever without consuming attempts.
		await this.repository.saveWatch(watch)

		let adapter: ChainAdapter
		try {
			adapter = await this.adapters.create(watch.network)
		} catch (error) {
			return this.continueOrTimeout(watch, errorMessage(error))
		}

		const [receiptResult, blockResult] = await Promise.allSettled([
			adapter.request({method: 'eth_getTransactionReceipt', params: [watch.hash]}),
			watch.blockLimit === undefined
				? Promise.resolve(undefined)
				: adapter.request({method: 'fisco_getBlockNumber', params: []}),
		])
		const parsed =
			receiptResult.status === 'fulfilled'
				? parseFiscoTransactionReceipt(receiptResult.value, watch.hash)
				: undefined

		// A valid receipt is final even if the same poll observes a block beyond blockLimit.
		if (parsed?.kind === 'receipt') {
			const successful = parsed.receipt.successful
			await this.repository.complete(watch.activityId, {
				status: successful ? 'success' : 'failed',
				confirmedAt: new Date(checkedAt).toISOString(),
				receiptStatus: parsed.receipt.status,
				...(parsed.receipt.blockNumber
					? {receiptBlockNumber: parsed.receipt.blockNumber}
					: {}),
				...(successful ? {} : {failureMessage: `链上执行状态 ${parsed.receipt.status}`}),
			})
			return
		}

		let currentBlock: bigint | undefined
		let blockError: string | undefined
		if (blockResult.status === 'fulfilled' && blockResult.value !== undefined) {
			try {
				currentBlock = readFiscoBlockNumber(blockResult.value)
			} catch (error) {
				blockError = errorMessage(error)
			}
		} else if (blockResult.status === 'rejected') {
			blockError = errorMessage(blockResult.reason)
		}
		if (
			currentBlock !== undefined &&
			watch.blockLimit !== undefined &&
			currentBlock > BigInt(watch.blockLimit)
		) {
			await this.repository.complete(watch.activityId, {
				status: 'expired',
				failureMessage: '超过交易有效块高仍未获得回执',
			})
			return
		}

		const lastError =
			parsed?.kind === 'malformed'
				? parsed.error
				: receiptResult.status === 'rejected'
					? errorMessage(receiptResult.reason)
					: blockError
		await this.continueOrTimeout(watch, lastError)
	}

	private async continueOrTimeout(watch: TransactionWatch, lastError?: string): Promise<void> {
		const now = this.now()
		const timedOut =
			watch.expiresAt === undefined
				? watch.attempts >= watch.maxAttempts
				: now >= watch.expiresAt
		if (timedOut) {
			await this.repository.complete(watch.activityId, {
				status: 'timeout',
				failureMessage:
					watch.expiresAt === undefined ? '达到最大回执查询次数' : '交易回执监控超时',
			})
			return
		}
		await this.repository.saveWatch({
			...watch,
			nextCheckAt: now + this.nextPollDelay(watch.attempts),
			...(lastError ? {lastError} : {}),
		})
	}

	private async scheduleNext(): Promise<void> {
		const watches = await this.repository.listWatches()
		const next = watches.reduce<number | undefined>(
			(earliest, watch) =>
				earliest === undefined || watch.nextCheckAt < earliest ? watch.nextCheckAt : earliest,
			undefined,
		)
		await this.scheduler.schedule(next)
		this.scheduleLocalWake(next)
	}

	private nextPollDelay(attempts: number): number {
		return this.fastPollDelaysMs[attempts] ?? this.pollIntervalMs
	}

	private scheduleLocalWake(at: number | undefined): void {
		if (this.localWakeTimer !== undefined) {
			this.timing.clearTimeout(this.localWakeTimer)
			this.localWakeTimer = undefined
		}
		if (at === undefined || this.localWakeThresholdMs <= 0) return
		const delayMs = Math.max(0, at - this.now())
		if (delayMs >= this.localWakeThresholdMs) return
		this.localWakeTimer = this.timing.setTimeout(() => {
			this.localWakeTimer = undefined
			void this.pollDue().catch((error) => {
				console.error('交易回执快速查询失败', error)
			})
		}, delayMs)
	}
}
