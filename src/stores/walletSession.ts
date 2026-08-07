import {computed, ref} from 'vue'
import {defineStore} from 'pinia'
import type {WalletAccountSummary, WalletSummary} from '@/core/wallet/types'
import type {NetworkConfig} from '@/shared/types'

export const useWalletSessionStore = defineStore('walletSession', () => {
	const summary = ref<WalletSummary>()
	const activeNetwork = ref<NetworkConfig | null>(null)

	const activeAccount = computed(() =>
		summary.value?.accounts.find((account) => account.index === summary.value?.activeAccountIndex),
	)
	const activeCrypto = computed(() => activeNetwork.value?.crypto)

	const accountAddress = (account?: WalletAccountSummary): string => {
		const crypto = activeCrypto.value
		return crypto ? (account?.addresses[crypto] ?? '') : ''
	}

	const clear = (): void => {
		summary.value = undefined
	}

	return {
		summary,
		activeNetwork,
		activeAccount,
		activeCrypto,
		accountAddress,
		clear,
	}
})
