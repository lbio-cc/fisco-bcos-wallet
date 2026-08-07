import {reactive, ref} from 'vue'
import {defineStore} from 'pinia'
import type {WalletAccountSummary} from '@/core/wallet/types'
import {addDerivedAccount, deleteAccount, selectAccount, updateAccount,} from '@/popup/walletClient'
import {useWalletSessionStore} from '@/stores/walletSession'

const errorMessage = (cause: unknown): string =>
	cause instanceof Error ? cause.message : '账户操作失败'

export const useAccountManagementStore = defineStore('accountManagement', () => {
	const session = useWalletSessionStore()
	const busy = ref(false)
	const error = ref('')
	const editingAccountIndex = ref<number>()
	const deleteAccountIndex = ref<number>()
	const form = reactive({
		name: '',
		remark: '',
	})
	let operationRevision = 0

	const resetError = (): void => {
		error.value = ''
	}

	const openList = (): void => {
		resetError()
		deleteAccountIndex.value = undefined
	}

	const openAdd = (): void => {
		resetError()
		editingAccountIndex.value = undefined
		form.name = `账户 ${(session.summary?.accounts.length ?? 0) + 1}`
		form.remark = ''
	}

	const openEdit = (account: WalletAccountSummary): void => {
		resetError()
		editingAccountIndex.value = account.index
		form.name = account.name
		form.remark = account.remark
	}

	const submit = async (): Promise<boolean> => {
		resetError()
		if (!form.name.trim()) {
			error.value = '请输入账户名称'
			return false
		}

		const revision = ++operationRevision
		busy.value = true
		try {
			const updatedSummary =
				editingAccountIndex.value === undefined
					? await addDerivedAccount(form)
					: await updateAccount({
						index: editingAccountIndex.value,
						name: form.name,
						remark: form.remark,
					})
			if (revision !== operationRevision) return false
			session.summary = updatedSummary
			return true
		} catch (cause) {
			if (revision === operationRevision) error.value = errorMessage(cause)
			return false
		} finally {
			if (revision === operationRevision) busy.value = false
		}
	}

	const switchTo = async (index: number): Promise<boolean> => {
		resetError()
		const revision = ++operationRevision
		busy.value = true
		try {
			const selectedSummary = await selectAccount({index})
			if (revision !== operationRevision) return false
			session.summary = selectedSummary
			deleteAccountIndex.value = undefined
			return true
		} catch (cause) {
			if (revision === operationRevision) error.value = errorMessage(cause)
			return false
		} finally {
			if (revision === operationRevision) busy.value = false
		}
	}

	const remove = async (index: number): Promise<boolean> => {
		resetError()
		const revision = ++operationRevision
		busy.value = true
		try {
			const updatedSummary = await deleteAccount({index})
			if (revision !== operationRevision) return false
			session.summary = updatedSummary
			deleteAccountIndex.value = undefined
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
		editingAccountIndex.value = undefined
		deleteAccountIndex.value = undefined
	}

	return {
		busy,
		error,
		editingAccountIndex,
		deleteAccountIndex,
		form,
		openList,
		openAdd,
		openEdit,
		submit,
		switchTo,
		remove,
		resetError,
		invalidate,
	}
})
