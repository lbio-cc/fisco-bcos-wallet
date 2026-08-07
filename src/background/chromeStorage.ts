import type {PermissionStore} from '../core/permissions/permissionController.ts'
import type {Hex, NetworkConfig} from '../shared/types.ts'
import type {AuthorizedSite, TransactionActivity, TransactionWatch,} from '../shared/walletHomeMessages.ts'
import {TRANSACTION_ACTIVITIES_STORAGE_KEY} from '../shared/walletHomeMessages.ts'
import {assetRepository} from './assetRepository.ts'

const PERMISSION_PREFIX = 'permission:'
const ACTIVE_NETWORK = 'activeNetwork'
const NETWORKS = 'networks'
export const TRANSACTION_ACTIVITIES = TRANSACTION_ACTIVITIES_STORAGE_KEY
export const TRANSACTION_WATCHES = 'wallet:transactionWatches'

let transactionWriteQueue: Promise<void> = Promise.resolve()
const serializeTransactionWrite = <T>(operation: () => Promise<T>): Promise<T> => {
	const result = transactionWriteQueue.then(operation, operation)
	transactionWriteQueue = result.then(() => undefined, () => undefined)
	return result
}

const getValue = <T>(key: string): Promise<T | undefined> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.get(key, (result) => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve(result[key] as T | undefined)
		})
	})

const setValue = (key: string, value: unknown): Promise<void> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.set({[key]: value}, () => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve()
		})
	})

const setValues = (values: Record<string, unknown>): Promise<void> =>
	new Promise((resolve, reject) => {
		chrome.storage.local.set(values, () => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve()
		})
	})

export class ChromePermissionStore implements PermissionStore {
	async get(origin: string): Promise<readonly Hex[]> {
		return (await getValue<Hex[]>(`${PERMISSION_PREFIX}${origin}`)) ?? []
	}

	set(origin: string, accounts: readonly Hex[]): Promise<void> {
		return setValue(`${PERMISSION_PREFIX}${origin}`, [...accounts])
	}
}

export const listPermissions = async (): Promise<AuthorizedSite[]> => {
	const values = await new Promise<Record<string, unknown>>((resolve, reject) => {
		chrome.storage.local.get(null, (result) => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve(result)
		})
	})
	return Object.entries(values)
		.filter(([key, accounts]) => key.startsWith(PERMISSION_PREFIX) && Array.isArray(accounts))
		.map(([key, accounts]) => ({
			origin: key.slice(PERMISSION_PREFIX.length),
			accounts: accounts as Hex[],
		}))
		.filter((permission) => permission.accounts.length > 0)
		.sort((a, b) => a.origin.localeCompare(b.origin))
}

export const getTransactionActivities = async (): Promise<TransactionActivity[]> =>
	(await getValue<TransactionActivity[]>(TRANSACTION_ACTIVITIES)) ?? []

export const getTransactionWatches = async (): Promise<TransactionWatch[]> =>
	(await getValue<TransactionWatch[]>(TRANSACTION_WATCHES)) ?? []

export const activityStore = {
	add: (activity: TransactionActivity): Promise<void> =>
		serializeTransactionWrite(async () => {
			const [activities, watches] = await Promise.all([
				getTransactionActivities(),
				getTransactionWatches(),
			])
			const keptActivities = [activity, ...activities.filter((item) => item.id !== activity.id)].slice(
				0,
				100,
			)
			const keptIds = new Set(keptActivities.map((item) => item.id))
			await setValues({
				[TRANSACTION_ACTIVITIES]: keptActivities,
				[TRANSACTION_WATCHES]: watches.filter((watch) => keptIds.has(watch.activityId)),
			})
		}),
}

export const transactionRepository = {
	listWatches: getTransactionWatches,

	track: (activity: TransactionActivity, watch: TransactionWatch): Promise<void> =>
		serializeTransactionWrite(async () => {
			const [activities, watches] = await Promise.all([
				getTransactionActivities(),
				getTransactionWatches(),
			])
			const keptActivities = [activity, ...activities.filter((item) => item.id !== activity.id)].slice(
				0,
				100,
			)
			const keptIds = new Set(keptActivities.map((item) => item.id))
			const nextWatches = [
				watch,
				...watches.filter(
					(item) => item.activityId !== watch.activityId && keptIds.has(item.activityId),
				),
			]
			await setValues({
				[TRANSACTION_ACTIVITIES]: keptActivities,
				[TRANSACTION_WATCHES]: nextWatches,
			})
		}),

	saveWatch: (watch: TransactionWatch): Promise<void> =>
		serializeTransactionWrite(async () => {
			const [activities, watches] = await Promise.all([
				getTransactionActivities(),
				getTransactionWatches(),
			])
			const activityExists = activities.some((activity) => activity.id === watch.activityId)
			await setValue(TRANSACTION_WATCHES, [
				...(activityExists ? [watch] : []),
				...watches.filter((item) => item.activityId !== watch.activityId),
			])
		}),

	complete: (
		activityId: string,
		update: Partial<TransactionActivity>,
	): Promise<void> =>
		serializeTransactionWrite(async () => {
			const [activities, watches] = await Promise.all([
				getTransactionActivities(),
				getTransactionWatches(),
			])
			await setValues({
				[TRANSACTION_ACTIVITIES]: activities.map((activity) =>
					activity.id === activityId ? {...activity, ...update} : activity,
				),
				[TRANSACTION_WATCHES]: watches.filter((watch) => watch.activityId !== activityId),
			})
		}),
}

export const networkStore = {
	async getAll(): Promise<NetworkConfig[]> {
		return (await getValue<NetworkConfig[]>(NETWORKS)) ?? []
	},
	getActive: () => getValue<NetworkConfig>(ACTIVE_NETWORK),
	async add(network: NetworkConfig): Promise<void> {
		const networks = await this.getAll()
		await setValues({[NETWORKS]: [...networks, network], [ACTIVE_NETWORK]: network})
	},
	async update(network: NetworkConfig): Promise<void> {
		const [networks, active] = await Promise.all([this.getAll(), this.getActive()])
		const updated = networks.map((candidate) =>
			candidate.id === network.id ? network : candidate,
		)
		await setValues({
			[NETWORKS]: updated,
			...(active?.id === network.id ? {[ACTIVE_NETWORK]: network} : {}),
		})
	},
	async delete(id: string): Promise<void> {
		const networks = await this.getAll()
		await Promise.all([
			setValue(NETWORKS, networks.filter((network) => network.id !== id)),
			assetRepository.cleanupNetwork(id),
		])
	},
	setActive: (network: NetworkConfig) => setValue(ACTIVE_NETWORK, network),
}
