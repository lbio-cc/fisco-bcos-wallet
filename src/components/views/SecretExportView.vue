<script lang="ts" setup>
import {computed, onBeforeUnmount, ref, watch} from 'vue'
import {exportMnemonic, exportPrivateKey} from '@/popup/walletClient'
import {useClipboardFeedbackStore} from '@/stores/clipboardFeedback'
import {useWalletSessionStore} from '@/stores/walletSession'
import {useWalletUiStore} from '@/stores/walletUi'

const clipboard = useClipboardFeedbackStore()
const walletSession = useWalletSessionStore()
const walletUi = useWalletUiStore()
const riskAccepted = ref(false)
const password = ref('')
const exportedSecret = ref('')
const copyStatus = ref<'idle' | 'success' | 'error'>('idle')
const busy = ref(false)
const error = ref('')
let revision = 0

const mode = computed(() => walletUi.secretExportRequest?.mode ?? 'mnemonic')
const account = computed(() =>
	walletSession.summary?.accounts.find(
		(candidate) => candidate.index === walletUi.secretExportRequest?.accountIndex,
	),
)
const exportedMnemonicWords = computed(() =>
	mode.value === 'mnemonic'
		? exportedSecret.value.split(/\s+/).filter(Boolean)
		: [],
)

const clear = (): void => {
	revision += 1
	riskAccepted.value = false
	password.value = ''
	exportedSecret.value = ''
	copyStatus.value = 'idle'
	busy.value = false
	error.value = ''
}

const close = (): void => {
	clear()
	walletUi.closeSecretExport()
}

const submit = async (): Promise<void> => {
	error.value = ''
	if (!riskAccepted.value || !password.value) return
	if (mode.value === 'private-key' && !account.value) {
		error.value = '未找到需要导出私钥的账户'
		return
	}

	const currentRevision = ++revision
	const submittedPassword = password.value
	busy.value = true
	try {
		const response =
			mode.value === 'mnemonic'
				? await exportMnemonic({
					password: submittedPassword,
					riskAccepted: true,
				})
				: await exportPrivateKey({
					accountIndex: account.value!.index,
					password: submittedPassword,
					riskAccepted: true,
				})
		if (currentRevision !== revision) return
		exportedSecret.value =
			'mnemonic' in response ? response.mnemonic : response.privateKey
		password.value = ''
		copyStatus.value = 'idle'
	} catch (cause) {
		if (currentRevision === revision) {
			password.value = ''
			error.value = cause instanceof Error ? cause.message : '导出失败，请重试'
		}
	} finally {
		if (currentRevision === revision) busy.value = false
	}
}

const copy = async (): Promise<void> => {
	if (!exportedSecret.value) return
	const currentRevision = revision
	try {
		await clipboard.writeText(exportedSecret.value)
		if (currentRevision === revision) copyStatus.value = 'success'
	} catch {
		if (currentRevision === revision) copyStatus.value = 'error'
	}
}

watch(
	() => walletUi.sensitiveStateRevision,
	() => clear(),
	{flush: 'sync'},
)

onBeforeUnmount(clear)
</script>

<template>
	<section class="secret-export-page">
		<button class="back" type="button" @click="close">← 返回</button>
		<p class="eyebrow">安全检查点</p>
		<h1>{{ mode === 'mnemonic' ? '导出助记词' : '导出私钥' }}</h1>
		<p class="secret-warning" role="alert">
			<strong>任何获得此密钥的人都能控制你的资产。</strong>
			请勿截图、上传云端、粘贴到任何网站，或通过聊天工具发送给他人。
		</p>

		<dl v-if="mode === 'private-key' && account" class="secret-account">
			<div>
				<dt>账户</dt>
				<dd>{{ account.name }}</dd>
			</div>
			<div>
				<dt>派生路径</dt>
				<dd>
					<code>{{ account.derivationPath }}</code>
				</dd>
			</div>
			<div>
				<dt>当前网络地址</dt>
				<dd>
					<code>{{ walletSession.accountAddress(account) || '当前群组暂无地址' }}</code>
				</dd>
			</div>
		</dl>

		<div v-if="exportedSecret" aria-label="临时显示的敏感信息" class="secret-reveal">
			<header>
				<div>
					<small>仅在本机临时显示</small>
					<strong>{{ mode === 'mnemonic' ? '恢复助记词' : '账户私钥' }}</strong>
				</div>
				<span>离开后清除</span>
			</header>
			<ol v-if="mode === 'mnemonic'" class="export-word-grid">
				<li v-for="(word, index) in exportedMnemonicWords" :key="index">
          <span>{{ index + 1 }}</span
          ><b>{{ word }}</b>
				</li>
			</ol>
			<code v-else class="private-key-field">{{ exportedSecret }}</code>
			<div class="secret-actions">
				<button class="secondary" type="button" @click="copy">
					{{
						copyStatus === 'success'
							? '已复制'
							: copyStatus === 'error'
								? '复制失败，请重试'
								: '复制'
					}}
				</button>
				<button class="danger-button" type="button" @click="close">完成并清除</button>
			</div>
			<span aria-atomic="true" aria-live="polite" class="visually-hidden" role="status">
        {{
					copyStatus === 'success'
						? '敏感信息已复制，请妥善保管'
						: copyStatus === 'error'
							? '复制失败，请重试'
							: ''
				}}
      </span>
		</div>

		<form v-else @submit.prevent="submit">
			<label class="risk-consent">
				<input v-model="riskAccepted" type="checkbox"/>
				<span>我已了解泄露风险，并确认当前环境安全、周围无人窥视。<small>导出内容不会由钱包保存。</small></span>
			</label>
			<label>
				钱包密码
				<input
					v-model="password"
					autocomplete="current-password"
					placeholder="输入密码以验证身份"
					type="password"
				/>
			</label>
			<p v-if="error" class="error">{{ error }}</p>
			<button :disabled="busy || !riskAccepted || !password" class="danger-button" type="submit">
				{{ busy ? '正在验证…' : mode === 'mnemonic' ? '验证并显示助记词' : '验证并显示私钥' }}
			</button>
		</form>
	</section>
</template>

<style lang="scss" scoped>
.secret-export-page {
	max-width: 620px;
	margin-inline: auto;

	h1 {
		font-size: 25px;
	}
}

.secret-warning {
	margin: 18px 0;
	padding: 14px;
	border-left: 4px solid #b8564b;
	border-radius: 10px;
	color: #7d3c34;
	background: #faece9;
	font-size: 12px;
	line-height: 1.65;

	strong {
		display: block;
		margin-bottom: 3px;
		color: #8c332b;
	}
}

.secret-account {
	margin: 0 0 18px;
	padding: 5px 13px;
	border: 1px solid #e0e7e3;
	border-radius: 12px;
	background: #fff;

	> div {
		min-width: 0;
		padding: 9px 0;

		+ div {
			border-top: 1px solid #edf1ef;
		}
	}

	dt {
		margin-bottom: 4px;
		color: #74807b;
		font-size: 10px;
		font-weight: 700;
	}

	dd {
		min-width: 0;
		margin: 0;
		color: #26332e;
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	code {
		font: 600 10px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
	}
}

.risk-consent {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 13px;
	border: 1px solid #e5c9a0;
	border-radius: 10px;
	color: #5f4920;
	background: #fff8e7;
	line-height: 1.55;

	input {
		width: 16px;
		min-height: 16px;
		margin-top: 2px;
		padding: 0;
		accent-color: #a4473e;
	}

	small {
		display: block;
		margin-top: 3px;
		color: #806b42;
	}
}

.secret-reveal {
	margin-top: 20px;
	padding: 14px;
	border: 1px solid #d5b266;
	border-top: 4px solid #b8564b;
	border-radius: 12px;
	background: #fffaf0;
	box-shadow: 0 10px 28px rgba(94, 64, 23, 0.08);

	> header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 13px;
	}

	header div {
		display: grid;
		gap: 2px;
	}

	header small {
		color: #8b6a2d;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	header strong {
		color: #352b19;
		font-size: 14px;
	}

	header > span {
		padding: 4px 6px;
		border-radius: 6px;
		color: #943c33;
		background: #fae8e5;
		font-size: 10px;
		font-weight: 700;
		white-space: nowrap;
	}
}

.export-word-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 7px;
	margin: 0;
	padding: 0;
	list-style: none;

	li {
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 7px;
		padding: 9px 8px;
		border: 1px solid #eadfc7;
		border-radius: 7px;
		background: #fff;
	}

	span {
		flex: 0 0 16px;
		color: #aa8b50;
		font: 600 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
		text-align: right;
	}

	b {
		min-width: 0;
		color: #30291d;
		font: 650 11px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
		overflow-wrap: anywhere;
	}
}

.private-key-field {
	display: block;
	padding: 13px;
	border: 1px solid #eadfc7;
	border-radius: 8px;
	color: #30291d;
	background: #fff;
	font: 650 11px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
	overflow-wrap: anywhere;
	user-select: all;
}

.secret-actions {
	display: grid;
	grid-template-columns: 0.8fr 1.2fr;
	gap: 9px;
	margin-top: 13px;

	.secondary {
		margin-top: 0;
	}
}

@media (max-width: 359px) {

	.export-word-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
