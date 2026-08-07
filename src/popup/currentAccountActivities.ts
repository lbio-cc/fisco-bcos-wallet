import type {WalletAccountSummary} from '@/core/wallet/types'
import type {TransactionActivity} from '@/shared/walletHomeMessages'
import type {NetworkConfig} from '@/shared/types'

const normalizeAddress = (address: string | undefined): string =>
	address?.trim().toLowerCase() ?? ''

export const filterActivitiesForAccount = (
	activities: readonly TransactionActivity[],
	account: WalletAccountSummary | undefined,
	network: NetworkConfig | null,
): TransactionActivity[] => {
	if (!account || !network) return []
	const groupId = network.mode === 'web3' ? `web3:${network.chainId}` : network.groupId

	return activities.filter((activity) => {
		if (
			activity.networkId !== network.id ||
			activity.crypto !== network.crypto ||
			activity.groupId !== groupId
		) return false
		const accountAddress = normalizeAddress(account.addresses[activity.crypto])
		if (!accountAddress) return false

		return (
			normalizeAddress(activity.from) === accountAddress ||
			normalizeAddress(activity.to) === accountAddress
		)
	})
}
