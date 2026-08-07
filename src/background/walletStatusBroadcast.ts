import type {WalletStatus} from '../core/wallet/types'
import type {WalletStatusChangedEvent} from '../shared/walletMessages'

export type WalletStatusBroadcaster = (status: WalletStatus) => void

export const broadcastWalletStatusChanged: WalletStatusBroadcaster = (status) => {
	const event: WalletStatusChangedEvent = {type: 'WALLET_STATUS_CHANGED', status}
	chrome.runtime.sendMessage(event, () => {
		// No open extension page is a normal state. Reading lastError marks it handled.
		void chrome.runtime.lastError
	})
}

export const runAndBroadcastWalletStatus = async <T>(
	operation: () => Promise<T>,
	readFinalStatus: () => Promise<WalletStatus>,
	broadcast: WalletStatusBroadcaster,
): Promise<T> => {
	const result = await operation()
	const status = await readFinalStatus()
	broadcast(status)
	return result
}
