import {reactive} from 'vue'
import {defineStore} from 'pinia'

type CopyStatus = 'success' | 'error'

export const useClipboardFeedbackStore = defineStore('clipboardFeedback', () => {
	const addressCopyStatus = reactive<Record<string, CopyStatus>>({})
	const timers = new Map<string, number>()
	let revision = 0

	const writeText = async (value: string): Promise<void> => {
		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(value)
				return
			} catch {
				// 浏览器扩展在部分页面会拒绝 Clipboard API，继续尝试无依赖回退。
			}
		}

		const textarea = document.createElement('textarea')
		const activeElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null
		textarea.value = value
		textarea.setAttribute('readonly', '')
		textarea.style.position = 'fixed'
		textarea.style.left = '-9999px'
		textarea.style.opacity = '0'
		document.body.appendChild(textarea)
		textarea.select()
		try {
			if (!document.execCommand('copy')) throw new Error('复制命令不可用')
		} finally {
			textarea.remove()
			activeElement?.focus()
		}
	}

	const copyAddress = async (address: string, key: string): Promise<void> => {
		if (!address) return
		const currentRevision = revision
		const existingTimer = timers.get(key)
		if (existingTimer !== undefined) window.clearTimeout(existingTimer)
		delete addressCopyStatus[key]

		try {
			await writeText(address)
			if (currentRevision !== revision) return
			addressCopyStatus[key] = 'success'
		} catch {
			if (currentRevision !== revision) return
			addressCopyStatus[key] = 'error'
		}

		timers.set(
			key,
			window.setTimeout(() => {
				if (currentRevision !== revision) return
				delete addressCopyStatus[key]
				timers.delete(key)
			}, 1800),
		)
	}

	const addressCopyLabel = (key: string): string => {
		if (addressCopyStatus[key] === 'success') return '已复制'
		if (addressCopyStatus[key] === 'error') return '复制失败'
		return '复制'
	}

	const addressCopyAnnouncement = (key: string): string => {
		if (addressCopyStatus[key] === 'success') return '地址已复制'
		if (addressCopyStatus[key] === 'error') return '地址复制失败，请重试'
		return ''
	}

	const clear = (): void => {
		revision += 1
		for (const key of Object.keys(addressCopyStatus)) delete addressCopyStatus[key]
		for (const timer of timers.values()) window.clearTimeout(timer)
		timers.clear()
	}

	return {
		addressCopyStatus,
		writeText,
		copyAddress,
		addressCopyLabel,
		addressCopyAnnouncement,
		clear,
	}
})
