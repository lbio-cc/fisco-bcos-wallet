import {reactive, ref} from 'vue'
import {defineStore} from 'pinia'
import type {AddNetworkInput} from '@/shared/networkMessages'
import type {NetworkConfig} from '@/shared/types'
import {
	addNetwork,
	deleteNetwork,
	getActiveNetwork,
	listNetworks,
	setActiveNetwork,
	updateNetwork,
} from '@/popup/networkClient'
import {useWalletSessionStore} from '@/stores/walletSession'

const errorMessage = (cause: unknown): string =>
	cause instanceof Error ? cause.message : '网络操作失败'

export const useNetworkManagementStore = defineStore('networkManagement', () => {
	const session = useWalletSessionStore()
	const savedNetworks = ref<NetworkConfig[]>([])
	const busy = ref(false)
	const error = ref('')
	const editingNetworkId = ref<string>()
	const deleteConfirmationId = ref<string>()
	const form = reactive({
		name: '',
		url: '',
		mode: 'legacy' as 'legacy' | 'web3',
		groupId: 'group0',
		chainId: 1,
		isGM: false,
		billingEnabled: false,
		balanceDecimals: 18,
		balanceToken: 'FBT',
	})
	let operationRevision = 0

	const resetError = (): void => {
		error.value = ''
	}

	const refresh = async (): Promise<boolean> => {
		const revision = ++operationRevision
		busy.value = true
		try {
			const [networks, active] = await Promise.all([listNetworks(), getActiveNetwork()])
			if (revision !== operationRevision) return false
			savedNetworks.value = networks
			session.activeNetwork = active
			return true
		} catch (cause) {
			if (revision === operationRevision) error.value = errorMessage(cause)
			return false
		} finally {
			if (revision === operationRevision) busy.value = false
		}
	}

	const openList = async (): Promise<void> => {
		resetError()
		deleteConfirmationId.value = undefined
		await refresh()
	}

	const openAdd = (): void => {
		resetError()
		editingNetworkId.value = undefined
		form.name = ''
		form.url = ''
		form.mode = 'legacy'
		form.groupId = 'group0'
		form.chainId = 1
		form.isGM = false
		form.billingEnabled = false
		form.balanceDecimals = 18
		form.balanceToken = 'FBT'
	}

	const selectMode = (mode: 'legacy' | 'web3'): void => {
		form.mode = mode
		if (mode === 'web3') form.isGM = false
	}

	const openEdit = (network: NetworkConfig): void => {
		resetError()
		editingNetworkId.value = network.id
		form.name = network.name
		form.url = network.rpcUrl
		form.mode = network.mode === 'web3' ? 'web3' : 'legacy'
		form.groupId = network.groupId ?? 'group0'
		form.chainId = network.chainId
		form.isGM = form.mode === 'legacy' && network.crypto === 'gm'
		form.billingEnabled = network.billingEnabled ?? false
		form.balanceDecimals = network.balanceDecimals ?? 18
		form.balanceToken = network.balanceToken ?? 'FBT'
	}

	const submit = async (): Promise<boolean> => {
		resetError()
		if (!form.name.trim()) {
			error.value = '请输入网络名称'
			return false
		}
		if (!form.url.trim()) {
			error.value = '请输入 RPC URL'
			return false
		}
		if (form.mode === 'legacy' && !form.groupId.trim()) {
			error.value = '请输入群组 ID'
			return false
		}
		if (
			form.mode === 'web3' &&
			(!Number.isSafeInteger(form.chainId) || form.chainId <= 0)
		) {
			error.value = '请输入有效的 Chain ID'
			return false
		}

		const revision = ++operationRevision
		busy.value = true
		try {
			const common = {
				name: form.name,
				url: form.url,
				billingEnabled: form.billingEnabled,
				balanceDecimals: form.balanceDecimals,
				balanceToken: form.balanceToken,
			}
			const input: AddNetworkInput = form.mode === 'web3'
				? {...common, mode: 'web3', chainId: form.chainId, isGM: false}
				: {...common, mode: 'legacy', groupId: form.groupId, isGM: form.isGM}
			if (editingNetworkId.value) {
				await updateNetwork({id: editingNetworkId.value, ...input})
			} else {
				await addNetwork(input)
			}
			if (revision !== operationRevision) return false
			const [networks, active] = await Promise.all([listNetworks(), getActiveNetwork()])
			if (revision !== operationRevision) return false
			savedNetworks.value = networks
			session.activeNetwork = active
			return true
		} catch (cause) {
			if (revision === operationRevision) error.value = errorMessage(cause)
			return false
		} finally {
			if (revision === operationRevision) busy.value = false
		}
	}

	const switchTo = async (id: string): Promise<boolean> => {
		resetError()
		deleteConfirmationId.value = undefined
		const revision = ++operationRevision
		busy.value = true
		try {
			const network = await setActiveNetwork(id)
			if (revision !== operationRevision) return false
			session.activeNetwork = network
			return true
		} catch (cause) {
			if (revision === operationRevision) error.value = errorMessage(cause)
			return false
		} finally {
			if (revision === operationRevision) busy.value = false
		}
	}

	const requestDelete = (network: NetworkConfig): void => {
		resetError()
		if (network.id === session.activeNetwork?.id) {
			error.value = '当前网络不能删除，请先切换到其他网络'
			return
		}
		deleteConfirmationId.value = network.id
	}

	const remove = async (id: string): Promise<boolean> => {
		resetError()
		const revision = ++operationRevision
		busy.value = true
		try {
			const networks = await deleteNetwork(id)
			if (revision !== operationRevision) return false
			savedNetworks.value = networks
			deleteConfirmationId.value = undefined
			return true
		} catch (cause) {
			if (revision === operationRevision) error.value = errorMessage(cause)
			return false
		} finally {
			if (revision === operationRevision) busy.value = false
		}
	}

	const invalidate = (): void => {
		operationRevision += 1
		busy.value = false
		error.value = ''
		editingNetworkId.value = undefined
		deleteConfirmationId.value = undefined
	}

	return {
		savedNetworks,
		busy,
		error,
		editingNetworkId,
		deleteConfirmationId,
		form,
		refresh,
		openList,
		openAdd,
		selectMode,
		openEdit,
		submit,
		switchTo,
		requestDelete,
		remove,
		resetError,
		invalidate,
	}
})
