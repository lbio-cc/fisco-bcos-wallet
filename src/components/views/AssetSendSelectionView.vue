<script setup lang="ts">
import {computed} from 'vue'
import {storeToRefs} from 'pinia'
import {effectiveAssetName, effectiveAssetSymbol, type AssetSnapshot, type TrackedAsset} from '@/shared/assetMessages'
import {useAssetTrackingStore} from '@/stores/assetTracking'

type DisplayAsset = TrackedAsset & {snapshot?: AssetSnapshot}
type SendChoice = {asset: DisplayAsset; tokenId?: string}

const emit = defineEmits<{back: []; select: [choice: SendChoice]}>()
const assets = useAssetTrackingStore()
const {snapshot, loading, error} = storeToRefs(assets)

const erc20Assets = computed(() => snapshot.value.assets.filter((asset) => asset.kind === 'erc20'))
const nftChoices = computed(() =>
	snapshot.value.assets
		.filter((asset) => asset.kind === 'erc721')
		.flatMap((asset) => (asset.snapshot?.tokenIds ?? []).map((tokenId) => ({asset, tokenId}))),
)
const hasChoices = computed(() => erc20Assets.value.length > 0 || nftChoices.value.length > 0)

const balance = (asset: DisplayAsset): string => {
	const raw = asset.snapshot?.rawBalance ?? '0'
	const decimals = asset.decimals ?? 0
	if (!decimals) return raw
	const padded = raw.padStart(decimals + 1, '0')
	const whole = padded.slice(0, -decimals) || '0'
	const fraction = padded.slice(-decimals).replace(/0+$/, '').slice(0, 8)
	return fraction ? `${whole}.${fraction}` : whole
}
</script>

<template>
	<section class="send-selection">
		<button class="back" type="button" @click="$emit('back')">← 返回首页</button>
		<header>
			<p>发送资产</p>
			<h1>选择要发送的资产</h1>
			<small>仅显示当前账户在当前网络中的资产</small>
		</header>

		<div v-if="loading && !hasChoices" class="status" aria-live="polite">
			<span class="spinner"></span>正在读取资产…
		</div>
		<p v-else-if="error && !hasChoices" class="status error" role="alert">{{ error }}</p>
		<div v-else-if="!hasChoices" class="empty-state">
			<span class="empty-mark" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="M5 12h12M13 8l4 4-4 4M5 7v10"/></svg>
			</span>
			<strong>没有可发送的资产</strong>
			<small>请先在资产页添加 ERC20，或确认当前账户持有 ERC721。</small>
		</div>

		<template v-else>
			<section v-if="erc20Assets.length" class="choice-group" aria-labelledby="send-erc20-title">
				<h2 id="send-erc20-title">ERC20</h2>
				<button
					v-for="asset in erc20Assets"
					:key="asset.contract"
					class="asset-choice"
					type="button"
					@click="emit('select', {asset})"
				>
					<span class="asset-mark">{{ effectiveAssetSymbol(asset).slice(0, 2).toUpperCase() || '?' }}</span>
					<span class="asset-copy">
						<strong>{{ effectiveAssetName(asset) }}</strong>
						<small>{{ balance(asset) }} {{ effectiveAssetSymbol(asset) }}</small>
					</span>
					<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
				</button>
			</section>

			<section v-if="nftChoices.length" class="choice-group" aria-labelledby="send-erc721-title">
				<h2 id="send-erc721-title">ERC721</h2>
				<button
					v-for="{asset, tokenId} in nftChoices"
					:key="`${asset.contract}:${tokenId}`"
					class="asset-choice"
					type="button"
					@click="emit('select', {asset, tokenId})"
				>
					<span class="asset-mark nft">#</span>
					<span class="asset-copy">
						<strong>{{ asset.snapshot?.metadata[tokenId]?.name || `${effectiveAssetName(asset)} #${tokenId}` }}</strong>
						<small>{{ effectiveAssetSymbol(asset) }} · Token #{{ tokenId }}</small>
					</span>
					<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
				</button>
			</section>
		</template>
	</section>
</template>

<style scoped lang="scss">
.send-selection {
	display: grid;
	gap: 16px;
	padding-bottom: 24px;
	color: #26342f;

	.back {
		justify-self: start;
		padding: 0;
		border: 0;
		color: #176b57;
		background: transparent;
		font-weight: 700;
	}

	> header {
		display: grid;
		gap: 4px;

		p,
		h1 {
			margin: 0;
		}

		p,
		small {
			color: #718078;
			font-size: 10px;
		}

		h1 {
			font-size: 20px;
		}
	}

	.status,
	.empty-state {
		min-height: 180px;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 8px;
		margin: 0;
		border: 1px dashed #c4d2cc;
		color: #718078;
		background: #fafbf8;
		font-size: 11px;
		text-align: center;

		&.error {
			color: #9d4b43;
		}
	}

	.empty-state {
		strong {
			color: #26342f;
			font-size: 13px;
		}

		small {
			max-width: 250px;
			line-height: 1.5;
		}

		.empty-mark {
			width: 44px;
			height: 44px;
			display: grid;
			place-items: center;
			border: 1px solid #b8cec5;
			border-radius: 50%;
			color: #176b57;
			background: #edf5f1;

			svg {
				width: 22px;
				fill: none;
				stroke: currentColor;
				stroke-linecap: round;
				stroke-linejoin: round;
				stroke-width: 1.8;
			}
		}
	}

	.choice-group {
		display: grid;
		gap: 0;
		border-block: 1px solid #dce5e1;
		background: #fffdf9;

		h2 {
			margin: 0;
			padding: 8px 4px;
			border-bottom: 1px solid #e7ece9;
			color: #718078;
			font-size: 10px;
			letter-spacing: .08em;
		}

		.asset-choice {
			min-height: 58px;
			display: grid;
			grid-template-columns: 34px minmax(0, 1fr) 18px;
			align-items: center;
			gap: 10px;
			padding: 8px 5px;
			border: 0;
			border-bottom: 1px solid #edf0ee;
			color: inherit;
			background: transparent;
			text-align: left;
			transition: background-color .16s ease;

			&:last-child {
				border-bottom: 0;
			}

			&:hover {
				background: #f1f7f4;
			}

			&:focus-visible {
				position: relative;
				z-index: 1;
				outline: 3px solid rgba(23, 107, 87, .2);
				outline-offset: -2px;
			}

			> svg {
				width: 17px;
				fill: none;
				stroke: #819089;
				stroke-linecap: round;
				stroke-linejoin: round;
				stroke-width: 1.8;
			}
		}

		.asset-mark {
			width: 32px;
			height: 32px;
			display: grid;
			place-items: center;
			border: 1px solid #c7d9d1;
			border-radius: 50%;
			color: #176b57;
			background: #edf5f1;
			font: 800 10px ui-monospace, monospace;

			&.nft {
				border-radius: 8px;
			}
		}

		.asset-copy {
			min-width: 0;
			display: grid;
			gap: 3px;

			strong,
			small {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			strong {
				font-size: 11px;
			}

			small {
				color: #718078;
			font-size: 10px;
			}
		}
	}
}
</style>
