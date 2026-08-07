import type {WalletStatus} from '../core/wallet/types'

export interface WalletStatusTransition<View extends string> {
	targetView: View
	clearSensitive: boolean
	closeTransientUi: boolean
	stopBusy: boolean
	clearHome: boolean
	refreshHome: boolean
}

export const planWalletStatusTransition = <View extends string>(
	status: WalletStatus,
	currentView: View,
): WalletStatusTransition<View> => {
	if (!status.initialized) {
		return {
			targetView: 'welcome' as View,
			clearSensitive: true,
			closeTransientUi: true,
			stopBusy: true,
			clearHome: true,
			refreshHome: false,
		}
	}
	if (status.locked) {
		return {
			targetView: 'unlock' as View,
			clearSensitive: true,
			closeTransientUi: true,
			stopBusy: true,
			clearHome: true,
			refreshHome: false,
		}
	}
	const shouldEnterHome = currentView === 'unlock' || currentView === 'loading'
	return {
		targetView: (shouldEnterHome ? 'done' : currentView) as View,
		clearSensitive: false,
		closeTransientUi: false,
		stopBusy: shouldEnterHome,
		clearHome: false,
		refreshHome: shouldEnterHome,
	}
}
