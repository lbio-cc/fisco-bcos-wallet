import {computed, inject, type InjectionKey, onBeforeUnmount, onMounted, provide, ref,} from 'vue'
import {storeToRefs} from 'pinia'
import type {WalletCreationResult, WalletStatus} from '@/core/wallet/types'
import {
  confirmMnemonicBackup,
  createMnemonicWallet,
  createWalletStatusSynchronizer,
  getWalletStatus,
  lockWallet,
  resetWallet,
  restoreMnemonicWallet,
  unlockWallet,
  type WalletStatusSynchronizer,
} from '@/popup/walletClient'
import {subscribeToTransactionActivities} from '@/popup/walletHomeClient'
import {planWalletStatusTransition} from '@/popup/walletStatusTransition'
import {createWalletUiActionEpoch} from '@/popup/walletUiActionEpoch'
import {subscribeToAssets} from '@/popup/assetClient'
import type {CreateWalletForm, RestoreWalletForm,} from '@/components/views/walletAccessTypes'
import {useAccountManagementStore} from '@/stores/accountManagement'
import {useAssetTrackingStore} from '@/stores/assetTracking'
import {useClipboardFeedbackStore} from '@/stores/clipboardFeedback'
import {useNetworkManagementStore} from '@/stores/networkManagement'
import {useWalletHomeStore} from '@/stores/walletHome'
import {useWalletSessionStore} from '@/stores/walletSession'
import {isWalletAccessView, useWalletUiStore} from '@/stores/walletUi'

const createWalletController = () => {
	let unsubscribeHomeActivities: (() => void) | undefined
	let unsubscribeAssets: (() => void) | undefined
	let walletStatusSynchronizer: WalletStatusSynchronizer | undefined
	const uiActionEpoch = createWalletUiActionEpoch()
	const result = ref<WalletCreationResult>()
	const confirmPositions = ref<number[]>([])
	const walletSession = useWalletSessionStore()
	const accountManagement = useAccountManagementStore()
	const networkManagement = useNetworkManagementStore()
	const clipboard = useClipboardFeedbackStore()
	const walletHome = useWalletHomeStore()
	const assetTracking = useAssetTrackingStore()
	const walletUi = useWalletUiStore()
	const {view, busy, error} = storeToRefs(walletUi)
	const {summary} = storeToRefs(walletSession)

	const mnemonicWords = computed(
		() => result.value?.mnemonic.split(' ').filter(Boolean) ?? [],
	)
	const accessView = computed(() =>
		isWalletAccessView(view.value) ? view.value : undefined,
	)

	const refreshAssets = (): Promise<void> => assetTracking.refresh()
	const refreshHome = (isCurrent: () => boolean = () => true): Promise<void> => {
		const actionEpoch = uiActionEpoch.capture()
		return walletHome.refresh(
			() => uiActionEpoch.isCurrent(actionEpoch) && isCurrent(),
		)
	}

	const clearSensitiveState = (): void => {
		walletUi.invalidateSensitiveState()
		walletUi.cancelSecretExport()
		result.value = undefined
		confirmPositions.value = []
		clipboard.clear()
		error.value = ''
	}

	const closeTransientUi = (): void => {
		networkManagement.invalidate()
		accountManagement.invalidate()
		assetTracking.invalidate()
	}

	const applyWalletStatus = async (
		status: WalletStatus,
		isCurrent: () => boolean = () => true,
	): Promise<void> => {
		const transition = planWalletStatusTransition(status, view.value)
		if (!status.initialized || status.locked) uiActionEpoch.invalidate()
		if (!status.initialized) summary.value = undefined
		if (status.summary) summary.value = status.summary
		if (transition.clearSensitive) clearSensitiveState()
		if (transition.closeTransientUi) closeTransientUi()
		if (transition.stopBusy) busy.value = false
		if (transition.clearHome) {
			busy.value = false
			walletHome.clear()
		}
		walletUi.navigate(transition.targetView)
		if (transition.refreshHome) {
			error.value = ''
			await Promise.all([refreshHome(isCurrent), refreshAssets()])
		}
	}

	onMounted(async () => {
		const actionEpoch = uiActionEpoch.capture()
		walletStatusSynchronizer = createWalletStatusSynchronizer(
			getWalletStatus,
			applyWalletStatus,
			(event) => {
				if (!event.status.initialized || event.status.locked) {
					uiActionEpoch.invalidate()
					walletUi.invalidateSensitiveState()
					accountManagement.invalidate()
					networkManagement.invalidate()
				}
			},
		)
		try {
			if (!(await networkManagement.refresh())) {
				throw new Error(networkManagement.error || '读取网络配置失败')
			}
			if (!uiActionEpoch.isCurrent(actionEpoch)) return
			await walletStatusSynchronizer.refresh()
		} catch (cause) {
			if (!uiActionEpoch.isCurrent(actionEpoch)) return
			walletUi.navigate('welcome')
			console.error('钱包初始化失败', cause)
			error.value = '钱包暂时无法启动，请确认已在浏览器扩展中打开后重试'
		}
	})

	onMounted(() => {
		unsubscribeHomeActivities = subscribeToTransactionActivities(() => {
			if (view.value === 'done') void refreshHome()
		})
		unsubscribeAssets = subscribeToAssets(() => {
			if (view.value === 'done') void refreshAssets()
		})
	})

	onBeforeUnmount(() => {
		unsubscribeHomeActivities?.()
		unsubscribeAssets?.()
		walletStatusSynchronizer?.dispose()
		clipboard.clear()
	})

	const setError = (cause: unknown): void => {
		error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
	}

	const resetError = (): void => {
		error.value = ''
	}

	const validatePassword = (password: string, confirmation: string): boolean => {
		if (password.length < 10) {
			error.value = '钱包密码至少需要 10 个字符'
			return false
		}
		if (password !== confirmation) {
			error.value = '两次输入的密码不一致'
			return false
		}
		return true
	}

	const chooseConfirmPositions = (wordCount: number): void => {
		const positions = new Set<number>()
		const random = new Uint32Array(1)
		while (positions.size < 3) {
			crypto.getRandomValues(random)
			positions.add((random[0]! % wordCount) + 1)
		}
		confirmPositions.value = [...positions].sort((a, b) => a - b)
	}

	const submitCreate = async (createForm: CreateWalletForm): Promise<void> => {
		resetError()
		if (!createForm.name.trim()) return void (error.value = '请输入钱包名称')
		if (!validatePassword(createForm.password, createForm.passwordConfirm)) return
		const actionEpoch = uiActionEpoch.capture()
		busy.value = true
		try {
			const creation = await createMnemonicWallet({
				name: createForm.name,
				wordCount: createForm.wordCount,
				password: createForm.password,
			})
			if (!uiActionEpoch.isCurrent(actionEpoch)) return
			result.value = creation
			summary.value = result.value.summary
			chooseConfirmPositions(mnemonicWords.value.length)
			walletUi.navigate('backup')
		} catch (cause) {
			if (uiActionEpoch.isCurrent(actionEpoch)) setError(cause)
		} finally {
			if (uiActionEpoch.isCurrent(actionEpoch)) busy.value = false
		}
	}

	const submitRestore = async (restoreForm: RestoreWalletForm): Promise<void> => {
		resetError()
		if (!restoreForm.name.trim()) return void (error.value = '请输入钱包名称')
		if (!restoreForm.mnemonic.trim()) return void (error.value = '请输入助记词')
		if (!validatePassword(restoreForm.password, restoreForm.passwordConfirm)) return
		const actionEpoch = uiActionEpoch.capture()
		busy.value = true
		try {
			const restoration = await restoreMnemonicWallet({
				name: restoreForm.name,
				mnemonic: restoreForm.mnemonic,
				password: restoreForm.password,
			})
			if (!uiActionEpoch.isCurrent(actionEpoch)) return
			summary.value = restoration.summary
			walletUi.navigate('done')
			await refreshHome(() => uiActionEpoch.isCurrent(actionEpoch))
		} catch (cause) {
			if (uiActionEpoch.isCurrent(actionEpoch)) setError(cause)
		} finally {
			if (uiActionEpoch.isCurrent(actionEpoch)) busy.value = false
		}
	}

	const submitConfirmation = async (
		confirmAnswers: Record<number, string>,
	): Promise<void> => {
		resetError()
		const words = mnemonicWords.value
		const correct = confirmPositions.value.every(
			(position) =>
				confirmAnswers[position]?.trim().toLowerCase() === words[position - 1],
		)
		if (!correct) {
			error.value = '助记词校验未通过，请检查单词和位置'
			return
		}
		const actionEpoch = uiActionEpoch.capture()
		busy.value = true
		try {
			const confirmedSummary = await confirmMnemonicBackup()
			if (!uiActionEpoch.isCurrent(actionEpoch)) return
			summary.value = confirmedSummary
			result.value = undefined
			walletUi.navigate('done')
			await refreshHome(() => uiActionEpoch.isCurrent(actionEpoch))
		} catch (cause) {
			if (uiActionEpoch.isCurrent(actionEpoch)) setError(cause)
		} finally {
			if (uiActionEpoch.isCurrent(actionEpoch)) busy.value = false
		}
	}

	const submitUnlock = async (unlockPassword: string): Promise<void> => {
		resetError()
		if (!unlockPassword) return void (error.value = '请输入钱包密码')
		const actionEpoch = uiActionEpoch.capture()
		busy.value = true
		try {
			const status = await unlockWallet({password: unlockPassword})
			if (!uiActionEpoch.isCurrent(actionEpoch)) return
			if (walletStatusSynchronizer) await walletStatusSynchronizer.refresh()
			else await applyWalletStatus(status)
		} catch (cause) {
			if (uiActionEpoch.isCurrent(actionEpoch)) setError(cause)
		} finally {
			if (uiActionEpoch.isCurrent(actionEpoch)) busy.value = false
		}
	}

	const lock = async (): Promise<void> => {
		resetError()
		const actionEpoch = uiActionEpoch.capture()
		busy.value = true
		try {
			const status = await lockWallet()
			if (walletStatusSynchronizer) await walletStatusSynchronizer.refresh()
			else await applyWalletStatus(status)
		} catch (cause) {
			if (uiActionEpoch.isCurrent(actionEpoch)) setError(cause)
		} finally {
			if (uiActionEpoch.isCurrent(actionEpoch)) busy.value = false
		}
	}

	const submitReset = async (resetConfirmation: string): Promise<void> => {
		resetError()
		if (resetConfirmation.trim() !== '重置钱包') {
			error.value = '请输入“重置钱包”以确认永久删除'
			return
		}
		const actionEpoch = uiActionEpoch.capture()
		busy.value = true
		try {
			const status = await resetWallet({confirmation: resetConfirmation})
			if (walletStatusSynchronizer) await walletStatusSynchronizer.refresh()
			else await applyWalletStatus(status)
		} catch (cause) {
			if (uiActionEpoch.isCurrent(actionEpoch)) setError(cause)
		} finally {
			if (uiActionEpoch.isCurrent(actionEpoch)) busy.value = false
		}
	}

	return {
		expanded: walletUi.expanded,
		view,
		accessView,
		mnemonicWords,
		confirmPositions,
		submitCreate,
		submitRestore,
		submitConfirmation,
		submitUnlock,
		submitReset,
		lock,
	}
}

export type WalletController = ReturnType<typeof createWalletController>

const walletControllerKey: InjectionKey<WalletController> = Symbol('walletController')

export const provideWalletController = (): WalletController => {
	const controller = createWalletController()
	provide(walletControllerKey, controller)
	return controller
}

export const useWalletController = (): WalletController => {
	const controller = inject(walletControllerKey)
	if (!controller) throw new Error('WalletController 尚未初始化')
	return controller
}
