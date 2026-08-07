<script lang="ts" setup>
import {nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {storeToRefs} from 'pinia'
import CopyButton from '@/components/common/CopyButton.vue'
import {useAccountManagementStore} from '@/stores/accountManagement'
import {useNetworkManagementStore} from '@/stores/networkManagement'
import {useWalletHomeStore} from '@/stores/walletHome'
import {useWalletSessionStore} from '@/stores/walletSession'
import {useWalletUiStore} from '@/stores/walletUi'
import {useWalletController} from '@/composables/useWalletController'

const session = useWalletSessionStore()
const controller = useWalletController()
const walletUi = useWalletUiStore()
const accounts = useAccountManagementStore()
const networks = useNetworkManagementStore()
const home = useWalletHomeStore()
const {view, busy} = storeToRefs(walletUi)

const headerRoot = ref<HTMLElement>()
const contextRoot = ref<HTMLElement>()
const menuRoot = ref<HTMLElement>()
const menuButton = ref<HTMLButtonElement>()
const menuOpen = ref(false)
const openDropdown = ref<'account' | 'network' | 'connection'>()
const expanding = ref(false)

const compact = (value?: string, start = 8, end = 6): string => {
	if (!value) return '—'
	return value.length > start + end + 1
		? `${value.slice(0, start)}…${value.slice(-end)}`
		: value
}

const originHost = (origin: string): string => {
	try {
		return new URL(origin).host
	} catch {
		return origin
	}
}

const closeMenu = (restoreFocus = false): void => {
	if (!menuOpen.value) return
	menuOpen.value = false
	if (restoreFocus) void nextTick(() => menuButton.value?.focus())
}

const toggleMenu = (): void => {
	openDropdown.value = undefined
	menuOpen.value = !menuOpen.value
	if (menuOpen.value) {
		void nextTick(() =>
			menuRoot.value
				?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
				?.focus(),
		)
	}
}

const toggleDropdown = (target: 'account' | 'network' | 'connection'): void => {
	menuOpen.value = false
	openDropdown.value = openDropdown.value === target ? undefined : target
}

const handleOutsideMenu = (event: PointerEvent): void => {
	if (menuOpen.value && !menuRoot.value?.contains(event.target as Node)) closeMenu()
	const dropdownRoot =
		openDropdown.value === 'network' ? headerRoot.value : contextRoot.value
	if (openDropdown.value && !dropdownRoot?.contains(event.target as Node)) {
		openDropdown.value = undefined
	}
}

const handleMenuKeydown = (event: KeyboardEvent): void => {
	if (event.key === 'Escape' && menuOpen.value) {
		event.preventDefault()
		closeMenu(true)
	}
	if (event.key === 'Escape' && openDropdown.value) {
		event.preventDefault()
		openDropdown.value = undefined
	}
}

const switchNetwork = async (id: string): Promise<void> => {
	if (!(await networks.switchTo(id))) return
	openDropdown.value = undefined
	await home.refresh()
}

const switchAccount = async (index: number): Promise<void> => {
	if (!(await accounts.switchTo(index))) return
	openDropdown.value = undefined
	await home.refresh()
}

const manageAccounts = (): void => {
	closeMenu()
	openDropdown.value = undefined
	accounts.openList()
	walletUi.go('accounts')
}

const manageNetworks = (): void => {
	closeMenu()
	openDropdown.value = undefined
	walletUi.go('networks')
	void networks.openList()
}

const openExpandedView = async (): Promise<void> => {
	if (walletUi.expanded || expanding.value) return
	expanding.value = true
	const url = chrome.runtime.getURL('index.html?expanded=1')
	try {
		const tabs = chrome.tabs
		if (!tabs) throw new Error('标签页 API 不可用')
		await tabs.create({url})
		window.close()
	} catch {
		window.location.assign(url)
	} finally {
		expanding.value = false
	}
}

onMounted(() => {
	document.addEventListener('pointerdown', handleOutsideMenu)
	document.addEventListener('keydown', handleMenuKeydown)
})

onBeforeUnmount(() => {
	document.removeEventListener('pointerdown', handleOutsideMenu)
	document.removeEventListener('keydown', handleMenuKeydown)
})

watch(
	view,
	() => {
		closeMenu()
		openDropdown.value = undefined
	},
)
</script>

<template>
	<header ref="headerRoot" class="brand-bar">
		<div class="brand-identity">
			<img alt="" class="brand-mark" src="/logo.png"/>
		</div>
		<template v-if="view === 'done'">
			<div class="header-control network-control">
				<button
					:aria-expanded="openDropdown === 'network'"
					aria-haspopup="menu"
					class="header-select"
					type="button"
					@click="toggleDropdown('network')"
				>
					<span>{{ session.activeNetwork?.name ?? '未配置网络' }}</span>
					<code v-if="session.activeNetwork">
						{{ session.activeNetwork.mode === 'web3'
							? `Chain ${session.activeNetwork.chainId}`
							: session.activeNetwork.groupId }} ·
						{{
							session.activeNetwork.crypto === 'gm'
								? '国密 SM2/SM3'
								: '标准 secp256k1'
						}}
					</code>
					<i aria-hidden="true">⌄</i>
				</button>
				<div
					v-if="openDropdown === 'network'"
					class="header-popover network-popover"
					role="menu"
				>
					<p>切换网络</p>
					<button
						v-for="network in networks.savedNetworks"
						:key="network.id"
						:aria-checked="network.id === session.activeNetwork?.id"
						:class="{ active: network.id === session.activeNetwork?.id }"
						role="menuitemradio"
						type="button"
						@click="switchNetwork(network.id)"
					>
						<span>{{ network.name }}</span>
						<code>
							{{ network.mode === 'web3' ? `Chain ${network.chainId}` : network.groupId }} ·
							{{ network.crypto === 'gm' ? '国密 SM2/SM3' : '标准 secp256k1' }}
						</code>
					</button>
					<button class="popover-manage" role="menuitem" type="button" @click="manageNetworks">
						管理网络 →
					</button>
				</div>
			</div>
		</template>
		<div v-else class="header-spacer"></div>

		<div class="header-actions">
			<div v-if="view === 'done'" ref="menuRoot" class="wallet-menu">
				<button
					ref="menuButton"
					:aria-expanded="menuOpen"
					aria-controls="wallet-controls"
					aria-haspopup="menu"
					aria-label="打开钱包操作菜单"
					class="menu-trigger"
					type="button"
					@click="toggleMenu"
				>
					⋮
				</button>
				<div
					v-if="menuOpen"
					id="wallet-controls"
					aria-label="钱包操作"
					class="menu-panel"
					role="menu"
				>
					<button
						v-if="!walletUi.expanded"
						:disabled="expanding"
						role="menuitem"
						type="button"
						@click="openExpandedView"
					>
						<span>展开视图</span>
					</button>
					<button role="menuitem" type="button" @click="manageAccounts">
						<span>管理账户</span>
					</button>
					<button role="menuitem" type="button" @click="manageNetworks">
						<span>管理网络</span>
					</button>
					<button
						role="menuitem"
						type="button"
						@click="walletUi.openSecretExport('mnemonic', 'done')"
					>
						<span>导出助记词</span>
					</button>
					<button :disabled="busy" role="menuitem" type="button" @click="controller.lock">
						<span>锁定钱包</span>
					</button>
					<button
						class="menu-danger"
						role="menuitem"
						type="button"
						@click="walletUi.openReset('done')"
					>
						<span>重置钱包</span>
					</button>
				</div>
			</div>
		</div>
	</header>

	<aside
		v-if="view === 'done'"
		ref="contextRoot"
		aria-label="账户与网站连接"
		class="wallet-context-bar"
	>
		<div class="header-control account-control">
			<div class="account-trigger-row">
				<button
					:aria-expanded="openDropdown === 'account'"
					aria-haspopup="menu"
					class="header-select"
					type="button"
					@click="toggleDropdown('account')"
				>
					<span>{{ session.activeAccount?.name ?? '未选择账户' }}</span>
					<code>{{ compact(session.accountAddress(session.activeAccount), 8, 6) }}</code>
					<i aria-hidden="true">⌄</i>
				</button>
			</div>
			<div
				v-if="openDropdown === 'account'"
				class="header-popover account-popover"
				role="menu"
			>
				<p>切换账户</p>
				<div
					v-for="account in session.summary?.accounts"
					:key="account.index"
					:class="{ active: account.index === session.summary?.activeAccountIndex }"
					class="account-option"
					role="none"
				>
					<button
						:aria-checked="account.index === session.summary?.activeAccountIndex"
						role="menuitemradio"
						type="button"
						@click="switchAccount(account.index)"
					>
						<span>{{ account.name }}</span>
						<small v-if="account.remark" class="account-option-remark">
							{{ account.remark }}
						</small>
						<code>{{ compact(session.accountAddress(account), 9, 6) }}</code>
					</button>
					<CopyButton
						v-if="session.accountAddress(account)"
						:feedback-key="`account-option-${account.index}`"
						:label="`复制${account.name}的地址`"
						:value="session.accountAddress(account)"
						class="popover-copy-button"
						role="menuitem"
					/>
				</div>
				<button class="popover-manage" role="menuitem" type="button" @click="manageAccounts">
					管理账户 →
				</button>
			</div>
		</div>

		<div class="header-control connection-control">
			<button
				:aria-expanded="openDropdown === 'connection'"
				aria-haspopup="dialog"
				class="connection-trigger"
				type="button"
				@click="toggleDropdown('connection')"
			>
        <span
	        :class="{ connected: home.isCurrentSiteConnected }"
	        class="connection-dot"
        ></span>
				{{ home.isCurrentSiteConnected ? '已连接' : '未连接' }}
			</button>
			<section
				v-if="openDropdown === 'connection'"
				aria-label="网站连接管理"
				class="header-popover connection-popover"
				role="dialog"
			>
				<header>
					<div>
						<p>当前页面</p>
						<strong>{{ home.currentSiteLabel }}</strong>
					</div>
					<span :class="{ connected: home.isCurrentSiteConnected }">
            {{ home.isCurrentSiteConnected ? '已连接' : '未连接' }}
          </span>
				</header>
				<div v-if="home.currentPermission?.accounts.length" class="authorized-accounts">
					<small>授权账户</small>
					<div
						v-for="(address, index) in home.currentPermission.accounts"
						:key="address"
						class="address-line"
					>
						<code :title="address">{{ compact(address, 10, 8) }}</code>
						<CopyButton
							v-if="address"
							:feedback-key="`authorized-${index}-${address}`"
							:value="address"
							label="复制授权账户地址"
						/>
					</div>
				</div>
				<p v-else class="connection-help">
					{{
						home.snapshot.currentOrigin
							? '当前网站尚未获得账户授权。'
							: '请在普通网页中打开钱包以查看连接状态。'
					}}
				</p>
				<div class="site-list">
					<small>所有已授权网站 · {{ home.snapshot.permissions.length }}</small>
					<article v-for="permission in home.snapshot.permissions" :key="permission.origin">
						<div>
							<strong>{{ originHost(permission.origin) }}</strong>
							<code>{{ permission.accounts.length }} 个账户</code>
						</div>
						<button type="button" @click="home.revokePermission(permission.origin)">撤销</button>
					</article>
					<p v-if="!home.snapshot.permissions.length">暂无已授权网站</p>
				</div>
				<p v-if="home.error" class="popover-error">{{ home.error }}</p>
			</section>
		</div>
	</aside>
</template>

<style lang="scss" scoped>
.brand-bar {
	position: relative;
	z-index: 20;
	height: 64px;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0 18px;
	color: #17201d;
	background: #fff;
	border-bottom: 1px solid #e2e8e4;

	strong {
		font-size: 14px;
		letter-spacing: 0.02em;
	}

	span {
		color: #aebddd;
		font: 600 10px/1.2 ui-monospace,
		monospace;
		letter-spacing: 0.18em;
	}

	.header-select span {
		overflow: hidden;
		color: inherit;
		font: 720 11px/1.1 'PingFang SC',
		'Microsoft YaHei',
		system-ui,
		sans-serif;
		letter-spacing: 0;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.current-network {
		span {
			overflow: hidden;
			color: #f4f1e8;
			font: 700 10px/1.15 ui-sans-serif,
			system-ui,
			sans-serif;
			letter-spacing: 0;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		&.empty span {
			color: #91a0bc;
			font-weight: 600;
		}
	}

	.status-dot {
		width: 7px;
		height: 7px;
		flex: 0 0 auto;
		border-radius: 50%;
		background: #71d49b;
		box-shadow: 0 0 0 3px #274469;

		&.locked {
			background: #e8b85c;
		}
	}

	.menu-panel button span {
		color: inherit;
		font: 720 11px/1.25 'PingFang SC',
		'Microsoft YaHei',
		system-ui,
		sans-serif;
		letter-spacing: 0;
	}
}

.brand-mark {
	width: 30px;
	height: 30px;
	display: grid;
	place-items: center;
	border: 1px solid #6884c7;
	color: #fff;
	font: 800 15px/1 ui-monospace,
	monospace;
}

.header-spacer {
	flex: 1;
}

.header-control {
	position: relative;
	min-width: 0;
}

.account-control {
	min-width: 0;
	flex: 1 1 auto;
}

.network-control {
	min-width: 0;
	max-width: 220px;
	flex: 1 1 auto;
	margin-left: auto;
}

.header-select {
	position: relative;
	width: 100%;
	display: grid;
	align-content: center;
	gap: 3px;
	padding: 4px 17px 4px 7px;
	overflow: hidden;
	border: 1px solid #526b98;
	color: #fffdf7;
	background: #1a2b4b;
	text-align: left;

	&:hover,
	&[aria-expanded='true'] {
		border-color: #91a9dd;
		background: #243b63;
	}
}

.header-select code {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.header-select code {
	color: #9eb1d6;
	font: 600 10px/1.1 ui-monospace,
	monospace;
}

.header-select i {
	position: absolute;
	top: 11px;
	right: 5px;
	color: #9eb1d6;
	font: normal 11px/1 ui-monospace,
	monospace;
}

.header-actions {
	position: relative;
	display: flex;
	align-items: center;
	gap: 5px;
	margin-left: auto;
}

.connection-trigger {
	height: 32px;
	display: flex;
	align-items: center;
	gap: 5px;
	padding: 0 7px;
	border: 1px solid transparent;
	color: #bac4d8;
	background: transparent;
	white-space: nowrap;
	font-size: 11px;
	font-weight: 700;

	&:hover,
	&[aria-expanded='true'] {
		border-color: #526b98;
		background: #1a2b4b;
	}
}

.connection-dot {
	width: 7px;
	height: 7px;
	flex: 0 0 auto;
	border-radius: 50%;
	background: #838c9e;
	box-shadow: 0 0 0 3px #283955;

	&.connected {
		background: #71d49b;
	}
}

.header-popover {
	position: absolute;
	z-index: 30;
	top: calc(100% + 8px);
	padding: 8px;
	border: 1px solid #727b8d;
	color: #14213d;
	background: #f4f1e8;
	box-shadow: 4px 4px 0 rgba(13, 25, 48, 0.34);

	> p {
		margin: 2px 7px 7px;
		color: #6d7480;
		font: 700 11px/1.2 ui-monospace,
		monospace;
		letter-spacing: 0.13em;
	}

	> button {
		width: 100%;
		min-height: 43px;
		display: grid;
		gap: 3px;
		padding: 8px 9px 8px 13px;
		border: 0;
		border-top: 1px solid #dedbd2;
		color: #1f2b42;
		background: transparent;
		text-align: left;

		&:hover,
		&:focus-visible {
			background: #e8edfa;
		}

		&.active {
			color: #176b57;
			background: #edf6f2;
			box-shadow: inset 3px 0 #176b57;
		}

		span {
			color: inherit;
			font: 720 11px/1.2 ui-sans-serif,
			system-ui,
			sans-serif;
			letter-spacing: 0;
		}

		code {
			color: #74807b;
			font-size: 10px;
		}

		&.popover-manage {
			min-height: 36px;
			color: #2457d6;
			font-size: 12px;
			font-weight: 750;
		}
	}
}

.connection-popover header p {
	margin: 2px 7px 7px;
	color: #6d7480;
	font: 700 11px/1.2 ui-monospace,
	monospace;
	letter-spacing: 0.13em;
}

.connection-popover {
	right: 0;
	width: 320px;
	padding: 12px;

	header {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 11px;
		border-bottom: 1px solid #d5d2c9;

		p {
			margin: 0 0 4px;
		}

		strong {
			display: block;
			max-width: 210px;
			overflow: hidden;
			color: #14213d;
			font-size: 12px;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		> span {
			align-self: center;
			padding: 4px 6px;
			color: #697180;
			border: 1px solid #b7b8b6;
			background: #ebe9e2;
			font: 700 10px/1 ui-monospace,
			monospace;
			letter-spacing: 0;

			&.connected {
				color: #246b4b;
				border-color: #83b69b;
				background: #e5f4eb;
			}
		}
	}
}

.authorized-accounts {
	display: grid;
	gap: 5px;
	padding: 10px 2px;
}

.authorized-accounts small,
.site-list > small {
	color: #777d88;
	font: 700 11px/1.2 ui-monospace,
	monospace;
}

.authorized-accounts code {
	color: #3f4b60;
	font-size: 10px;
}

.connection-help {
	padding: 10px 2px;
	color: #6f7580;
	font-size: 12px;
	line-height: 1.5;
}

.site-list {
	padding-top: 10px;
	border-top: 1px solid #d5d2c9;

	article {
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		border-bottom: 1px solid #dfdcd3;

		div {
			min-width: 0;
			display: grid;
			gap: 3px;
		}

		strong {
			max-width: 205px;
			overflow: hidden;
			font-size: 12px;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		code {
			color: #787e89;
			font-size: 10px;
		}

		button {
			padding: 5px 7px;
			border: 1px solid #bd8e88;
			color: #9d342c;
			background: #fff5f2;
			font-size: 11px;
			font-weight: 700;
		}
	}

	> p {
		margin: 12px 0 3px;
		color: #858990;
		font-size: 12px;
		text-align: center;
	}
}

.popover-error {
	margin: 8px 0 0 !important;
	color: #a13830 !important;
	letter-spacing: 0 !important;
}

.wallet-context-bar {
	position: relative;
	z-index: 10;
	height: 50px;
	min-height: 58px;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 9px 18px;
	border-bottom: 1px solid #e2e8e4;
	color: #17201d;
	background: #fff;
	box-shadow: inset 0 -1px #f8f5ed;

	.account-control {
		max-width: calc(100% - 84px);
	}

	.header-select {
		height: 36px;
		padding-inline: 10px 24px;
		border-color: #b6b4ad;
		color: #14213d;
		background: #f7f4ec;

		&:hover,
		&[aria-expanded='true'] {
			border-color: #a9c7bc;
			background: #f0f6f3;
		}

		span {
			color: #14213d;
			font: 750 10px/1.1 'PingFang SC',
			'Microsoft YaHei',
			system-ui,
			sans-serif;
			letter-spacing: 0;
		}

		code {
			color: #657086;
			font-size: 10px;
		}

		i {
			top: 11px;
			right: 8px;
			color: #59677f;
		}
	}

	.connection-control {
		flex: 0 0 auto;
	}

	.connection-trigger {
		min-width: 74px;
		height: 34px;
		justify-content: center;
		padding-inline: 8px;
		border-color: transparent;
		color: #4f596b;

		&:hover {
			border-color: #aaa9a4;
			background: #f8f5ed;
		}

		&[aria-expanded='true'] {
			color: #176b57;
			border-color: #a9c7bc;
			background: #edf6f2;
		}
	}

	.connection-dot {
		box-shadow: 0 0 0 3px #d7d7d2;
	}

	.header-popover {
		top: calc(100% + 7px);
	}

	.account-popover {
		left: 0;
		width: min(270px, calc(100vw - 48px));
	}

	:deep(+ .panel) {
		min-height: 446px;
	}
}

.current-network {
	min-width: 0;
	max-width: 112px;
	flex: 1 1 88px;
	display: grid;
	gap: 2px;
	padding: 5px 7px;
	border: 1px solid #526b98;
	background: #1a2b4b;
}

.current-network code {
	overflow: hidden;
	color: #f4f1e8;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.current-network code {
	color: #9eb1d6;
	font: 600 10px/1.15 ui-monospace,
	monospace;
}

.current-network.empty {
	border-color: #465a7d;
	background: #182844;
}

.wallet-menu {
	position: relative;
	display: flex;
}

.menu-trigger {
	width: 32px;
	height: 32px;
	padding: 0 0 5px;
	border: 1px solid #6884c7;
	color: #fffdf7;
	background: #1c3155;
	letter-spacing: 0;

	&:hover,
	&[aria-expanded='true'] {
		border-color: #9db0dc;
		background: #29466f;
		color: #fff;
	}
}

.menu-panel {
	position: absolute;
	z-index: 20;
	top: 44px;
	right: 0;
	width: 230px;
	padding: 7px;
	border: 1px solid #727b8d;
	color: #14213d;
	background: #f4f1e8;
	box-shadow: 4px 4px 0 rgba(13, 25, 48, 0.34);

	&::before {
		content: '';
		position: absolute;
		top: -8px;
		right: 10px;
		width: 20px;
		height: 8px;
		border-inline: 1px solid #dfe7e2;
		background: #fff;
	}

	> p {
		margin: 1px 6px 6px;
		color: #6d7480;
		font: 700 11px/1.2 ui-monospace,
		monospace;
		letter-spacing: 0.14em;
	}

	button {
		width: 100%;
		min-height: 34px;
		display: flex;
		align-items: center;
		padding: 6px 9px;
		border: 0;
		border-top: 1px solid #dedbd2;
		color: #1f2b42;
		background: transparent;
		text-align: left;

		&:hover:not(:disabled),
		&:focus-visible {
			color: #143e9e;
			background: #e8edfa;
		}
	}

	.menu-danger {
		margin-top: 4px;
		border-top-color: #cbb2ad;
		color: #a0443a;
		background: #fff;

		&:hover,
		&:focus-visible {
			color: #812b24;
			background: #fff0ed;
		}
	}
}

.brand-identity {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 9px;

	span {
		color: #17201d;
		font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
		font-size: 14px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
}

.brand-mark {
	width: 32px;
	height: 32px;
	display: block;
	object-fit: contain;
	border: 0;
	border-radius: 10px;
}

.header-spacer {
	min-width: 0;
}

.header-actions {
	margin-left: auto;
}

.header-select {
	min-height: 38px;
	padding: 6px 28px 6px 10px;
	border: 1px solid #e2e8e4;
	border-radius: 10px;
	color: #17201d;
	background: #f8faf8;
}

.header-select:hover,
.header-select[aria-expanded='true'],
.connection-trigger:hover {
	border-color: #a9c7bc;
	background: #f0f6f3;
}

.header-select span {
	font-size: 11px;
	font-weight: 700;
}

.header-select code {
	color: #69736f;
	font-size: 10px;
}

.header-select i {
	right: 10px;
	color: #69736f;
}

.menu-trigger {
	width: 38px;
	height: 38px;
	border: 1px solid #e2e8e4;
	border-radius: 10px;
	color: #43504b;
	background: #f8faf8;
	font-size: 20px;

	&:hover {
		color: #176b57;
		border-color: #a9c7bc;
		background: #edf6f2;
	}

	&[aria-expanded='true'] {
		color: #176b57;
		border-color: #a9c7bc;
		background: #edf6f2;
	}
}

.menu-panel,
.header-popover {
	overflow: hidden;
	border: 1px solid #dfe7e2;
	border-radius: 14px;
	color: #17201d;
	background: #fff;
	box-shadow: 0 14px 36px rgba(29, 48, 42, 0.14);

	> p {
		color: #69736f;
		border-color: #e7ece9;
		font-family: inherit;
		font-size: 11px;
		letter-spacing: 0;
	}

	button {
		color: #25302c;
		background: #fff;
		border-color: #edf0ee;

		&:hover {
			color: #176b57;
			background: #f1f7f4;
		}
	}
}

.connection-trigger {
	min-height: 38px;
	padding: 7px 10px;
	border: 1px solid #e2e8e4;
	border-radius: 10px;
	color: #53605b;
	background: #f8faf8;
}

.connection-trigger[aria-expanded='true'] {
	color: #176b57;
	border-color: #a9c7bc;
	background: #edf6f2;
}

.connection-dot {
	background: #b6bfbb;

	&.connected {
		background: #2f8a6f;
		box-shadow: 0 0 0 3px #e1f1eb;
	}
}

.connection-popover header {
	border-color: #e7ece9;
}

.connection-popover header p,
.site-list small,
.authorized-accounts small {
	color: #69736f;
	font-family: inherit;
	letter-spacing: 0;
}

.connection-popover header span.connected {
	color: #176b57;
	border-color: #a9cdbf;
	background: #e7f3ee;
}

.account-trigger-row {
	min-width: 0;
	width: 100%;
	display: flex;
	align-items: stretch;
	gap: 6px;

	.header-select {
		min-width: 0;
		flex: 1 1 auto;
	}
}

.header-copy-button {
	min-width: 36px;
	min-height: 36px;
}

.account-option {
	min-width: 0;
	display: flex;
	align-items: stretch;
	border-top: 1px solid #edf0ee;

	&.active {
		color: #176b57;
		background: #edf6f2;
		box-shadow: inset 3px 0 #176b57;
	}

	> button:first-child {
		min-width: 0;
		min-height: 44px;
		flex: 1 1 auto;
		display: grid;
		gap: 3px;
		padding: 8px 7px 8px 13px;
		border: 0;
		color: inherit;
		background: transparent;
		text-align: left;

		span,
		small,
		code {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		span {
			font-size: 11px;
			font-weight: 700;
		}

		small {
			color: #69736f;
			font-size: 10px;
			line-height: 1.2;
		}

		code {
			color: #74807b;
			font-size: 10px;
		}

		&:hover,
		&:focus-visible {
			color: #176b57;
			background: #f1f7f4;
		}
	}
}

.popover-copy-button {
	align-self: center;
	margin-right: 8px;
}

.authorized-accounts .address-line {
	padding: 2px 0;

	code {
		flex: 1 1 auto;
	}
}

@media (max-width: 389px) {
	.brand-bar {
		gap: 8px;
		padding-inline: 14px;
	}

	.current-network {
		max-width: 82px;
		padding-inline: 5px;
	}

	.header-actions {
		gap: 10px;
	}

	.wallet-context-bar {
		padding-inline: 14px;

		.connection-popover {
			right: 0;
			left: auto;
			width: min(320px, calc(100vw - 28px));
			max-width: calc(100vw - 28px);
		}

		.account-popover {
			left: 0;
			width: min(270px, calc(100vw - 28px));
			max-width: calc(100vw - 28px);
		}
	}

	.brand-identity {
		gap: 6px;

		span {
			display: inline;
			font-size: 12px;
		}
	}
}

@media (max-width: 359px) {
	.current-network {
		padding-block: 7px;

		code {
			display: none;
		}
	}

	.connection-trigger {
		padding-inline: 8px;
	}
}

.account-popover {
	left: -38px;
	width: 220px;
}

.network-popover {
	left: 0;
	width: 250px;
}

.brand-copy {
	flex: 0 0 auto;
	display: grid;
	gap: 2px;

	strong {
		white-space: nowrap;
	}
}

:global(.expanded .brand-bar),
:global(.expanded .wallet-context-bar) {
	padding-inline: 24px;
}

:global(.expanded .network-control) {
	max-width: 230px;
}
</style>
