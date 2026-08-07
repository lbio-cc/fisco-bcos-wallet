import {MnemonicWalletManager} from '@/core/wallet/mnemonicWalletManager'
import {isWalletRuntimeRequest, type WalletRuntimeRequest, type WalletRuntimeResponse,} from '@/shared/walletMessages'
import {ChromeWalletRepository} from './chromeWalletRepository'
import {ChromeWalletSessionStore} from './chromeWalletSessionStore'
import {broadcastWalletStatusChanged, type WalletStatusBroadcaster,} from './walletStatusBroadcast'
import {handleWalletRequestWithManager} from './walletRequestHandler'
import {broadcastProviderStateChanged} from './providerStateBroadcast'
import {WALLET_AUTO_LOCK_ALARM, WalletAutoLockController,} from './walletAutoLock.ts'

export const walletManager = new MnemonicWalletManager(
	new ChromeWalletRepository(),
	undefined,
	new ChromeWalletSessionStore(),
)

const autoLockController = new WalletAutoLockController(
	walletManager,
	{
		schedule: (at) => chrome.alarms.create(WALLET_AUTO_LOCK_ALARM, {when: at}),
		clear: () => new Promise((resolve) => {
			chrome.alarms.clear(WALLET_AUTO_LOCK_ALARM, () => resolve())
		}),
	},
	broadcastWalletStatusChanged,
)

export const registerWalletRuntime = (): void => {
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name !== WALLET_AUTO_LOCK_ALARM) return
		void autoLockController.wake().catch((error) => {
			console.error('钱包自动锁定失败', error)
		})
	})
	void autoLockController.sync().catch((error) => {
		console.error('恢复钱包自动锁定计时失败', error)
	})
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): boolean => {
		if (!isWalletRuntimeRequest(message)) return false
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse({error: {code: 4100, message: '不允许其他扩展访问钱包管理接口'}})
			return false
		}

		void handleWalletRequest(
			message,
			broadcastWalletStatusChanged,
			broadcastProviderStateChanged,
		)
			.then(async (result) => {
				await autoLockController.sync()
				sendResponse({result} satisfies WalletRuntimeResponse)
			})
			.catch((error: unknown) => {
				sendResponse({
					error: {
						code: -32603,
						message: error instanceof Error ? error.message : '钱包操作失败',
					},
				} satisfies WalletRuntimeResponse)
			})
		return true
	})
}

export const handleWalletRequest = (
	message: WalletRuntimeRequest,
	broadcast: WalletStatusBroadcaster = broadcastWalletStatusChanged,
	broadcastProviderState = broadcastProviderStateChanged,
) => handleWalletRequestWithManager(message, walletManager, broadcast, broadcastProviderState)
