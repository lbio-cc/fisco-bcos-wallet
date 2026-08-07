<script setup lang="ts">
import {computed, reactive, ref} from 'vue'
import {storeToRefs} from 'pinia'
import {
	effectiveAssetName,
	effectiveAssetSymbol,
	resolveAssetChainKey,
	type AssetSnapshot,
	type TrackedAsset,
} from '@/shared/assetMessages'
import {useAssetTrackingStore} from '@/stores/assetTracking'

type DisplayAsset = TrackedAsset & {snapshot?: AssetSnapshot}
const props = defineProps<{assets: DisplayAsset[]}>()
defineEmits<{
	manage: []
	send: [asset: DisplayAsset, tokenId: string]
}>()
const store = useAssetTrackingStore()
const {metadataActions, metadataErrors} = storeToRefs(store)

const mode = ref<'grouped' | 'flat'>('flat')
const failedImages = reactive<Record<string, boolean>>({})
const count = computed(() =>
	props.assets.reduce((sum, asset) => sum + (asset.snapshot?.tokenIds.length ?? 0), 0),
)
const flatNfts = computed(() =>
	props.assets.flatMap((asset) =>
		(asset.snapshot?.tokenIds ?? []).map((tokenId) => ({asset, tokenId})),
	),
)
const imageFailed = (asset: TrackedAsset, tokenId: string): boolean =>
	!!failedImages[`${asset.contract}:${tokenId}`]
const metadataKey = (asset: TrackedAsset, tokenId: string): string =>
	store.metadataActionKey(asset.contract, tokenId)
const refreshMetadata = (asset: TrackedAsset, tokenId: string): void => {
	const chainKey = resolveAssetChainKey(asset)
	if (!chainKey) return
	void store.refreshNftMetadata(asset.contract, chainKey, tokenId)
}
</script>

<template>
	<section class="nft-section" aria-labelledby="erc721-title">
		<header class="nft-heading">
			<div><span>ERC721</span></div>
			<div class="view-toggle" aria-label="ERC721显示方式">
				<button :aria-pressed="mode === 'flat'" type="button" @click="mode = 'flat'">全部</button>
				<button :aria-pressed="mode === 'grouped'" type="button" @click="mode = 'grouped'">系列</button>
			</div>
		</header>

		<div v-if="!count" class="nft-empty">
			<div class="cabinet-mark"><i></i><span>#</span></div>
			<strong>{{ assets.length ? '当前账户尚未持有ERC721' : '还未添加ERC721合约' }}</strong>
			<small>添加ERC721合约后，ERC721会直接陈列在这里。</small>
			<button type="button" @click="$emit('manage')">管理ERC721合约</button>
		</div>

		<div v-else-if="mode === 'grouped'" class="collection-groups">
			<section v-for="asset in assets" :key="asset.contract" v-show="asset.snapshot?.tokenIds.length">
				<header>
					<div>
						<strong>{{ effectiveAssetName(asset) }}</strong>
						<small>{{ effectiveAssetSymbol(asset) }} · {{ asset.snapshot?.tokenIds.length ?? 0 }} 件</small>
					</div>
					<code :title="asset.contract">{{ asset.contract.slice(0, 8) }}…{{ asset.contract.slice(-5) }}</code>
				</header>
				<div class="nft-grid">
					<article v-for="tokenId in asset.snapshot?.tokenIds" :key="tokenId" class="nft-card">
						<div class="nft-art">
							<img
								v-if="asset.snapshot?.metadata[tokenId]?.image && !imageFailed(asset, tokenId)"
								:alt="asset.snapshot.metadata[tokenId]?.name || `${effectiveAssetName(asset)} #${tokenId}`"
								:src="asset.snapshot.metadata[tokenId]?.image"
								loading="lazy"
								@error="failedImages[`${asset.contract}:${tokenId}`] = true"
							/>
							<span v-else><i></i>#{{ tokenId }}</span>
							<button
								:aria-label="`刷新 ERC721 #${tokenId} metadata`"
								:disabled="metadataActions[metadataKey(asset, tokenId)]"
								:title="`刷新 ERC721 #${tokenId} metadata`"
								class="metadata-refresh"
								type="button"
								@click.stop="refreshMetadata(asset, tokenId)"
							>
								<svg :class="{spinning: metadataActions[metadataKey(asset, tokenId)]}" aria-hidden="true" viewBox="0 0 24 24">
									<path d="M20 6v5h-5M4 18v-5h5M6.1 9A7 7 0 0 1 18 6l2 2M17.9 15A7 7 0 0 1 6 18l-2-2" />
								</svg>
							</button>
						</div>
						<div class="nft-details">
							<strong>{{ asset.snapshot?.metadata[tokenId]?.name || `Token #${tokenId}` }}</strong>
							<small>#{{ tokenId }}</small>
						</div>
						<div class="nft-actions">
							<button type="button" @click="$emit('send', asset, tokenId)">发送</button>
						</div>
						<p
							v-if="metadataErrors[metadataKey(asset, tokenId)]"
							class="metadata-error"
							role="alert"
						>
							{{ metadataErrors[metadataKey(asset, tokenId)] }}
						</p>
					</article>
				</div>
			</section>
		</div>

		<div v-else class="nft-grid flat-grid">
			<article v-for="{asset, tokenId} in flatNfts" :key="`${asset.contract}:${tokenId}`" class="nft-card">
				<div class="nft-art">
					<img
						v-if="asset.snapshot?.metadata[tokenId]?.image && !imageFailed(asset, tokenId)"
						:alt="asset.snapshot.metadata[tokenId]?.name || `${effectiveAssetName(asset)} #${tokenId}`"
						:src="asset.snapshot.metadata[tokenId]?.image"
						loading="lazy"
						@error="failedImages[`${asset.contract}:${tokenId}`] = true"
					/>
					<span v-else><i></i>#{{ tokenId }}</span>
					<button
						:aria-label="`刷新 ERC721 #${tokenId} metadata`"
						:disabled="metadataActions[metadataKey(asset, tokenId)]"
						:title="`刷新 ERC721 #${tokenId} metadata`"
						class="metadata-refresh"
						type="button"
						@click.stop="refreshMetadata(asset, tokenId)"
					>
						<svg :class="{spinning: metadataActions[metadataKey(asset, tokenId)]}" aria-hidden="true" viewBox="0 0 24 24">
							<path d="M20 6v5h-5M4 18v-5h5M6.1 9A7 7 0 0 1 18 6l2 2M17.9 15A7 7 0 0 1 6 18l-2-2" />
						</svg>
					</button>
				</div>
				<div class="nft-details">
					<strong>{{ asset.snapshot?.metadata[tokenId]?.name || `Token #${tokenId}` }}</strong>
					<small>{{ effectiveAssetName(asset) }} · #{{ tokenId }}</small>
				</div>
				<div class="nft-actions">
					<button type="button" @click="$emit('send', asset, tokenId)">发送</button>
				</div>
				<p
					v-if="metadataErrors[metadataKey(asset, tokenId)]"
					class="metadata-error"
					role="alert"
				>
					{{ metadataErrors[metadataKey(asset, tokenId)] }}
				</p>
			</article>
		</div>
	</section>
</template>

<style scoped lang="scss">
.nft-section {
	padding-top: 20px;

	.nft-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 8px;

		> div:first-child {
			display: flex;
			align-items: baseline;
			gap: 7px;
		}

		h2 {
			margin: 0;
			font-size: 12px;
		}

		span {
			color: #7b8882;
			font-size: 9px;
			font-weight: 750;
			letter-spacing: .08em;
		}
	}

	.view-toggle {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 2px;
		border: 1px solid #ccd9d4;
		border-radius: 7px;
		background: #eef3f0;

		button {
			min-height: 25px;
			padding: 3px 8px;
			border: 0;
			border-radius: 5px;
			color: #6b7872;
			background: transparent;
			font-size: 9px;

			&[aria-pressed="true"] {
				color: #fff;
				background: #176b57;
				box-shadow: 0 1px 3px rgba(23, 107, 87, .2);
			}

			&:focus-visible {
				outline: 3px solid rgba(23, 107, 87, .18);
				outline-offset: 2px;
			}
		}
	}

	.nft-empty {
		min-height: 160px;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 6px;
		border: 1px dashed #b9ccc4;
		background: repeating-linear-gradient(-45deg, #fbfcfa, #fbfcfa 8px, #f7f9f6 8px, #f7f9f6 16px);
		text-align: center;

		strong {
			font-size: 12px;
		}

		small {
			max-width: 255px;
			color: #718078;
			font-size: 10px;
			line-height: 1.45;
		}

		button {
			border: 0;
			color: #176b57;
			background: transparent;
			font-size: 10px;
			font-weight: 750;
		}
	}

	.cabinet-mark {
		width: 40px;
		height: 40px;
		position: relative;
		display: grid;
		place-items: center;
		overflow: hidden;
		border: 1px solid #acc5ba;
		border-radius: 8px;
		color: #176b57;
		background: #e7f0eb;
		font: 800 11px ui-monospace, monospace;

		i {
			position: absolute;
			inset: -30%;
			opacity: .32;
			background: repeating-conic-gradient(#b9ccc3 0 25%, #e8efeb 0 50%) 0/18px 18px;
			transform: rotate(8deg);
		}

		span {
			isolation: isolate;
		}
	}

	.collection-groups {
		display: grid;
		gap: 17px;

		> section > header {
			display: flex;
			align-items: end;
			justify-content: space-between;
			gap: 10px;
			margin-bottom: 7px;
			padding: 0 2px;

			> div {
				min-width: 0;
				display: grid;
				gap: 2px;
			}

			strong {
				overflow: hidden;
				font-size: 11px;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			small,
			code {
				color: #718078;
				font-size: 9px;
			}

			> button {
				padding: 4px 8px;
				border: 1px solid #c7d9d1;
				border-radius: 6px;
				color: #176b57;
				background: #f6faf8;
				font-size: 9px;
			}
		}
	}

	.nft-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.nft-card {
		min-width: 0;
		overflow: hidden;
		border: 1px solid #dce5e1;
		border-radius: 9px;
		background: #fffdf9;
		box-shadow: 0 4px 12px rgba(40, 68, 58, .04);

		.nft-art {
			aspect-ratio: 1;
			position: relative;
			overflow: hidden;
			background: #e8efeb;

			img {
				width: 100%;
				height: 100%;
				display: block;
				object-fit: cover;
			}

			> span {
				width: 100%;
				height: 100%;
				position: relative;
				display: grid;
				place-items: center;
				overflow: hidden;
				isolation: isolate;
				color: #607168;
				font: 750 11px ui-monospace, monospace;
			}

			i {
				position: absolute;
				z-index: -1;
				inset: -30%;
				opacity: .32;
				background: repeating-conic-gradient(#b9ccc3 0 25%, #e8efeb 0 50%) 0/18px 18px;
				transform: rotate(8deg);
			}

			.metadata-refresh {
				width: 29px;
				height: 29px;
				position: absolute;
				top: 7px;
				right: 7px;
				display: grid;
				place-items: center;
				padding: 0;
				border: 1px solid rgba(255, 253, 249, .78);
				border-radius: 50%;
				color: #fffdf9;
				background: rgba(20, 73, 60, .82);
				box-shadow: 0 2px 8px rgba(20, 49, 40, .24);
				backdrop-filter: blur(4px);
				transition: background-color .16s ease, box-shadow .16s ease, transform .16s ease;

				svg {
					width: 15px;
					height: 15px;
					fill: none;
					stroke: currentColor;
					stroke-linecap: round;
					stroke-linejoin: round;
					stroke-width: 2;

					&.spinning {
						animation: metadata-spin .75s linear infinite;
					}
				}

				&:hover:not(:disabled) {
					background: #176b57;
					box-shadow: 0 3px 10px rgba(23, 107, 87, .38);
					transform: translateY(-1px);
				}

				&:focus-visible {
					outline: 3px solid rgba(255, 253, 249, .9);
					outline-offset: 2px;
					background: #176b57;
					box-shadow: 0 0 0 5px rgba(23, 107, 87, .35);
				}

				&:disabled {
					cursor: progress;
					opacity: .78;
				}
			}
		}

		.nft-details {
			min-width: 0;
			display: grid;
			gap: 3px;
			padding: 8px;

			strong,
			small {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			strong {
				font-size: 10px;
			}

			small {
				color: #758079;
				font-size: 9px;
			}
		}

		.metadata-error {
			margin: -3px 8px 8px;
			color: #9d4b43;
			font-size: 9px;
			line-height: 1.35;
		}

		.nft-actions {
			width: calc(100% - 16px);
			display: grid;
			gap: 5px;
			margin: 0 8px 8px;

			button {
				padding: 5px;
				border: 1px solid #c7d9d1;
				border-radius: 6px;
				color: #176b57;
				background: #f6faf8;
				font-size: 9px;
			}
		}
	}
}

@keyframes metadata-spin {
	to {
		transform: rotate(360deg);
	}
}

@media (min-width: 620px) {
	.nft-section {
		.nft-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
}
</style>
