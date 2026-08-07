<script lang="ts" setup>
import {nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import CopyButton from '@/components/common/CopyButton.vue'
import type {WalletAccountSummary} from '@/core/wallet/types'
import {useAccountManagementStore} from '@/stores/accountManagement'
import {useWalletSessionStore} from '@/stores/walletSession'
import {useWalletHomeStore} from '@/stores/walletHome'
import {useWalletUiStore} from '@/stores/walletUi'

const session = useWalletSessionStore()
const management = useAccountManagementStore()
const home = useWalletHomeStore()
const walletUi = useWalletUiStore()
const accountListRoot = ref<HTMLElement>()
const openAccountMenuIndex = ref<number>()
const accountMenuPlacement = ref<'up' | 'down'>('down')
const activeMenuButton = ref<HTMLButtonElement>()

const closeAccountMenu = (restoreFocus = false): void => {
	if (openAccountMenuIndex.value === undefined) return
	openAccountMenuIndex.value = undefined
	accountMenuPlacement.value = 'down'
	if (restoreFocus) void nextTick(() => activeMenuButton.value?.focus())
}

const accountMenuItems = (index: number): HTMLButtonElement[] =>
	Array.from(
		accountListRoot.value?.querySelectorAll<HTMLButtonElement>(
			`[data-account-menu="${index}"] [role="menuitem"]:not(:disabled)`,
		) ?? [],
	)

const toggleAccountMenu = (index: number, event: MouseEvent): void => {
	if (openAccountMenuIndex.value === index) {
		closeAccountMenu()
		return
	}
	activeMenuButton.value = event.currentTarget as HTMLButtonElement
	accountMenuPlacement.value = 'down'
	openAccountMenuIndex.value = index
	void nextTick(() => {
		const menuRoot = accountListRoot.value?.querySelector<HTMLElement>(
			`[data-account-menu="${index}"]`,
		)
		const panel = menuRoot?.querySelector<HTMLElement>('[role="menu"]')
		const boundary = menuRoot?.closest('.wallet-shell') as HTMLElement | null | undefined
		if (menuRoot && panel && boundary) {
			const triggerRect = menuRoot.getBoundingClientRect()
			const boundaryRect = boundary.getBoundingClientRect()
			const spaceBelow = boundaryRect.bottom - triggerRect.bottom
			const spaceAbove = triggerRect.top - boundaryRect.top
			if (spaceBelow < panel.offsetHeight + 4 && spaceAbove > spaceBelow) {
				accountMenuPlacement.value = 'up'
			}
		}
		void nextTick(() => accountMenuItems(index)[0]?.focus())
	})
}

const handleOutsideAccountMenu = (event: PointerEvent): void => {
	if (
		openAccountMenuIndex.value !== undefined &&
		!accountListRoot.value?.contains(event.target as Node)
	) {
		closeAccountMenu()
		return
	}
	const target = event.target
	if (
		openAccountMenuIndex.value !== undefined &&
		!(
			target instanceof Element &&
			target.closest(`[data-account-menu="${openAccountMenuIndex.value}"]`)
		)
	) {
		closeAccountMenu()
	}
}

const handleAccountMenuKeydown = (event: KeyboardEvent): void => {
	const index = openAccountMenuIndex.value
	if (index === undefined) return
	if (event.key === 'Escape') {
		event.preventDefault()
		closeAccountMenu(true)
		return
	}
	if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
	const items = accountMenuItems(index)
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
	walletUi.go('account')
}

const openEdit = (account: WalletAccountSummary): void => {
	closeAccountMenu()
	management.openEdit(account)
	walletUi.go('account')
}

const exportPrivateKey = (accountIndex: number): void => {
	closeAccountMenu()
	walletUi.openSecretExport('private-key', 'accounts', accountIndex)
}

const requestDelete = (accountIndex: number): void => {
	closeAccountMenu()
	management.deleteAccountIndex = accountIndex
}

const submit = async (): Promise<void> => {
	if (await management.submit()) walletUi.go('accounts')
}

const switchAccount = async (index: number): Promise<void> => {
	if (await management.switchTo(index)) await home.refresh()
}

watch(
	() => walletUi.view,
	() => closeAccountMenu(),
)

onMounted(() => {
	document.addEventListener('pointerdown', handleOutsideAccountMenu)
	document.addEventListener('keydown', handleAccountMenuKeydown)
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', handleOutsideAccountMenu)
	document.removeEventListener('keydown', handleAccountMenuKeydown)
})
</script>

<template>
	<section v-if="walletUi.view === 'accounts'" class="accounts-page">
		<button aria-label="返回钱包" class="back" type="button" @click="walletUi.go('done')">
			← 返回钱包
		</button>
		<div class="network-list-heading">
			<div>
				<p class="eyebrow">钱包账户</p>
				<h1>账户管理</h1>
			</div>
			<button :disabled="management.busy" class="compact-add" type="button" @click="openAdd">
				＋ 添加账户
			</button>
		</div>
		<p class="subcopy">账户由当前助记词统一派生。</p>
		<div ref="accountListRoot" class="account-list">
			<article
				v-for="account in session.summary?.accounts"
				:key="account.index"
				class="account-list-item"
			>
				<div class="account-row">
					<button
						:aria-label="account.index === session.summary?.activeAccountIndex ? `${account.name}，当前账户` : `切换到${account.name}`"
						:disabled="management.busy || account.index === session.summary?.activeAccountIndex"
						class="account-select"
						type="button"
						@click="switchAccount(account.index)"
					>
						<span class="account-copy">
							<span class="account-heading">
								<b>{{ account.name }}</b>
								<small v-if="account.remark">{{ account.remark }}</small>
							</span>
							<code
								v-if="session.accountAddress(account)"
								:title="session.accountAddress(account)"
							>
								{{ session.accountAddress(account) }}
							</code>
						</span>
					</button>
					<span
						v-if="account.index === session.summary?.activeAccountIndex"
						aria-label="当前账户"
						class="account-check"
						role="img"
					>✓</span>
					<span v-else aria-hidden="true" class="account-check-placeholder"></span>
					<CopyButton
						v-if="session.accountAddress(account)"
						:feedback-key="`manage-account-${account.index}`"
						:label="`复制${account.name}的地址`"
						:value="session.accountAddress(account)"
					/>
					<div
						:data-account-menu="account.index"
						class="account-menu"
					>
						<button
							:aria-expanded="openAccountMenuIndex === account.index"
							:aria-label="`${account.name}操作`"
							:disabled="management.busy"
							aria-haspopup="menu"
							class="account-menu-trigger"
							type="button"
							@click="toggleAccountMenu(account.index, $event)"
						>
							<span aria-hidden="true">•••</span>
						</button>
						<div
							v-if="openAccountMenuIndex === account.index"
							:class="{ 'opens-upward': accountMenuPlacement === 'up' }"
							:aria-label="`${account.name}操作菜单`"
							class="account-menu-panel"
							role="menu"
						>
							<button
								:disabled="management.busy"
								role="menuitem"
								type="button"
								@click="exportPrivateKey(account.index)"
							>
								导出私钥
							</button>
							<button
								:disabled="management.busy"
								role="menuitem"
								type="button"
								@click="openEdit(account)"
							>
								编辑
							</button>
							<button
								:disabled="management.busy || session.summary?.accounts.length === 1"
								class="danger-text"
								role="menuitem"
								type="button"
								@click="requestDelete(account.index)"
							>
								删除
							</button>
						</div>
					</div>
				</div>
				<div v-if="management.deleteAccountIndex === account.index" class="inline-confirm">
					<span>删除后仍可按同一索引重新派生。</span>
					<button
						:disabled="management.busy"
						type="button"
						@click="management.remove(account.index)"
					>
						确认删除
					</button>
					<button
						:disabled="management.busy"
						type="button"
						@click="management.deleteAccountIndex = undefined"
					>
						取消
					</button>
				</div>
			</article>
		</div>
		<p v-if="management.error" class="error">{{ management.error }}</p>
	</section>

	<section v-else class="form-page">
		<button class="back" type="button" @click="walletUi.go('accounts')">← 返回账户</button>
		<p class="eyebrow">账户资料</p>
		<h1>{{ management.editingAccountIndex === undefined ? '添加派生账户' : '编辑账户' }}</h1>
		<p class="subcopy">
			{{management.editingAccountIndex === undefined ? '将使用下一个未使用的派生索引创建账户。' : '名称和备注不影响地址或私钥。' }}
		</p>
		<form @submit.prevent="submit">
			<label>账户名称<input v-model="management.form.name" autocomplete="off" maxlength="40"/></label>
			<label>备注<textarea
				v-model="management.form.remark"
				autocomplete="off"
				maxlength="120"
				placeholder="例如：部署账户、运营备用（可选）"
				rows="3"
			></textarea>
			</label>
			<p class="field-hint">{{ management.form.remark.length }}/120</p>
			<p v-if="management.error" class="error">{{ management.error }}</p>
			<button :disabled="management.busy" class="primary" type="submit">
				{{management.busy ? '正在保存…' : management.editingAccountIndex === undefined ? '添加账户' : '保存修改' }}
			</button>
		</form>
	</section>
</template>

<style lang="scss" scoped>
.accounts-page {
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

	.account-list {
		display: grid;
		gap: 7px;

		.account-list-item {
			position: relative;
			border: 1px solid #e0e7e3;
			border-radius: 8px;
			background: #fff;

			.account-row {
				min-height: 62px;
				display: flex;
				align-items: center;
				gap: 5px;
				padding: 7px 8px 7px 11px;

				.account-select {
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

					.account-copy {
						min-width: 0;
						display: grid;
						gap: 4px;

						.account-heading {
							min-width: 0;
							display: flex;
							align-items: baseline;
							gap: 7px;

							b,
							small {
								overflow: hidden;
								text-overflow: ellipsis;
								white-space: nowrap;
							}

							b {
								flex: 0 1 auto;
								font-size: 13px;
							}

							small {
								min-width: 0;
								color: #74807b;
								font-size: 10px;
							}
						}

						code {
							overflow: hidden;
							color: #69766f;
							font-size: 10px;
							text-overflow: ellipsis;
							white-space: nowrap;
						}
					}
				}

				.account-check,
				.account-check-placeholder {
					width: 17px;
					flex: 0 0 17px;
					text-align: center;
				}

				.account-check {
					color: #2d3935;
					font-size: 15px;
					font-weight: 800;
				}

				.account-menu {
					position: relative;
					flex: 0 0 auto;

					.account-menu-trigger {
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

					.account-menu-panel {
						position: absolute;
						z-index: 10;
						top: calc(100% + 4px);
						right: 0;
						width: 132px;
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
}

.field-hint {
	margin: -8px 0 0;
	color: #777c87;
	font-size: 11px;
	text-align: right;
}
</style>
