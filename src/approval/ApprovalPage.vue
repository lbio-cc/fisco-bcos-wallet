<script lang="ts" setup>
import {computed, onBeforeUnmount, onMounted, reactive, ref} from 'vue'
import type {
	ApprovalData,
	ApprovalKind,
	ConnectApprovalData,
	SwitchApprovalData,
	TransactionApprovalData,
} from '@/shared/approvalMessages'
import {getApproval, heartbeatApproval, resolveApproval,} from './approvalClient'
import {readApprovalGate, unlockApprovalGate} from './approvalFlow'
import {getWalletStatus, unlockWallet} from '@/popup/walletClient'

const props = defineProps<{ kind: ApprovalKind }>()
const token = new URLSearchParams(location.search).get('approval') ?? ''
const state = ref<'loading' | 'unlock' | 'unlocking' | 'ready' | 'submitting' | 'error'>('loading')
const data = ref<ApprovalData>()
const error = ref('')
const unlockError = ref('')
const password = ref('')
const selected = ref<number[]>([])
const dataExpanded = ref(false)
const copied = ref(false)
const originCopied = ref(false)
const copyMessage = ref('')
const originMessage = ref('')
const addressCopyStatus = reactive<Record<string, 'success' | 'error'>>({})
const addressCopyTimers = new Map<string, number>()
let heartbeat: number | undefined

const connect = computed(() =>
	data.value?.kind === 'connect' ? (data.value as ConnectApprovalData) : undefined,
)
const transaction = computed(() =>
	data.value?.kind === 'transaction' ? (data.value as TransactionApprovalData) : undefined,
)
const networkSwitch = computed(() =>
	data.value?.kind === 'switch' ? (data.value as SwitchApprovalData) : undefined,
)
const host = computed(() => {
	try {
		return new URL(data.value?.origin ?? '').host
	} catch {
		return data.value?.origin ?? '未知来源'
	}
})
const allSelected = computed(
	() => !!connect.value?.accounts.length && selected.value.length === connect.value.accounts.length,
)
const cryptoLabel = computed(() =>
	data.value?.network.crypto === 'gm' ? '国密 SM2 / SM3' : '标准 secp256k1',
)
const transactionRisk = computed(() => {
	const tx = transaction.value
	if (!tx) return ''
	if (!tx.to) return '这是合约创建交易。部署后的代码与状态更改通常不可逆。'
	if (tx.dataBytes > 1024) return '此交易包含较大的调用数据，请确认来源可信并核对完整内容。'
	if (tx.dataBytes > 0) return '钱包无法确认此合约调用的业务含义，请核对目标地址与调用数据。'
	return ''
})

onMounted(async () => {
	if (!token) return fail('审批链接缺少安全令牌')
	try {
		const approval = await getApproval(token, props.kind)
		if (approval.kind !== props.kind) throw new Error('审批类型不匹配')
		data.value = approval
		if (approval.kind === 'connect') {
			// Explicit product requirement: every candidate account is selected by default.
			selected.value = approval.accounts.map((account) => account.index)
		}
		heartbeat = window.setInterval(() => {
			void heartbeatApproval(token, props.kind).catch(() => fail('审批请求已失效'))
		}, 15_000)
		await continueFromWalletStatus()
	} catch (cause) {
		fail(cause instanceof Error ? cause.message : '无法读取审批请求')
	}
})

onBeforeUnmount(() => {
	if (heartbeat !== undefined) clearInterval(heartbeat)
	for (const timer of addressCopyTimers.values()) window.clearTimeout(timer)
})

const fail = (message: string): void => {
	error.value = message
	state.value = 'error'
	if (heartbeat !== undefined) clearInterval(heartbeat)
}

const continueFromWalletStatus = async (): Promise<void> => {
	const gate = await readApprovalGate(getWalletStatus)
	if (state.value === 'error') return
	if (gate.state === 'error') return fail(gate.message)
	state.value = gate.state
}

const submitUnlock = async (): Promise<void> => {
	if (state.value !== 'unlock' || !password.value) {
		unlockError.value = '请输入钱包密码'
		return
	}
	unlockError.value = ''
	state.value = 'unlocking'
	try {
		const gate = await unlockApprovalGate(password.value, unlockWallet)
		password.value = ''
		if (state.value !== 'unlocking') return
		if (gate.state !== 'ready') {
			throw new Error(
				gate.state === 'error' ? gate.message : '钱包未能成功解锁，请重试',
			)
		}
		state.value = 'ready'
	} catch (cause) {
		password.value = ''
		if (state.value !== 'unlocking') return
		unlockError.value = cause instanceof Error ? cause.message : '解锁失败，请检查密码'
		state.value = 'unlock'
	}
}

const toggleAccount = (index: number): void => {
	selected.value = selected.value.includes(index)
		? selected.value.filter((candidate) => candidate !== index)
		: [...selected.value, index]
}

const toggleAll = (): void => {
	selected.value = allSelected.value ? [] : (connect.value?.accounts.map((a) => a.index) ?? [])
}

const decide = async (approved: boolean): Promise<void> => {
	if (state.value !== 'ready' && !(!approved && state.value === 'unlock')) return
	if (approved && props.kind === 'connect' && !selected.value.length) return
	try {
		if (approved) {
			const gate = await readApprovalGate(getWalletStatus)
			if (state.value !== 'ready') return
			if (gate.state === 'error') return fail(gate.message)
			if (gate.state === 'unlock') {
				password.value = ''
				unlockError.value = '钱包已重新锁定，请解锁后再次确认'
				state.value = 'unlock'
				return
			}
		}
		state.value = 'submitting'
		await resolveApproval(
			token,
			props.kind,
			approved,
			props.kind === 'connect' ? selected.value : undefined,
		)
	} catch (cause) {
		fail(cause instanceof Error ? cause.message : '提交审批结果失败')
	}
}

const copyData = async (): Promise<void> => {
	if (!transaction.value) return
	copyMessage.value = ''
	try {
		await writeClipboardText(transaction.value.data)
		copied.value = true
		copyMessage.value = '完整调用数据已复制。'
		window.setTimeout(() => {
			copied.value = false
			copyMessage.value = ''
		}, 1600)
	} catch {
		copied.value = false
		copyMessage.value = '复制失败，请展开后手动选择完整调用数据。'
	}
}

const writeClipboardText = async (value: string): Promise<void> => {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(value)
			return
		} catch {
			// 扩展页面在部分浏览器中会拒绝 Clipboard API，继续使用无依赖回退。
		}
	}

	const textarea = document.createElement('textarea')
	const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
	const existingTimer = addressCopyTimers.get(key)
	if (existingTimer !== undefined) window.clearTimeout(existingTimer)
	delete addressCopyStatus[key]

	try {
		await writeClipboardText(address)
		addressCopyStatus[key] = 'success'
	} catch {
		addressCopyStatus[key] = 'error'
	}

	addressCopyTimers.set(
		key,
		window.setTimeout(() => {
			delete addressCopyStatus[key]
			addressCopyTimers.delete(key)
		}, 1800),
	)
}

const addressCopyLabel = (key: string): string => {
	if (addressCopyStatus[key] === 'success') return '已复制'
	if (addressCopyStatus[key] === 'error') return '复制失败'
	return '复制地址'
}

const addressCopyAnnouncement = (key: string, label: string): string => {
	if (addressCopyStatus[key] === 'success') return `${label}地址已复制`
	if (addressCopyStatus[key] === 'error') return `${label}地址复制失败，请重试`
	return ''
}

const copyOrigin = async (): Promise<void> => {
	if (!data.value) return
	originMessage.value = ''
	try {
		await writeClipboardText(data.value.origin)
		originCopied.value = true
		originMessage.value = '完整来源地址已复制。'
		window.setTimeout(() => {
			originCopied.value = false
			originMessage.value = ''
		}, 1600)
	} catch {
		originCopied.value = false
		originMessage.value = '复制失败，完整来源地址仍可直接选择。'
	}
}

const closeWindow = (): void => window.close()
</script>

<template>
	<main class="approval-shell">
		<header class="approval-header">
			<img alt="" class="approval-logo" src="/logo.png"/>
			<div>
				<span>{{ kind === 'connect' ? '连接确认' : kind === 'switch' ? '网络切换确认' : '交易确认' }}</span>
			</div>
		</header>

		<section
			v-if="state === 'loading'"
			aria-live="polite"
			class="state-page"
			role="status"
		>
			<i aria-hidden="true" class="spinner"></i>
			<h1>正在读取审批详情</h1>
			<p>请稍候，钱包正在校验请求来源。</p>
		</section>

		<section v-else-if="state === 'error'" class="state-page expired">
			<img alt="" class="state-logo" src="/logo.png"/>
			<h1>无法继续确认</h1>
			<p role="alert">{{ error }}</p>
			<button type="button" @click="closeWindow">关闭窗口</button>
		</section>

		<template v-else-if="data && (state === 'unlock' || state === 'unlocking')">
			<section class="unlock-page">
				<div class="unlock-intro">
					<img alt="" class="unlock-logo" src="/logo.png"/>
					<div>
						<span>钱包已锁定</span>
						<h1>解锁后继续确认</h1>
					</div>
				</div>
				<section class="unlock-request">
					<span>{{ kind === 'connect' ? '请求连接的网站' : kind === 'switch' ? '请求切换网络的网站' : '请求交易的网站' }}</span>
					<strong>{{ host }}</strong>
					<code :title="data.origin">{{ data.origin }}</code>
				</section>
				<form :aria-busy="state === 'unlocking'" @submit.prevent="submitUnlock">
					<label for="approval-password">钱包密码</label>
					<input
						id="approval-password"
						v-model="password"
						:disabled="state === 'unlocking'"
						autocomplete="current-password"
						autofocus
						placeholder="请输入钱包密码"
						type="password"
					/>
					<p v-if="unlockError" class="unlock-error" role="alert">{{ unlockError }}</p>
					<p aria-live="polite" class="async-status" role="status">
						{{ state === 'unlocking' ? '正在解锁，请稍候' : '' }}
					</p>
					<button :disabled="state === 'unlocking' || !password" type="submit">
						{{ state === 'unlocking' ? '正在解锁…' : '解锁并继续' }}
					</button>
				</form>
				<p class="unlock-note">解锁仅用于验证身份，不会自动批准。</p>
			</section>
			<footer class="approval-actions unlock-actions">
				<button :disabled="state === 'unlocking'" type="button" @click="decide(false)">拒绝请求</button>
			</footer>
		</template>

		<template v-else-if="data">
			<section class="approval-content">
				<div class="request-kind">
					<span>{{ kind === 'connect' ? '网站请求访问账户' : kind === 'switch' ? '网站请求切换网络' : '网站请求签名并发送交易' }}</span>
					<b>{{ kind === 'connect' ? '账户权限' : kind === 'switch' ? '全局网络变更' : '请谨慎确认' }}</b>
				</div>
				<section class="origin-strip">
					<i aria-hidden="true"></i>
					<div>
						<strong>{{ host }}</strong>
						<code :title="data.origin">{{ data.origin }}</code>
						<span aria-live="polite" class="copy-status origin-status" role="status">{{
								originMessage
							}}</span>
					</div>
					<button :aria-label="`复制完整来源地址 ${data.origin}`" type="button" @click="copyOrigin">
						{{ originCopied ? '已复制' : '复制' }}
					</button>
				</section>

				<section class="network-summary">
					<p>{{ networkSwitch ? '目标网络' : '当前网络' }}</p>
					<strong>{{ data.network.name }}</strong>
					<dl>
						<div v-if="data.network.groupId">
							<dt>群组</dt>
							<dd>{{ data.network.groupId }}</dd>
						</div>
						<div v-else>
							<dt>Chain ID</dt>
							<dd>{{ data.network.chainId }}</dd>
						</div>
						<div>
							<dt>密码体系</dt>
							<dd>{{ cryptoLabel }}</dd>
						</div>
					</dl>
				</section>

				<template v-if="networkSwitch">
					<p class="risk-note"><b>切换会影响所有网站</b>批准后，钱包当前网络将从 {{ networkSwitch.currentNetwork.name }} 切换到 {{ networkSwitch.network.name }}。</p>
					<section class="chain-details">
						<div><span>切换类型</span><code>{{ networkSwitch.requestType === 'group' ? 'FISCO BCOS 群组' : 'Chain ID' }}</code></div>
						<div><span>当前网络</span><code>{{ networkSwitch.currentNetwork.name }} · {{ networkSwitch.currentNetwork.groupId ?? `Chain ${networkSwitch.currentNetwork.chainId}` }}</code></div>
						<div><span>目标网络</span><code>{{ networkSwitch.network.name }} · {{ networkSwitch.network.groupId ?? `Chain ${networkSwitch.network.chainId}` }}</code></div>
					</section>
				</template>

				<template v-if="connect">
					<div class="section-heading">
						<div><span>允许访问的账户</span><small>已选 {{ selected.length }} / {{
								connect.accounts.length
							}}</small></div>
						<button type="button" @click="toggleAll">{{ allSelected ? '取消全选' : '全选' }}</button>
					</div>
					<div class="account-options">
						<div
							v-for="account in connect.accounts"
							:key="account.index"
							:class="{ selected: selected.includes(account.index) }"
							class="account-option"
						>
							<label>
								<input
									:checked="selected.includes(account.index)"
									type="checkbox"
									@change="toggleAccount(account.index)"
								/>
								<span aria-hidden="true" class="checkmark"></span>
								<span>
                  <strong>{{ account.name }}</strong>
                  <small v-if="account.remark">{{ account.remark }}</small>
                  <code>{{ account.address }}</code>
                </span>
							</label>
							<div class="address-copy-row">
                <span aria-live="polite" role="status">
                  {{
		                addressCopyAnnouncement(
			                `connect-${account.index}`,
			                `${account.name}的`,
		                )
	                }}
                </span>
								<button
									:aria-label="`复制${account.name}的完整地址`"
									type="button"
									@click="copyAddress(account.address, `connect-${account.index}`)"
								>
									{{ addressCopyLabel(`connect-${account.index}`) }}
								</button>
							</div>
						</div>
					</div>
					<p v-if="!selected.length" class="selection-warning">至少选择一个账户才能批准连接。</p>
					<p class="permission-note">网站只能查看所选账户地址。你可以随时在钱包首页撤销授权。</p>
				</template>

				<template v-if="transaction">
					<p v-if="transactionRisk" class="risk-note"><b>请谨慎核对</b>{{ transactionRisk }}</p>
					<section class="transaction-card">
						<header><span>签名账户</span><b>{{ transaction.account?.name ?? '钱包账户' }}<small
							v-if="transaction.account"> #{{ transaction.account.index }}</small></b></header>
						<dl>
							<div>
								<dt>发送方</dt>
								<dd class="transaction-address">
									<code>{{ transaction.from }}</code>
									<span aria-live="polite" role="status">
                    {{ addressCopyAnnouncement('transaction-from', '发送方') }}
                  </span>
									<button
										:aria-label="`复制完整发送方地址 ${transaction.from}`"
										type="button"
										@click="copyAddress(transaction.from, 'transaction-from')"
									>
										{{ addressCopyLabel('transaction-from') }}
									</button>
								</dd>
							</div>
							<div>
								<dt>接收方</dt>
								<dd v-if="transaction.to" class="transaction-address">
									<code>{{ transaction.to }}</code>
									<span aria-live="polite" role="status">
                    {{ addressCopyAnnouncement('transaction-to', '接收方') }}
                  </span>
									<button
										:aria-label="`复制完整接收方地址 ${transaction.to}`"
										type="button"
										@click="copyAddress(transaction.to, 'transaction-to')"
									>
										{{ addressCopyLabel('transaction-to') }}
									</button>
								</dd>
								<dd v-else>创建合约</dd>
							</div>
							<div>
								<dt>金额</dt>
								<dd>{{ transaction.value }} <small>FISCO V0 · 必须为 0</small></dd>
							</div>
						</dl>
					</section>
					<section class="technical-card">
						<header>
							<div><span>调用数据</span><small>{{ transaction.dataBytes }} 字节
								<template v-if="transaction.selector">· {{ transaction.selector }}</template>
							</small></div>
							<button type="button" @click="dataExpanded = !dataExpanded">{{
									dataExpanded ? '收起' : '展开'
								}}
							</button>
						</header>
						<code :class="{ expanded: dataExpanded }">{{ transaction.data }}</code>
						<button class="copy-button" type="button" @click="copyData">{{
								copied ? '已复制' : '复制完整数据'
							}}
						</button>
						<p
							v-if="copyMessage"
							aria-live="polite"
							class="copy-status data-copy-status"
							role="status"
						>
							{{ copyMessage }}
						</p>
					</section>
					<section class="chain-details">
						<div><span>RPC</span><code>{{ transaction.network.rpcUrl }}</code></div>
						<div><span>链标识</span><code>{{ transaction.network.chainId }} /
							{{ transaction.network.metadataChainId }}</code></div>
					</section>
				</template>
			</section>

			<footer class="approval-actions">
				<button :disabled="state === 'submitting'" type="button" @click="decide(false)">拒绝</button>
				<button
					:disabled="state === 'submitting' || (kind === 'connect' && !selected.length)"
					class="approve"
					type="button"
					@click="decide(true)"
				>
					{{ state === 'submitting' ? '正在提交…' : kind === 'connect' ? '批准连接' : kind === 'switch' ? '允许切换' : '批准并签名' }}
				</button>
			</footer>
		</template>
	</main>
</template>
