import {computed, ref} from 'vue'
import {defineStore} from 'pinia'
import type {WalletHomeSnapshot} from '@/shared/walletHomeMessages'
import {getWalletHomeSnapshot, revokeSitePermission,} from '@/popup/walletHomeClient'
import {filterActivitiesForAccount} from '@/popup/currentAccountActivities'
import {useWalletSessionStore} from '@/stores/walletSession'

export const useWalletHomeStore = defineStore('walletHome', () => {
	const session = useWalletSessionStore()
	const snapshot = ref<WalletHomeSnapshot>({permissions: [], activities: []})
	const loading = ref(false)
	const error = ref('')
	let refreshRevision = 0

	const currentPermission = computed(() =>
		snapshot.value.permissions.find(
			(permission) => permission.origin === snapshot.value.currentOrigin,
		),
	)

	const currentAccountActivities = computed(() =>
		filterActivitiesForAccount(
			snapshot.value.activities,
			session.activeAccount,
			session.activeNetwork,
		),
	)

	const validNetworkAddresses = computed(
		() =>
			new Set(
				(session.summary?.accounts ?? []).map((account) =>
					session.accountAddress(account).toLowerCase(),
				),
			),
	)

	const isCurrentSiteConnected = computed(
		() =>
			!!snapshot.value.currentOrigin &&
			!!currentPermission.value?.accounts.some((address) =>
				validNetworkAddresses.value.has(address.toLowerCase()),
			),
	)

	const currentSiteLabel = computed(() => {
		const origin = snapshot.value.currentOrigin
		if (!origin) return '当前页面不可连接'
		try {
			return new URL(origin).host
		} catch {
			return origin
		}
	})

	const refresh = async (isCurrent: () => boolean = () => true): Promise<void> => {
		const revision = ++refreshRevision
		loading.value = true
		error.value = ''
		try {
			const next = await getWalletHomeSnapshot()
			if (revision === refreshRevision && isCurrent()) snapshot.value = next
		} catch (cause) {
			if (revision === refreshRevision && isCurrent()) {
				error.value = cause instanceof Error ? cause.message : '读取连接与活动数据失败'
			}
		} finally {
			if (revision === refreshRevision && isCurrent()) loading.value = false
		}
	}

	const revokePermission = async (origin: string): Promise<void> => {
		const revision = ++refreshRevision
		error.value = ''
		try {
			const next = await revokeSitePermission(origin)
			if (revision === refreshRevision) snapshot.value = next
		} catch (cause) {
			if (revision === refreshRevision) {
				error.value = cause instanceof Error ? cause.message : '撤销授权失败'
			}
		}
	}

	const clear = (): void => {
		refreshRevision += 1
		loading.value = false
		error.value = ''
		snapshot.value = {permissions: [], activities: []}
	}

	return {
		snapshot,
		loading,
		error,
		currentPermission,
		currentAccountActivities,
		isCurrentSiteConnected,
		currentSiteLabel,
		refresh,
		revokePermission,
		clear,
	}
})
