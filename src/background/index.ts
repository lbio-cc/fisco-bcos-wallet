import {ProviderError} from '@/core/errors'
import {PermissionController} from '@/core/permissions/permissionController'
import type {RuntimeRequestMessage} from '@/shared/messages'
import {
	activityStore,
	ChromePermissionStore,
	getTransactionActivities,
	listPermissions,
	networkStore,
	transactionRepository,
} from './chromeStorage'
import {RequestRouter} from './requestRouter'
import {ChainAdapterFactory} from '@/core/adapters/factory'
import {TRANSACTION_POLL_INTERVAL_MS, TransactionMonitor,} from './transactionMonitor'
import {isWalletHomeRequest, type WalletHomeSnapshot,} from '@/shared/walletHomeMessages'

import {registerWalletRuntime, walletManager} from './walletRuntime'
import {registerNetworkRuntime} from './networkRuntime'
import {registerAssetRuntime} from './assetRuntime'
import {ApprovalController, createChromeApprovalWindowApi, isExpectedApprovalPage,} from './approvalController'
import {type ApprovalKind, isApprovalRuntimeRequest,} from '@/shared/approvalMessages'
import {broadcastProviderStateChanged} from './providerStateBroadcast'

registerWalletRuntime()
registerNetworkRuntime()
const approvalController = new ApprovalController(createChromeApprovalWindowApi())
const TRANSACTION_MONITOR_ALARM = 'wallet:transaction-receipt-monitor'
const alarmOperation = (
	operation: (done: () => void) => void,
): Promise<void> =>
	new Promise((resolve, reject) => {
		operation(() => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve()
		})
	})
const getTransactionMonitorAlarm = (): Promise<
	{ name: string; scheduledTime: number } | undefined
> =>
	new Promise((resolve, reject) => {
		chrome.alarms.get(TRANSACTION_MONITOR_ALARM, (alarm) => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve(alarm)
		})
	})
const alarmScheduler = {
	async schedule(at: number | undefined): Promise<void> {
		if (at === undefined) {
			await alarmOperation((done) => chrome.alarms.clear(TRANSACTION_MONITOR_ALARM, done))
			return
		}
		const durableWakeAt = Math.max(at, Date.now() + TRANSACTION_POLL_INTERVAL_MS)
		const existing = await getTransactionMonitorAlarm()
		if (existing && existing.scheduledTime <= durableWakeAt) return
		await alarmOperation((done) =>
			chrome.alarms.create(TRANSACTION_MONITOR_ALARM, {when: durableWakeAt}, done),
		)
	},
}
const adapterFactory = new ChainAdapterFactory()
const transactionMonitor = new TransactionMonitor(
	transactionRepository,
	alarmScheduler,
	adapterFactory,
)
const router = new RequestRouter(
	new PermissionController(new ChromePermissionStore()),
	walletManager,
	networkStore,
	adapterFactory,
	activityStore,
	approvalController,
	transactionMonitor,
	broadcastProviderStateChanged,
)
registerAssetRuntime((params) => router.sendWalletTransaction(params))

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name !== TRANSACTION_MONITOR_ALARM) return
	void transactionMonitor.pollDue().catch((error) => {
		console.error('交易回执监控唤醒失败', error)
	})
})
void transactionMonitor.resumePending().catch((error) => {
	console.error('恢复交易回执监控失败', error)
})

const permissions = new PermissionController(new ChromePermissionStore())

const getCurrentOrigin = async (): Promise<string | undefined> => {
	const tabs = await new Promise<Array<{ url?: string }>>((resolve, reject) => {
		if (!chrome.tabs?.query) return resolve([])
		chrome.tabs.query({active: true, currentWindow: true}, (items) => {
			const error = chrome.runtime.lastError
			if (error) reject(new Error(error.message))
			else resolve(items)
		})
	})
	const url = tabs[0]?.url
	if (!url) return undefined
	try {
		const parsed = new URL(url)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
	} catch {
		return undefined
	}
}

const getHomeSnapshot = async (): Promise<WalletHomeSnapshot> => {
	const [currentOrigin, permissionItems, activities] = await Promise.all([
		getCurrentOrigin(),
		listPermissions(),
		getTransactionActivities(),
	])
	return {currentOrigin, permissions: permissionItems, activities}
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): boolean => {
	if (!isWalletHomeRequest(message)) return false
	if (sender.id && sender.id !== chrome.runtime.id) {
		sendResponse({error: {code: 4100, message: '不允许其他扩展访问钱包管理接口'}})
		return false
	}
	void (async () => {
		if (message.type === 'WALLET_HOME_REVOKE_PERMISSION') {
			await permissions.revoke(message.origin)
		}
		return getHomeSnapshot()
	})()
		.then((result) => sendResponse({result}))
		.catch((error: unknown) =>
			sendResponse({
				error: {
					code: -32603,
					message: error instanceof Error ? error.message : '读取钱包首页数据失败',
				},
			}),
		)
	return true
})

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): boolean => {
	if (!isApprovalRuntimeRequest(message)) return false
	const validSender = isExpectedApprovalPage(
		sender,
		message.kind,
		chrome.runtime.id,
		chrome.runtime.getURL('/'),
	)
	if (!validSender) {
		sendResponse({error: {code: 4100, message: '审批请求来源无效'}})
		return false
	}

	if (message.type === 'APPROVAL_GET') {
		const data = approvalController.get(message.token, message.kind)
		sendResponse(
			data
				? {result: {data}}
				: {error: {code: 4001, message: '审批请求已失效或不存在'}},
		)
		return false
	}
	if (message.type === 'APPROVAL_HEARTBEAT') {
		sendResponse(
			approvalController.heartbeat(message.token, message.kind)
				? {result: {accepted: true}}
				: {error: {code: 4001, message: '审批请求已失效或不存在'}},
		)
		return false
	}
	const accepted = approvalController.resolve(
		message.token,
		message.kind as ApprovalKind,
		message.approved,
		message.accountIndexes,
	)
	sendResponse(
		accepted
			? {result: {accepted: true}}
			: {error: {code: 4001, message: '审批请求已失效或决策无效'}},
	)
	return false
})

chrome.runtime.onMessage.addListener(
	(message: RuntimeRequestMessage, sender, sendResponse): boolean => {
		if (message?.type !== 'FISCO_PROVIDER_REQUEST') return false

		const senderOrigin = sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined)
		if (!senderOrigin || senderOrigin !== message.origin) {
			sendResponse({error: {code: 4100, message: 'Message origin mismatch'}})
			return false
		}

		void router
			.request(senderOrigin, message.request)
			.then((result) => sendResponse({result}))
			.catch((error: unknown) => {
				const normalized =
					error instanceof ProviderError
						? {code: error.code, message: error.message, data: error.data}
						: {
							code: -32603,
							message: error instanceof Error ? error.message : 'Internal wallet error',
						}
				sendResponse({error: normalized})
			})
		return true
	},
)
