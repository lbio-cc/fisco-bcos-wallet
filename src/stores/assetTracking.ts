import {computed, ref} from 'vue'
import {defineStore} from 'pinia'
import type {AssetHomeSnapshot} from '@/shared/assetMessages'
import {addAsset, getAssetSnapshot, refreshAsset, refreshAssetMetadata, refreshNativeBalance, removeAsset, updateAsset} from '@/popup/assetClient'

export const useAssetTrackingStore = defineStore('assetTracking', () => {
	const snapshot = ref<AssetHomeSnapshot>({
		assets: [],
		metadataBytes: 0,
		metadataBudgetBytes: 4 * 1024 * 1024,
	})
	const loading = ref(false)
	const nativeBalanceLoading = ref(false)
	const error = ref('')
	const contract = ref('')
	const action = ref<string>()
	const metadataActions = ref<Record<string, boolean>>({})
	const metadataErrors = ref<Record<string, string>>({})
	const removeContract = ref<string>()
	let refreshRevision = 0
	let nativeRefreshRevision = 0

	const sameContext = (next: AssetHomeSnapshot): boolean =>
		snapshot.value.networkId === next.networkId &&
		snapshot.value.account?.toLowerCase() === next.account?.toLowerCase()

	const applySnapshot = (next: AssetHomeSnapshot): void => {
		const nativeBalance = next.nativeBalance ?? (sameContext(next) ? snapshot.value.nativeBalance : undefined)
		snapshot.value = {...next, nativeBalance}
	}

	const cacheUsage = computed(() => {
		const used = snapshot.value.metadataBytes / 1024
		const total = snapshot.value.metadataBudgetBytes / 1024 / 1024
		return `${used < 10 ? used.toFixed(1) : Math.round(used)} KiB / ${total.toFixed(0)} MiB`
	})

	const refresh = async (): Promise<void> => {
		const revision = ++refreshRevision
		loading.value = true
		try {
			const next = await getAssetSnapshot()
			if (revision !== refreshRevision) return
			applySnapshot(next)
			error.value = ''
		} catch (cause) {
			if (revision === refreshRevision) {
				error.value = cause instanceof Error ? cause.message : '读取资产失败'
			}
		} finally {
			if (revision === refreshRevision) loading.value = false
		}
	}

	const refreshNative = async (): Promise<void> => {
		const revision = ++nativeRefreshRevision
		nativeBalanceLoading.value = true
		try {
			const next = await refreshNativeBalance()
			if (revision !== nativeRefreshRevision) return
			if (!snapshot.value.networkId || sameContext(next)) {
				snapshot.value = {
					...snapshot.value,
					networkId: next.networkId,
					networkName: next.networkName,
					account: next.account,
					nativeBalance: next.nativeBalance,
				}
			}
			error.value = ''
		} catch (cause) {
			if (revision === nativeRefreshRevision) {
				error.value = cause instanceof Error ? cause.message : '读取原生余额失败'
			}
		} finally {
			if (revision === nativeRefreshRevision) nativeBalanceLoading.value = false
		}
	}

	const add = async (): Promise<boolean> => {
		action.value = 'add'
		error.value = ''
		try {
			applySnapshot(await addAsset(contract.value))
			return true
		} catch (cause) {
			error.value = cause instanceof Error ? cause.message : '添加资产失败'
			return false
		} finally {
			action.value = undefined
		}
	}

	const runAction = async (
		kind: 'refresh' | 'remove' | 'update',
		assetContract: string,
		chainKey: string,
		fields?: {customName?: string; customSymbol?: string},
	): Promise<boolean> => {
		action.value = `${kind}:${assetContract}`
		error.value = ''
		try {
			const next =
				kind === 'refresh'
					? await refreshAsset(assetContract, chainKey)
					: kind === 'update'
							? await updateAsset(assetContract, chainKey, fields?.customName, fields?.customSymbol)
							: await removeAsset(assetContract, chainKey)
			applySnapshot(next)
			if (kind === 'remove') removeContract.value = undefined
			return true
		} catch (cause) {
			error.value = cause instanceof Error ? cause.message : '资产操作失败'
			return false
		} finally {
			action.value = undefined
		}
	}

	const metadataActionKey = (assetContract: string, tokenId: string): string =>
		`${assetContract}:${tokenId}`

	const refreshNftMetadata = async (
		assetContract: string,
		chainKey: string,
		tokenId: string,
	): Promise<boolean> => {
		const key = metadataActionKey(assetContract, tokenId)
		if (metadataActions.value[key]) return false
		metadataActions.value = {...metadataActions.value, [key]: true}
		const nextErrors = {...metadataErrors.value}
		delete nextErrors[key]
		metadataErrors.value = nextErrors
		try {
			applySnapshot(await refreshAssetMetadata(assetContract, chainKey, tokenId))
			return true
		} catch (cause) {
			metadataErrors.value = {
				...metadataErrors.value,
				[key]: cause instanceof Error ? cause.message : 'metadata 刷新失败',
			}
			return false
		} finally {
			const nextActions = {...metadataActions.value}
			delete nextActions[key]
			metadataActions.value = nextActions
		}
	}

	const invalidate = (): void => {
		refreshRevision += 1
		nativeRefreshRevision += 1
		snapshot.value = {
			assets: [],
			metadataBytes: 0,
			metadataBudgetBytes: 4 * 1024 * 1024,
		}
		loading.value = false
		nativeBalanceLoading.value = false
		action.value = undefined
		metadataActions.value = {}
		metadataErrors.value = {}
		error.value = ''
		removeContract.value = undefined
	}

	return {
		snapshot,
		loading,
		nativeBalanceLoading,
		error,
		contract,
		action,
		metadataActions,
		metadataErrors,
		removeContract,
		cacheUsage,
		refresh,
		refreshNative,
		add,
		runAction,
		metadataActionKey,
		refreshNftMetadata,
		invalidate,
	}
})
