<script lang="ts" setup>
import {nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import type {NetworkConfig} from '@/shared/types'
import {useNetworkManagementStore} from '@/stores/networkManagement'
import {useWalletSessionStore} from '@/stores/walletSession'
import {useWalletHomeStore} from '@/stores/walletHome'
import {useWalletUiStore} from '@/stores/walletUi'

const session = useWalletSessionStore()
const management = useNetworkManagementStore()
const home = useWalletHomeStore()
const walletUi = useWalletUiStore()
const networkListRoot = ref<HTMLElement>()
const openNetworkMenuId = ref<string>()
const networkMenuPlacement = ref<'up' | 'down'>('down')
const activeMenuButton = ref<HTMLButtonElement>()

const closeNetworkMenu = (restoreFocus = false): void => {
	if (openNetworkMenuId.value === undefined) return
	openNetworkMenuId.value = undefined
	networkMenuPlacement.value = 'down'
	if (restoreFocus) void nextTick(() => activeMenuButton.value?.focus())
}

const networkMenuItems = (id: string): HTMLButtonElement[] =>
	Array.from(
		networkListRoot.value?.querySelectorAll<HTMLButtonElement>(
			`[data-network-menu="${id}"] [role="menuitem"]:not(:disabled)`,
		) ?? [],
	)

const toggleNetworkMenu = (id: string, event: MouseEvent): void => {
	if (openNetworkMenuId.value === id) {
		closeNetworkMenu()
		return
	}
	activeMenuButton.value = event.currentTarget as HTMLButtonElement
	networkMenuPlacement.value = 'down'
	openNetworkMenuId.value = id
	void nextTick(() => {
		const menuRoot = networkListRoot.value?.querySelector<HTMLElement>(
			`[data-network-menu="${id}"]`,
		)
		const panel = menuRoot?.querySelector<HTMLElement>('[role="menu"]')
		const boundary = menuRoot?.closest('.wallet-shell') as HTMLElement | null | undefined
		if (menuRoot && panel && boundary) {
			const triggerRect = menuRoot.getBoundingClientRect()
			const boundaryRect = boundary.getBoundingClientRect()
			const spaceBelow = boundaryRect.bottom - triggerRect.bottom
			const spaceAbove = triggerRect.top - boundaryRect.top
			if (spaceBelow < panel.offsetHeight + 4 && spaceAbove > spaceBelow) {
				networkMenuPlacement.value = 'up'
			}
		}
		void nextTick(() => networkMenuItems(id)[0]?.focus())
	})
}

const handleOutsideNetworkMenu = (event: PointerEvent): void => {
	if (
		openNetworkMenuId.value !== undefined &&
		!networkListRoot.value?.contains(event.target as Node)
	) {
		closeNetworkMenu()
		return
	}
	const target = event.target
	if (
		openNetworkMenuId.value !== undefined &&
		!(
			target instanceof Element &&
			target.closest(`[data-network-menu="${openNetworkMenuId.value}"]`)
		)
	) {
		closeNetworkMenu()
	}
}

const handleNetworkMenuKeydown = (event: KeyboardEvent): void => {
	const id = openNetworkMenuId.value
	if (id === undefined) return
	if (event.key === 'Escape') {
		event.preventDefault()
		closeNetworkMenu(true)
		return
	}
	if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
	const items = networkMenuItems(id)
	if (!items.length) return
	event.preventDefault()
	const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
	const targetIndex =
		event.key === 'Home'
			? 0
			: event.key === 'End'
				? items.length - 1
				: event.key === 'ArrowDown'
					? (Math.max(currentIndex, -1) + 1) % items.length
					: (currentIndex <= 0 ? items.length : currentIndex) - 1
	items[targetIndex]?.focus()
}

const openAdd = (): void => {
	management.openAdd()
	walletUi.go('network')
}

const openEdit = (network: NetworkConfig): void => {
	closeNetworkMenu()
	management.openEdit(network)
	walletUi.go('network')
}

const requestDelete = (network: NetworkConfig): void => {
	closeNetworkMenu()
	management.requestDelete(network)
}

const submit = async (): Promise<void> => {
	if (await management.submit()) walletUi.go('networks')
}

const switchNetwork = async (id: string): Promise<void> => {
	if (await management.switchTo(id)) await home.refresh()
}

watch(
	() => walletUi.view,
	() => closeNetworkMenu(),
)

onMounted(() => {
	document.addEventListener('pointerdown', handleOutsideNetworkMenu)
	document.addEventListener('keydown', handleNetworkMenuKeydown)
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', handleOutsideNetworkMenu)
	document.removeEventListener('keydown', handleNetworkMenuKeydown)
})
</script>

<template>
	<section v-if="walletUi.view === 'networks'" class="networks-page">
		<button aria-label="返回钱包" class="back" type="button" @click="walletUi.go('done')">
			← 返回钱包
		</button>
		<div class="network-list-heading">
			<div>
				<p class="eyebrow">节点与群组</p>
				<h1>网络管理</h1>
			</div>
			<button :disabled="management.busy" class="compact-add" type="button" @click="openAdd">
				＋ 添加网络
			</button>
		</div>
		<p class="subcopy"></p>
		<p v-if="management.error" class="error network-list-error">{{ management.error }}</p>

		<ul
			v-if="management.savedNetworks.length"
			ref="networkListRoot"
			aria-label="已保存网络"
			class="network-list"
		>
			<li
				v-for="network in management.savedNetworks"
				:key="network.id"
				class="network-list-item"
			>
				<div class="network-row">
					<button
						:aria-label="network.id === session.activeNetwork?.id ? `${network.name}，当前网络` : `切换到${network.name}`"
						:disabled="management.busy || network.id === session.activeNetwork?.id"
						class="network-select"
						type="button"
						@click="switchNetwork(network.id)"
					>
						<span class="network-copy">
							<strong>{{ network.name }}</strong>
							<code :title="network.rpcUrl">{{ network.rpcUrl }}</code>
							<small>
								{{ network.mode === 'web3' ? `Web3 RPC · Chain ${network.chainId}` : `原生 RPC · ${network.groupId}` }} ·
								{{ network.crypto === 'gm' ? '国密' : '标准' }} ·
								{{ network.compatibilityVersion ? network.compatibilityVersion+' · ': '' }}
								{{ network.billingEnabled
									? `余额开启 · ${network.balanceToken ?? 'FBT'} · ${network.balanceDecimals ?? 18} 位`
									: '余额关闭' }}
							</small>
						</span>
					</button>
					<span
						v-if="network.id === session.activeNetwork?.id"
						aria-label="当前网络"
						class="network-check"
						role="img"
					>✓</span>
					<span v-else aria-hidden="true" class="network-check-placeholder"></span>
					<div :data-network-menu="network.id" class="network-menu">
						<button
							:aria-expanded="openNetworkMenuId === network.id"
							:aria-label="`${network.name}操作`"
							:disabled="management.busy"
							aria-haspopup="menu"
							class="network-menu-trigger"
							type="button"
							@click="toggleNetworkMenu(network.id, $event)"
						>
							<span aria-hidden="true">•••</span>
						</button>
						<div
							v-if="openNetworkMenuId === network.id"
							:aria-label="`${network.name}操作菜单`"
							:class="{ 'opens-upward': networkMenuPlacement === 'up' }"
							class="network-menu-panel"
							role="menu"
						>
							<button
								:disabled="management.busy"
								role="menuitem"
								type="button"
								@click="openEdit(network)"
							>
								编辑
							</button>
							<button
								:disabled="management.busy || network.id === session.activeNetwork?.id"
								class="danger-text"
								role="menuitem"
								type="button"
								@click="requestDelete(network)"
							>
								删除
							</button>
						</div>
					</div>
				</div>
				<div
					v-if="management.deleteConfirmationId === network.id"
					class="inline-confirm"
					role="alert"
				>
					<span>确定删除“{{ network.name }}”？此操作无法撤销。</span>
					<button
						:disabled="management.busy"
						type="button"
						@click="management.remove(network.id)"
					>
						{{ management.busy ? '正在删除…' : '确认删除' }}
					</button>
					<button
						:disabled="management.busy"
						type="button"
						@click="management.deleteConfirmationId = undefined"
					>
						取消
					</button>
				</div>
			</li>
		</ul>
		<section v-else class="network-directory-empty">
			<small>网络列表为空</small>
			<strong>还没有保存的网络</strong>
			<p>添加网络后会按原生或 Web3 RPC 协议验证节点，再保存为当前网络。</p>
			<button :disabled="management.busy" class="primary" type="button" @click="openAdd">
				添加网络
			</button>
		</section>
	</section>

	<section v-else class="form-page network-page">
		<button
			aria-label="返回网络列表"
			class="back"
			type="button"
			@click="walletUi.go('networks')"
		>
			← 返回网络列表
		</button>
		<p class="eyebrow">验证节点连接</p>
		<h1>{{ management.editingNetworkId ? '编辑网络' : '添加网络' }}</h1>
		<p class="subcopy">
			{{ management.form.mode === 'web3'
				? '保存前核对数字 Chain ID；Web3 RPC 使用标准 secp256k1 密码体系。'
				: '保存前核验群组、兼容版本、密码体系和计费配置。' }}
		</p>
		<form @submit.prevent="submit">
			<label
			>名称<input
				v-model="management.form.name"
				autocomplete="off"
				maxlength="40"
				placeholder="例如：本地开发链"
			/></label>
			<label
			>URL<input
				v-model="management.form.url"
				autocomplete="url"
				inputmode="url"
				placeholder="https://node.example.com"
				spellcheck="false"
				type="url"
			/></label>
			<fieldset>
				<legend>RPC 类型</legend>
				<div class="segments">
					<button
						:class="{ active: management.form.mode === 'legacy' }"
						type="button"
						@click="management.selectMode('legacy')"
					>
						<b>原生 RPC</b><small>getGroupInfoList</small>
					</button>
					<button
						:class="{ active: management.form.mode === 'web3' }"
						type="button"
						@click="management.selectMode('web3')"
					>
						<b>Web3 RPC</b><small>eth_chainId</small>
					</button>
				</div>
			</fieldset>
			<label
				v-if="management.form.mode === 'legacy'"
			>群组 ID<input
				v-model="management.form.groupId"
				autocomplete="off"
				placeholder="group0"
				spellcheck="false"
			/></label>
			<label v-else
			>Chain ID<input
				v-model.number="management.form.chainId"
				inputmode="numeric"
				min="1"
				step="1"
				type="number"
			/></label>
			<fieldset
				:aria-describedby="management.form.mode === 'web3' ? 'crypto-compatibility-note' : undefined"
			>
				<legend>密码体系</legend>
				<div class="segments">
					<button
						:class="{ active: !management.form.isGM }"
						type="button"
						@click="management.form.isGM = false"
					>
						<b>标准</b><small>secp256k1</small>
					</button>
					<button
						:class="{ active: management.form.isGM }"
						:disabled="management.form.mode === 'web3'"
						type="button"
						@click="management.form.isGM = true"
					>
						<b>国密</b><small>SM2 · SM3</small>
					</button>
				</div>
				<p
					v-if="management.form.mode === 'web3'"
					id="crypto-compatibility-note"
					class="compatibility-note"
				>
					Web3 原始交易使用 secp256k1 签名，不支持 SM2；国密网络请选择原生 RPC。
				</p>
			</fieldset>
			<label class="check-row">
				<input v-model="management.form.billingEnabled" type="checkbox"/>
				<span>
					<b>开启余额</b>
					<small>
						{{ management.form.mode === 'web3'
							? '通过 eth_getBalance 获取原生余额'
							: '要求原生 RPC 返回已启用 feature_balance' }}
					</small>
				</span>
			</label>
			<div v-if="management.form.billingEnabled" class="balance-fields">
				<label>
					余额小数位数
					<input
						v-model.number="management.form.balanceDecimals"
						inputmode="numeric"
						max="255"
						min="0"
						type="number"
					/>
				</label>
				<label>
					余额 Token
					<input
						v-model="management.form.balanceToken"
						autocomplete="off"
						maxlength="16"
						placeholder="FBT"
					/>
				</label>
			</div>
			<p v-if="management.error" class="error">{{ management.error }}</p>
			<button :disabled="management.busy" class="primary" type="submit">
				{{management.busy ? '正在探测节点…' : management.editingNetworkId ? '验证并保存' : '验证并添加网络' }}
			</button>
		</form>
	</section>
</template>

<style lang="scss" scoped>
.network-page h1,
.networks-page h1 {
	font-size: 25px;
}

.segments {
	display: grid;
	grid-template-columns: 1fr 1fr;
	border: 1px solid #bbb8af;
	background: #fffdf7;

	button {
		display: grid;
		gap: 3px;
		padding: 10px 12px;
		border: 0;
		color: #596274;
		background: transparent;
		text-align: left;

		+ button {
			border-left: 1px solid #bbb8af;
		}

		&.active {
			color: #fff;
			background: #14213d;
		}

		&:disabled {
			color: #818a86;
			background: #f3f5f4;
			cursor: not-allowed;
			opacity: 0.72;
		}
	}

	b {
		font-size: 12px;
	}

	small {
		font: 500 11px/1.2 ui-monospace,
		monospace;
		opacity: 0.76;
	}

}

.compatibility-note {
	margin: 7px 2px 0;
	color: #65716c;
	font-size: 11px;
	line-height: 1.45;
}

.check-row {
	grid-template-columns: 17px 1fr;
	align-items: start;
	gap: 10px;
	padding: 11px;
	border: 1px solid #bbb8af;
	background: #fffdf7;
	cursor: pointer;

	input {
		width: 15px;
		height: 15px;
		margin: 1px 0 0;
		padding: 0;
		accent-color: #2457d6;
	}

	span {
		display: grid;
		gap: 4px;
	}

	b {
		color: #303a4d;
		font-size: 11px;
	}

	small {
		color: #717681;
		font: 500 12px/1.4 ui-monospace,
		monospace;
	}
}

.balance-fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 10px;

	label {
		min-width: 0;
	}
}

.network-list-error {
	margin-bottom: 12px;
}

.networks-page {
	> .back {
		margin-bottom: 12px;
	}

	.network-list-heading {
		.eyebrow {
			margin-bottom: 4px;
		}
	}

	> .subcopy {
		margin: 8px 0 12px;
		font-size: 12px;
		line-height: 1.45;
	}
}

.network-list {
	list-style: none;
	display: grid;
	gap: 7px;
	margin: 0;
	padding: 0;

	.network-list-item {
		position: relative;
		border: 1px solid #e0e7e3;
		border-radius: 8px;
		background: #fff;

		.network-row {
			min-height: 68px;
			display: flex;
			align-items: center;
			gap: 5px;
			padding: 7px 8px 7px 11px;

			.network-select {
				min-width: 0;
				align-self: stretch;
				flex: 1 1 auto;
				display: flex;
				align-items: center;
				padding: 0;
				border: 0;
				color: #25352f;
				background: transparent;
				text-align: left;

				&:hover:not(:disabled),
				&:focus-visible {
					background: #f5f8f6;
					outline: 0;
				}

				&:disabled {
					color: #25352f;
					cursor: default;
					opacity: 1;
				}

				.network-copy {
					min-width: 0;
					display: grid;
					gap: 3px;

					strong,
					code,
					small {
						overflow: hidden;
						text-overflow: ellipsis;
						white-space: nowrap;
					}

					strong {
						color: #25352f;
						font-size: 13px;
					}

					code {
						color: #69766f;
						font-size: 10px;
					}

					small {
						color: #74807b;
						font-size: 10px;
					}
				}
			}

			.network-check,
			.network-check-placeholder {
				width: 17px;
				flex: 0 0 17px;
				text-align: center;
			}

			.network-check {
				color: #2d3935;
				font-size: 15px;
				font-weight: 800;
			}

			.network-menu {
				position: relative;
				flex: 0 0 auto;

				.network-menu-trigger {
					width: 30px;
					height: 30px;
					display: grid;
					place-items: center;
					padding: 0;
					border: 1px solid transparent;
					border-radius: 6px;
					color: #52605a;
					background: transparent;
					font-size: 12px;
					font-weight: 800;
					letter-spacing: 1px;

					&:hover,
					&:focus-visible,
					&[aria-expanded='true'] {
						border-color: #dce5e0;
						color: #26352f;
						background: #f1f5f3;
						outline: 0;
					}
				}

				.network-menu-panel {
					position: absolute;
					z-index: 10;
					top: calc(100% + 4px);
					right: 0;
					width: 116px;
					display: grid;
					padding: 4px;
					border: 1px solid #dce5e0;
					border-radius: 8px;
					background: #fff;
					box-shadow: 0 10px 24px rgba(24, 40, 34, 0.14);

					&.opens-upward {
						top: auto;
						bottom: calc(100% + 4px);
					}

					button {
						min-height: 32px;
						padding: 6px 9px;
						border: 0;
						border-radius: 5px;
						color: #34443e;
						background: transparent;
						font-size: 11px;
						font-weight: 600;
						text-align: left;

						&:hover:not(:disabled),
						&:focus-visible {
							background: #edf4f0;
							outline: 0;
						}

						&.danger-text {
							color: #9a3e37;
						}
					}
				}
			}
		}

		.inline-confirm {
			display: grid;
			grid-template-columns: 1fr auto auto;
			align-items: center;
			gap: 6px;
			padding: 9px;
			border-top: 1px solid #efd7d3;
			color: #8c3931;
			background: #faece9;
			font-size: 11px;

			button {
				min-height: 28px;
				padding-inline: 7px;
				border: 1px solid #c59a95;
				color: #67312c;
				background: #fff8f5;
				font-size: 11px;
				font-weight: 700;
			}
		}
	}
}

.network-directory-empty {
	display: grid;
	gap: 7px;
	padding: 22px 16px 17px;
	border: 1px solid #b8b5ac;
	border-left: 4px solid #8e9298;
	background: #fffdf7;

	small {
		color: #777c87;
		font: 700 11px/1.2 ui-monospace,
		monospace;
		letter-spacing: 0.12em;
	}

	strong {
		color: #14213d;
		font-size: 14px;
	}

	p {
		margin: 0 0 6px;
		color: #727783;
		font-size: 12px;
		line-height: 1.55;
	}
}

.segments button {
	color: #68736f;

	+ button {
		border-color: #e2e8e4;
	}

	&.active {
		color: #176b57;
		background: #e7f3ee;
	}
}

.segments small {
	font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.check-row {
	padding: 12px;
	border: 1px solid #d8e0dc;
	border-radius: 10px;
	background: #fff;

	small {
		color: #74807b;
		font-family: inherit;
	}
}

.network-directory-empty {
	padding: 24px 18px 18px;
}

.network-directory-empty small,
.network-empty small {
	color: #176b57;
	font-family: inherit;
	letter-spacing: 0.03em;
}

.segments {
	overflow: hidden;
	border-color: #d8e0dc;
	border-radius: 10px;
	background: #fff;
}

.check-row input {
	accent-color: #176b57;
}

.network-directory-empty {
	border: 1px solid #e0e7e3;
	border-radius: 14px;
	background: #fff;
	box-shadow: 0 6px 18px rgba(31, 52, 45, 0.05);
}
</style>
