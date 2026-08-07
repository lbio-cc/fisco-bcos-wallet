<script lang="ts" setup>
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import WalletActivityView from '@/components/home/WalletActivityView.vue'
import WalletAssetsView from '@/components/home/WalletAssetsView.vue'
import AssetReceiveView from '@/components/views/AssetReceiveView.vue'
import AssetSendSelectionView from '@/components/views/AssetSendSelectionView.vue'
import AssetSendView from '@/components/views/AssetSendView.vue'
import {subscribeToAssets} from '@/popup/assetClient'
import {subscribeToSubmittedTransactions} from '@/popup/walletHomeClient'
import {
	NATIVE_BALANCE_MIN_REFRESH_INTERVAL_MS,
	NATIVE_BALANCE_REFRESH_INTERVAL_MS,
} from '@/shared/assetMessages'
import {useAssetTrackingStore} from '@/stores/assetTracking'
import {useWalletHomeStore} from '@/stores/walletHome'
import {useWalletSessionStore} from '@/stores/walletSession'
import type {AssetSnapshot, TrackedAsset} from '@/shared/assetMessages'

type DisplayAsset = TrackedAsset & {snapshot?: AssetSnapshot}

const session = useWalletSessionStore()
const home = useWalletHomeStore()
const assets = useAssetTrackingStore()
const homeTab = ref<'assets' | 'activity'>('assets')
type AssetPage =
	| {mode: 'receive'}
	| {mode: 'select-send'}
	| {mode: 'send'; asset: DisplayAsset; tokenId?: string; fromSelection?: boolean}

const assetPage = ref<AssetPage>()
let interval: number | undefined
let delayedRefresh: number | undefined
let lastNativeRefreshAt = Number.NEGATIVE_INFINITY
let unsubscribeAssets = (): void => undefined
let unsubscribeTransactions = (): void => undefined

const activeAssetContext = computed(() => {
	const network = session.activeNetwork
	const account = session.accountAddress(session.activeAccount)
	if (!network || !account) return ''
	return [network.id, network.crypto, network.chainId, network.groupId, account.toLowerCase()].join(':')
})

const refreshNativeBalance = (): void => {
	const remaining = NATIVE_BALANCE_MIN_REFRESH_INTERVAL_MS - (Date.now() - lastNativeRefreshAt)
	if (remaining > 0) {
		if (delayedRefresh === undefined) {
			delayedRefresh = window.setTimeout(() => {
				delayedRefresh = undefined
				refreshNativeBalance()
			}, remaining)
		}
		return
	}
	lastNativeRefreshAt = Date.now()
	void assets.refreshNative()
}

watch(activeAssetContext, () => {
	if (assetPage.value?.mode === 'send' || assetPage.value?.mode === 'select-send') assetPage.value = undefined
	assets.invalidate()
	void assets.refresh()
	refreshNativeBalance()
}, {immediate: true})

onMounted(() => {
	unsubscribeAssets = subscribeToAssets(() => void assets.refresh())
	unsubscribeTransactions = subscribeToSubmittedTransactions(refreshNativeBalance)
	interval = window.setInterval(refreshNativeBalance, NATIVE_BALANCE_REFRESH_INTERVAL_MS)
})

const openSend = (asset: DisplayAsset, tokenId?: string): void => {
	assetPage.value = {mode: 'send', asset, tokenId}
}

const openSendSelection = (): void => {
	assetPage.value = {mode: 'select-send'}
}

const selectSendAsset = ({asset, tokenId}: {asset: DisplayAsset; tokenId?: string}): void => {
	assetPage.value = {mode: 'send', asset, tokenId, fromSelection: true}
}

const backFromSend = (): void => {
	assetPage.value = assetPage.value?.mode === 'send' && assetPage.value.fromSelection
		? {mode: 'select-send'}
		: undefined
}

const finishSend = (): void => {
	assetPage.value = undefined
	homeTab.value = 'activity'
}

onBeforeUnmount(() => {
	if (interval !== undefined) window.clearInterval(interval)
	if (delayedRefresh !== undefined) window.clearTimeout(delayedRefresh)
	unsubscribeAssets()
	unsubscribeTransactions()
})
</script>

<template>
	<section class="done-page">
		<p v-if="session.summary && !session.summary.backupConfirmed" class="notice">
			助记词备份尚未确认。请勿在未备份时向此地址转入资产。
		</p>
		<section v-if="!assetPage" aria-label="钱包操作" class="wallet-command-bar">
			<nav aria-label="发送与接收" class="wallet-actions">
				<button class="send-action" type="button" @click="openSendSelection">
					<span aria-hidden="true">
						<svg viewBox="0 0 24 24"><path d="m5 19 14-14M9 5h10v10M5 8v11h11"/></svg>
					</span>
					发送
				</button>
				<button class="receive-action" type="button" @click="assetPage = {mode: 'receive'}">
					<span aria-hidden="true">
						<svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M5 19h14"/></svg>
					</span>
					接收
				</button>
			</nav>
		</section>
		<nav v-if="!assetPage" aria-label="钱包内容" class="home-tabs">
			<button
				:aria-current="homeTab === 'assets' ? 'page' : undefined"
				:class="{ active: homeTab === 'assets' }"
				type="button"
				@click="homeTab = 'assets'"
			>
				资产
			</button>
			<button
				:aria-current="homeTab === 'activity' ? 'page' : undefined"
				:class="{ active: homeTab === 'activity' }"
				type="button"
				@click="homeTab = 'activity'"
			>
				活动
				<span v-if="home.currentAccountActivities.length">{{ home.currentAccountActivities.length }}</span>
			</button>
		</nav>

		<AssetReceiveView v-if="assetPage?.mode === 'receive'" @back="assetPage = undefined"/>
		<AssetSendSelectionView v-else-if="assetPage?.mode === 'select-send'" @back="assetPage = undefined" @select="selectSendAsset"/>
		<AssetSendView v-else-if="assetPage?.mode === 'send'" :asset="assetPage.asset" :back-label="assetPage.fromSelection ? '返回选择资产' : '返回资产'" :token-id="assetPage.tokenId" @back="backFromSend" @sent="finishSend"/>
		<WalletAssetsView v-else-if="homeTab === 'assets'" @refresh-native="refreshNativeBalance" @send="openSend"/>
		<WalletActivityView v-else/>
	</section>
</template>

<style lang="scss" scoped>
.done-page .notice {
	margin: 0 0 14px;
}

.done-page {
	min-height: 418px;
}

.wallet-command-bar {
	display: flex;
	justify-content: center;
	margin-bottom: 5px;
	padding: 10px 8px 12px;
	border-block: 1px solid #dce5e1;
	background: linear-gradient(90deg, rgba(237, 245, 241, .82), rgba(255, 253, 249, .45));

	.wallet-actions {
		display: flex;
		gap: 11px;

		button {
			min-width: 48px;
			display: grid;
			justify-items: center;
			gap: 4px;
			padding: 0 2px;
			border: 0;
			color: #26342f;
			background: transparent;
			font-size: 10px;
			font-weight: 750;

			> span {
				width: 38px;
				height: 38px;
				display: grid;
				place-items: center;
				border: 1px solid #176b57;
				border-radius: 50%;
				color: #fff;
				background: #176b57;
				box-shadow: 0 4px 10px rgba(23, 107, 87, .14);
				transition: transform .16s ease, box-shadow .16s ease, background-color .16s ease;

				svg {
					width: 18px;
					height: 18px;
					fill: none;
					stroke: currentColor;
					stroke-linecap: round;
					stroke-linejoin: round;
					stroke-width: 1.8;
				}
			}

			&.receive-action > span {
				color: #176b57;
				background: #fffdf9;
				box-shadow: inset 0 0 0 3px #edf5f1;
			}

			&:hover > span {
				box-shadow: 0 6px 14px rgba(23, 107, 87, .22);
				transform: translateY(-1px);
			}

			&.send-action:hover > span {
				background: #105b49;
			}

			&.receive-action:hover > span {
				background: #edf5f1;
			}

			&:focus-visible {
				outline: 0;

				> span {
					outline: 3px solid rgba(23, 107, 87, .2);
					outline-offset: 3px;
				}
			}
		}
	}
}

.home-tabs {
	display: flex;
	gap: 26px;
	border-bottom: 1px solid #dce4e0;

	button {
		position: relative;
		min-height: 42px;
		padding: 0 2px;
		border: 0;
		color: #74807b;
		background: transparent;
		font-size: 13px;
		font-weight: 750;

		&::after {
			content: '';
			position: absolute;
			right: 0;
			bottom: -1px;
			left: 0;
			height: 2px;
			background: transparent;
		}

		&.active {
			color: #176b57;

			&::after {
				background: #176b57;
			}
		}

		span {
			display: inline-grid;
			min-width: 17px;
			height: 17px;
			margin-left: 4px;
			place-items: center;
			color: #fff;
			border-radius: 6px;
			background: #176b57;
			font: 700 10px/1 ui-monospace, monospace;
		}
	}
}
</style>
