<script setup lang="ts">
import {computed, nextTick, onMounted, ref} from 'vue'
import {storeToRefs} from 'pinia'
import {effectiveAssetName, effectiveAssetSymbol, resolveAssetChainKey, type TrackedAsset} from '@/shared/assetMessages'
import {useAssetTrackingStore} from '@/stores/assetTracking'

const emit = defineEmits<{close: []}>()
const store = useAssetTrackingStore()
const {snapshot, contract, action, error, removeContract, cacheUsage} = storeToRefs(store)
const dialog = ref<HTMLElement>()
const contractInput = ref<HTMLInputElement>()
const editContract = ref('')
const customName = ref('')
const customSymbol = ref('')
const aggregateMessage = ref('')

const busy = computed(() => !!action.value)

const close = (): void => {
	if (!busy.value) emit('close')
}

const assetKey = (asset: TrackedAsset): string => resolveAssetChainKey(asset) ?? ''

const submitAsset = async (): Promise<void> => {
	if (await store.add()) {
		contract.value = ''
		aggregateMessage.value = '资产已添加并完成首次刷新'
	}
}

const startEdit = (asset: TrackedAsset): void => {
	editContract.value = asset.contract
	customName.value = asset.customName ?? ''
	customSymbol.value = asset.customSymbol ?? ''
	error.value = ''
}

const saveEdit = async (asset: TrackedAsset): Promise<void> => {
	const success = await store.runAction('update', asset.contract, assetKey(asset), {
		customName: customName.value,
		customSymbol: customSymbol.value,
	})
	if (success) {
		editContract.value = ''
		aggregateMessage.value = '显示信息已更新'
	}
}

const run = async (kind: 'refresh' | 'remove', asset: TrackedAsset): Promise<void> => {
	const success = await store.runAction(kind, asset.contract, assetKey(asset))
	if (success) aggregateMessage.value = kind === 'remove' ? '资产已移除' : '刷新完成'
}

const refreshAll = async (): Promise<void> => {
	let failed = 0
	let completed = 0
	for (const asset of [...snapshot.value.assets]) {
		if (await store.runAction('refresh', asset.contract, assetKey(asset))) completed += 1
		else failed += 1
	}
	aggregateMessage.value = failed
		? `已刷新 ${completed} 项，${failed} 项失败：${error.value}`
		: `已刷新全部 ${completed} 项资产`
}

const statusText = (asset: TrackedAsset & {snapshot?: {refreshState: string; lastSuccessfulRefresh?: number; lastError?: string}}): string => {
	if (asset.snapshot?.refreshState === 'refreshing') return '刷新中'
	if (asset.snapshot?.refreshState === 'error') return asset.snapshot.lastError || '刷新失败'
	if (!asset.snapshot?.lastSuccessfulRefresh) return '尚未刷新'
	return `成功于 ${new Intl.DateTimeFormat('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(asset.snapshot.lastSuccessfulRefresh)}`
}

const keydown = (event: KeyboardEvent): void => {
	if (event.key === 'Escape') {
		event.preventDefault()
		close()
		return
	}
	if (event.key !== 'Tab' || !dialog.value) return
	const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
	if (!focusable.length) return
	const first = focusable[0]!
	const last = focusable[focusable.length - 1]!
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault()
		last.focus()
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault()
		first.focus()
	}
}

onMounted(() => {
	error.value = ''
	void nextTick(() => contractInput.value?.focus())
})
</script>

<template>
	<div class="asset-manager-backdrop" @mousedown.self="close">
		<section
			ref="dialog"
			aria-labelledby="asset-manager-title"
			aria-modal="true"
			class="asset-manager"
			role="dialog"
			@keydown="keydown"
		>
			<header class="manager-head">
				<div>
					<small>{{ snapshot.networkName ?? '当前网络' }}</small>
					<h2 id="asset-manager-title">管理</h2>
				</div>
				<button :disabled="busy" aria-label="关闭资产管理" type="button" @click="close">×</button>
			</header>

			<div class="manager-scroll">
				<form class="manager-add" @submit.prevent="submitAsset">
					<label for="managed-asset-contract">添加合约资产</label>
					<div>
						<input
							id="managed-asset-contract"
							ref="contractInput"
							v-model="contract"
							:disabled="busy"
							autocomplete="off"
							placeholder="0x…"
							spellcheck="false"
						/>
						<button :disabled="busy || !contract.trim()" class="primary" type="submit">
							{{ action === 'add' ? '验证中…' : '添加' }}
						</button>
					</div>
					<small>仅支持 ERC20 或 Enumerable ERC721合约。</small>
				</form>

				<div class="manager-summary">
					<span>{{ snapshot.assets.length }} 项资产</span>
					<button :disabled="busy || !snapshot.assets.length" type="button" @click="refreshAll">
						{{ busy ? '处理中…' : '刷新全部' }}
					</button>
				</div>

				<p v-if="error" class="manager-message error" role="alert">{{ error }}</p>
				<p v-else-if="aggregateMessage" class="manager-message" role="status">{{ aggregateMessage }}</p>

				<div v-if="!snapshot.assets.length" class="manager-empty">暂无跟踪资产，请在上方粘贴合约地址。</div>
				<ul v-else class="managed-list">
					<li v-for="asset in snapshot.assets" :key="`${assetKey(asset)}:${asset.contract}`">
						<div class="managed-title">
							<span>{{ effectiveAssetSymbol(asset).slice(0, 2).toUpperCase() || '?' }}</span>
							<div>
								<strong>{{ effectiveAssetName(asset) }}</strong>
								<small>{{ asset.kind.toUpperCase() }} · {{ effectiveAssetSymbol(asset) }} · {{ statusText(asset) }}</small>
							</div>
							<button :disabled="busy" type="button" @click="startEdit(asset)">编辑</button>
						</div>
						<code :title="asset.contract">{{ asset.contract }}</code>
						<p v-if="asset.snapshot?.manualOnly" class="manual-policy">
							持有超过 50 枚 ERC721：为保护节点与钱包性能，仅支持在此手动刷新。
						</p>
						<div v-if="editContract === asset.contract" class="edit-fields">
							<label>显示名称<input v-model="customName" :disabled="busy" maxlength="48" :placeholder="asset.name" /></label>
							<label>显示符号<input v-model="customSymbol" :disabled="busy" maxlength="16" :placeholder="asset.symbol" /></label>
							<small>留空并保存可恢复链上名称与符号；合约、类型和精度不可修改。</small>
							<div>
								<button :disabled="busy" type="button" @click="editContract = ''">取消</button>
								<button :disabled="busy" class="primary" type="button" @click="saveEdit(asset)">保存</button>
							</div>
						</div>
						<div class="managed-actions">
							<button :disabled="busy" type="button" @click="run('refresh', asset)">
								{{ action === `refresh:${asset.contract}` ? '刷新中…' : '刷新余额' }}
							</button>
							<button :disabled="busy" class="remove" type="button" @click="removeContract = asset.contract">删除</button>
						</div>
						<div v-if="removeContract === asset.contract" class="remove-confirm">
							<span>同时删除余额快照和 metadata 缓存？</span>
							<button :disabled="busy" type="button" @click="removeContract = undefined">取消</button>
							<button :disabled="busy" class="danger" type="button" @click="run('remove', asset)">确认删除</button>
						</div>
					</li>
				</ul>
			</div>
		</section>
	</div>
</template>

<style scoped lang="scss">
.asset-manager-backdrop {
	position: fixed;
	z-index: 100;
	inset: 0;
	display: grid;
	place-items: center;
	padding: 14px;
	background: rgba(14, 30, 24, .62);

	.asset-manager {
		width: min(100%, 410px);
		max-height: min(720px, calc(100vh - 28px));
		overflow: hidden;
		border: 1px solid #cbd9d3;
		border-radius: 14px;
		background: #fffdf8;
		box-shadow: 0 24px 70px rgba(15, 37, 29, .3);
	}

	button {
		min-height: 30px;
		padding: 5px 9px;
		border: 1px solid #ccd9d4;
		border-radius: 7px;
		color: #176b57;
		background: #f4f8f6;
		font-size: 10px;
		font-weight: 750;

		&:focus-visible {
			outline: 3px solid rgba(23, 107, 87, .2);
			outline-offset: 1px;
		}

		&:disabled {
			cursor: not-allowed;
			opacity: .55;
		}

		&.primary {
			border-color: #d9604b;
			color: #fff;
			background: #d9604b;
		}
	}

	input {
		min-width: 0;
		height: 37px;
		box-sizing: border-box;
		padding: 0 9px;
		border: 1px solid #bdcec6;
		border-radius: 7px;
		color: #26342f;
		background: #fff;
		font: 11px ui-monospace, Consolas, monospace;

		&:focus {
			border-color: #176b57;
			outline: 3px solid rgba(23, 107, 87, .13);
		}
	}

	.manager-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 15px 17px 12px;
		border-bottom: 1px solid #e1e8e4;

		small {
			color: #176b57;
			font-size: 10px;
			font-weight: 700;
		}

		h2 {
			margin: 2px 0 0;
			color: #26342f;
			font-size: 18px;
		}

		button {
			width: 32px;
			height: 32px;
			border: 0;
			color: #68766f;
			background: transparent;
			font-size: 24px;
		}
	}

	.manager-scroll {
		max-height: calc(min(720px, 100vh - 28px) - 65px);
		overflow: auto;
		padding: 14px 16px 18px;
	}

	.manager-add {
		label {
			display: block;
			margin-bottom: 6px;
			color: #33443d;
			font-size: 11px;
			font-weight: 750;
		}

		> div {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 7px;
		}

		> small {
			display: block;
			margin-top: 6px;
			color: #718078;
			font-size: 10px;
			line-height: 1.45;
		}
	}

	.manager-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin: 14px -16px 0;
		padding: 9px 16px;
		border-block: 1px solid #e7ece9;
		color: #68766f;
		background: #f7f9f7;
		font-size: 10px;
	}

	.manager-message {
		margin: 10px 0 0;
		padding: 8px 9px;
		border-left: 3px solid #2d8b6e;
		color: #356b5a;
		background: #edf7f2;
		font-size: 10px;
		line-height: 1.45;

		&.error {
			border-color: #b54d42;
			color: #893d35;
			background: #fff1ee;
		}
	}

	.manager-empty {
		padding: 28px 8px;
		color: #718078;
		text-align: center;
		font-size: 11px;
	}

	.managed-list {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;

		> li {
			padding: 13px 0;
			border-bottom: 1px solid #e5ebe7;
		}

		code {
			display: block;
			margin: 7px 0;
			overflow: hidden;
			color: #748079;
			font-size: 9px;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.managed-title {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;

		> span {
			width: 30px;
			height: 30px;
			display: grid;
			place-items: center;
			border: 1px solid #c8d9d2;
			border-radius: 8px;
			color: #176b57;
			background: #edf5f1;
			font: 800 10px ui-monospace, monospace;
		}

		> div {
			min-width: 0;
			display: grid;
			gap: 2px;
		}

		strong,
		small {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		strong {
			color: #26342f;
			font-size: 11px;
		}

		small {
			color: #718078;
			font-size: 10px;
		}
	}

	.managed-actions {
		display: flex;
		gap: 6px;

		.remove {
			margin-left: auto;
			border-color: transparent;
			color: #9d4b43;
			background: transparent;
		}
	}

	.manual-policy {
		margin: 7px 0;
		padding: 7px 8px;
		border-left: 3px solid #b57b20;
		color: #745119;
		background: #fff6df;
		font-size: 10px;
		line-height: 1.45;
	}

	.edit-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 7px;
		margin: 9px 0;
		padding: 9px;
		border: 1px solid #d9e4df;
		background: #f8faf8;

		label {
			display: grid;
			gap: 4px;
			color: #53635c;
			font-size: 9px;
		}

		input {
			width: 100%;
			height: 32px;
			font-family: inherit;
		}

		> small,
		> div {
			grid-column: 1 / -1;
		}

		> small {
			color: #718078;
			font-size: 9px;
			line-height: 1.4;
		}

		> div {
			display: flex;
			justify-content: flex-end;
			gap: 6px;
		}
	}

	.remove-confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		margin-top: 8px;
		padding: 8px;
		color: #743f39;
		background: #fff1ee;
		font-size: 10px;

		span {
			width: 100%;
		}
	}

	.danger {
		border-color: #a4473e;
		color: #fff;
		background: #a4473e;
	}
}
</style>
