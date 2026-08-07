import type {MnemonicWalletManager} from '../core/wallet/mnemonicWalletManager'
import type {WalletRuntimeRequest} from '../shared/walletMessages'
import {runAndBroadcastWalletStatus, type WalletStatusBroadcaster,} from './walletStatusBroadcast.ts'
import {
	runAndBroadcastProviderState,
	type ProviderStateBroadcaster,
} from './providerStateBroadcast.ts'

type WalletRequestManager = Pick<
	MnemonicWalletManager,
	| 'getStatus'
	| 'create'
	| 'restore'
	| 'confirmBackup'
	| 'unlock'
	| 'lock'
	| 'addAccount'
	| 'updateAccount'
	| 'selectAccount'
	| 'deleteAccount'
	| 'exportMnemonic'
	| 'exportPrivateKey'
	| 'reset'
>

export const handleWalletRequestWithManager = (
	message: WalletRuntimeRequest,
	manager: WalletRequestManager,
	broadcast: WalletStatusBroadcaster,
	broadcastProviderState: ProviderStateBroadcaster = () => undefined,
) => {
	switch (message.type) {
		case 'WALLET_GET_STATUS':
			return manager.getStatus()
		case 'WALLET_CREATE_MNEMONIC':
			return runAndBroadcastWalletStatus(
				() => manager.create(message.input),
				() => manager.getStatus(),
				broadcast,
			)
		case 'WALLET_RESTORE_MNEMONIC':
			return runAndBroadcastWalletStatus(
				() => manager.restore(message.input),
				() => manager.getStatus(),
				broadcast,
			)
		case 'WALLET_CONFIRM_MNEMONIC_BACKUP':
			return manager.confirmBackup()
		case 'WALLET_UNLOCK':
			return runAndBroadcastWalletStatus(
				() => manager.unlock(message.input),
				() => manager.getStatus(),
				broadcast,
			)
		case 'WALLET_LOCK':
			return runAndBroadcastWalletStatus(
				() => manager.lock(),
				() => manager.getStatus(),
				broadcast,
			)
		case 'WALLET_ADD_ACCOUNT':
			return manager.addAccount(message.input)
		case 'WALLET_UPDATE_ACCOUNT':
			return manager.updateAccount(message.input)
		case 'WALLET_SELECT_ACCOUNT':
			return runAndBroadcastProviderState(
				() => manager.selectAccount(message.input),
				['accounts'],
				broadcastProviderState,
			)
		case 'WALLET_DELETE_ACCOUNT':
			return manager.deleteAccount(message.input)
		case 'WALLET_EXPORT_MNEMONIC':
			return manager.exportMnemonic(message.input)
		case 'WALLET_EXPORT_PRIVATE_KEY':
			return manager.exportPrivateKey(message.input)
		case 'WALLET_RESET':
			return runAndBroadcastWalletStatus(
				() => manager.reset(message.input),
				() => manager.getStatus(),
				broadcast,
			)
	}
}
