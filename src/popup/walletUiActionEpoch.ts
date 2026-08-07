export interface WalletUiActionEpoch {
	capture(): number

	invalidate(): void

	isCurrent(epoch: number): boolean

	commit(epoch: number, mutation: () => void): boolean
}

export const createWalletUiActionEpoch = (): WalletUiActionEpoch => {
	let currentEpoch = 0
	return {
		capture: () => currentEpoch,
		invalidate: () => {
			currentEpoch += 1
		},
		isCurrent: (epoch) => epoch === currentEpoch,
		commit(epoch, mutation) {
			if (epoch !== currentEpoch) return false
			mutation()
			return true
		},
	}
}
