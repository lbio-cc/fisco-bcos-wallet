<script setup lang="ts">
import {effectiveAssetName, effectiveAssetSymbol, type AssetSnapshot, type TrackedAsset} from '@/shared/assetMessages'

type DisplayAsset = TrackedAsset & {snapshot?: AssetSnapshot}
defineProps<{assets: DisplayAsset[]}>()
defineEmits<{manage: []; send: [asset: DisplayAsset]}>()

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
	<section class="token-section" aria-labelledby="erc20-title">
		<header>
			<div><span>ERC20</span></div>
			<small>{{ assets.length }}</small>
		</header>
		<div v-if="!assets.length" class="token-empty">
			<span>还没有跟踪ERC20</span>
			<button type="button" @click="$emit('manage')">添加</button>
		</div>
		<ul v-else>
			<li v-for="asset in assets" :key="asset.contract">
				<span class="token-mark">{{ effectiveAssetSymbol(asset).slice(0, 2).toUpperCase() || '?' }}</span>
				<div>
					<strong>{{ effectiveAssetName(asset) }}</strong>
					<small>{{ effectiveAssetSymbol(asset) }}</small>
				</div>
				<div class="token-actions">
					<code>{{ balance(asset) }}</code>
					<span>
						<button type="button" @click="$emit('send', asset)">发送</button>
					</span>
				</div>
			</li>
		</ul>
	</section>
</template>

<style scoped lang="scss">
.token-section {
	padding-top: 16px;

	> header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 8px;

		> div {
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

		> small {
			color: #176b57;
			font: 700 10px ui-monospace, monospace;
		}
	}

	> ul {
		margin: 0;
		padding: 0;
		border-block: 1px solid #dce5e1;
		list-style: none;
		background: #fffdf9;

		li {
			min-height: 54px;
			display: grid;
			grid-template-columns: 34px minmax(0, 1fr) auto;
			align-items: center;
			gap: 10px;
			padding: 7px 5px;
			border-bottom: 1px solid #edf0ee;

			&:last-child {
				border-bottom: 0;
			}

			> div {
				min-width: 0;
				display: grid;
				gap: 2px;

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
					color: #758079;
					font-size: 10px;
				}
			}

			code {
				max-width: 145px;
				overflow: hidden;
				color: #18251f;
				font: 750 13px ui-monospace, Consolas, monospace;
				text-overflow: ellipsis;
			}

			.token-actions {
				display: grid;
				justify-items: end;
				gap: 5px;

				> span {
					display: flex;
					gap: 5px;

					button {
						padding: 3px 7px;
						border: 1px solid #c7d9d1;
						border-radius: 6px;
						color: #176b57;
						background: #f6faf8;
						font-size: 9px;
					}
				}
			}
		}
	}

	.token-mark {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border: 1px solid #c7d9d1;
		border-radius: 50%;
		color: #176b57;
		background: #edf5f1;
		font: 800 10px ui-monospace, monospace;
	}

	.token-empty {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 12px;
		border: 1px dashed #c4d2cc;
		color: #718078;
		background: #fafbf8;
		font-size: 10px;

		button {
			border: 0;
			color: #176b57;
			background: transparent;
			font-size: 10px;
			font-weight: 750;

			&:focus-visible {
				outline: 3px solid rgba(23, 107, 87, .18);
				outline-offset: 2px;
			}
		}
	}
}
</style>
