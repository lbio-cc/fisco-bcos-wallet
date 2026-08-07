<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {storeToRefs} from 'pinia'
import AssetManagementDialog from '@/components/home/AssetManagementDialog.vue'
import AssetNftGallery from '@/components/home/AssetNftGallery.vue'
import AssetNativeBalance from '@/components/home/AssetNativeBalance.vue'
import AssetTokenList from '@/components/home/AssetTokenList.vue'
import {useAssetTrackingStore} from '@/stores/assetTracking'
import {useWalletSessionStore} from '@/stores/walletSession'
import type {AssetSnapshot, TrackedAsset} from '@/shared/assetMessages'

type DisplayAsset = TrackedAsset & {snapshot?: AssetSnapshot}

const store = useAssetTrackingStore()
const session = useWalletSessionStore()
const {snapshot, loading} = storeToRefs(store)
const managerOpen = ref(false)
defineEmits<{
	refreshNative: []
	send: [asset: DisplayAsset, tokenId?: string]
}>()

const erc20Assets = computed(() => snapshot.value.assets.filter((asset) => asset.kind === 'erc20'))
const erc721Assets = computed(() => snapshot.value.assets.filter((asset) => asset.kind === 'erc721'))
const nftCount = computed(() =>
	erc721Assets.value.reduce((sum, asset) => sum + (asset.snapshot?.tokenIds.length ?? 0), 0),
)
const activeAssetContext = computed(() => {
	const network = session.activeNetwork
	const account = session.accountAddress(session.activeAccount)
	if (!network || !account) return ''
	return [
		network.id,
		network.crypto,
		network.chainId,
		network.groupId,
		account.toLowerCase(),
	].join(':')
})

const openManager = (): void => {
	managerOpen.value = true
}

watch(activeAssetContext, () => {
	managerOpen.value = false
})
</script>

<template>
	<section aria-label="资产" class="asset-view">
		<header class="asset-toolbar">
			<div class="asset-title">
				<strong>资产</strong>
				<small>{{ erc20Assets.length }} 种ERC20 · {{ nftCount }} 件ERC721</small>
			</div>
			<button type="button" @click="openManager">管理资产</button>
		</header>

		<div v-if="loading && !snapshot.assets.length" class="asset-loading">
			<span class="spinner"></span>正在读取资产…
		</div>

		<AssetNativeBalance
			v-if="snapshot.nativeBalance"
			:balance="snapshot.nativeBalance"
			@refresh="$emit('refreshNative')"
		/>
		<AssetTokenList :assets="erc20Assets" @manage="openManager" @send="$emit('send', $event)" />
		<AssetNftGallery :assets="erc721Assets" @manage="openManager" @send="(asset, tokenId) => $emit('send', asset, tokenId)" />
		<AssetManagementDialog v-if="managerOpen" @close="managerOpen = false" />
	</section>
</template>

<style scoped lang="scss">
.asset-view {
	min-height: 350px;
	padding: 10px 0 28px;
	color: #26342f;

	.asset-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 2px 13px;
		border-bottom: 1px solid #e3e9e6;

		.asset-title {
			min-width: 0;
			display: flex;
			align-items: baseline;
			gap: 7px;
		}

		strong {
			flex: 0 0 auto;
			font-size: 15px;
		}

		small {
			overflow: hidden;
			color: #74807b;
			font-size: 10px;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		button {
			min-height: 34px;
			padding: 7px 11px;
			border: 1px solid #ccd9d4;
			border-radius: 8px;
			color: #34483f;
			background: #fffdf9;
			font-size: 11px;
			font-weight: 650;
			transition: border-color .16s ease, color .16s ease, background-color .16s ease;

			&:hover {
				border-color: #8eb5a6;
				color: #176b57;
				background: #edf5f1;
			}

			&:focus-visible {
				outline: 3px solid rgba(23, 107, 87, .18);
				outline-offset: 2px;
				border-color: #176b57;
				color: #176b57;
			}
		}
	}

	.asset-loading {
		padding: 30px;
		color: #68766f;
		text-align: center;
		font-size: 11px;

		.spinner {
			margin-right: 7px;
		}
	}
}
</style>
