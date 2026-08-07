import type {WalletStatus} from '../core/wallet/types.ts'
import type {WalletStatusBroadcaster} from './walletStatusBroadcast.ts'

export const WALLET_AUTO_LOCK_ALARM = 'wallet:auto-lock'

export interface WalletAutoLockBackend {
	getAutoLockDeadline(): Promise<number | undefined>
	lockIfIdle(): Promise<WalletStatus | undefined>
}

export interface WalletAutoLockAlarm {
	schedule(at: number): Promise<void> | void
	clear(): Promise<void> | void
}

export class WalletAutoLockController {
	constructor(
		private readonly wallet: WalletAutoLockBackend,
		private readonly alarm: WalletAutoLockAlarm,
		private readonly broadcast: WalletStatusBroadcaster,
	) {
	}

	async sync(): Promise<void> {
		const deadline = await this.wallet.getAutoLockDeadline()
		if (deadline === undefined) {
			await this.alarm.clear()
			return
		}
		await this.alarm.schedule(deadline)
	}

	async wake(): Promise<void> {
		const status = await this.wallet.lockIfIdle()
		if (status) this.broadcast(status)
		await this.sync()
	}
}
