<script setup lang="ts">
import {computed} from 'vue'
import type {NativeBalanceSnapshot} from '@/shared/assetMessages'

const props = defineProps<{balance: NativeBalanceSnapshot}>()
defineEmits<{refresh: []}>()

const formattedBalance = computed(() => {
	const raw = props.balance.rawBalance
	const decimals = props.balance.decimals
	if (!decimals) return raw
	const padded = raw.padStart(decimals + 1, '0')
	const whole = padded.slice(0, -decimals) || '0'
	const fraction = padded.slice(-decimals).replace(/0+$/, '').slice(0, 8)
	return fraction ? `${whole}.${fraction}` : whole
})
</script>

<template>
	<section aria-labelledby="native-balance-title" class="native-balance">
		<header>
			<div>
				<h2 id="native-balance-title">链余额</h2>
				<span>原生资产</span>
			</div>
		</header>
		<button class="balance-card" type="button" title="刷新原生余额" @click="$emit('refresh')">
			<span class="balance-mark">{{ balance.symbol.slice(0, 2).toUpperCase() || '?' }}</span>
			<div>
				<strong>{{ balance.symbol }}</strong>
				<small>{{ balance.decimals }} 位小数</small>
			</div>
			<code v-if="balance.refreshState === 'success'">{{ formattedBalance }}</code>
			<small v-else class="balance-error" :title="balance.lastError">读取失败</small>
		</button>
	</section>
</template>

<style scoped lang="scss">
.native-balance {
	padding-top: 16px;

	> header {
		margin-bottom: 8px;

		> div {
			display: flex;
			align-items: baseline;
			gap: 7px;

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
	}

	.balance-card {
		width: 100%;
		min-height: 58px;
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 9px 8px;
		border: 1px solid #cfe0d9;
		border-radius: 10px;
		background: linear-gradient(135deg, #f2f8f5, #fffdf9);
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color .16s ease, box-shadow .16s ease;

		&:hover {
			border-color: #8eb5a6;
		}

		&:focus-visible {
			outline: 3px solid rgba(23, 107, 87, .18);
			outline-offset: 2px;
		}

		.balance-mark {
			width: 34px;
			height: 34px;
			display: grid;
			place-items: center;
			border-radius: 10px;
			color: #fff;
			background: #176b57;
			font: 800 10px ui-monospace, monospace;
		}

		> div {
			min-width: 0;
			display: grid;
			gap: 2px;

			strong {
				font-size: 12px;
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
			font: 750 14px ui-monospace, Consolas, monospace;
			text-overflow: ellipsis;
		}

		.balance-error {
			color: #a54b42;
			font-size: 10px;
			font-weight: 700;
		}
	}
}
</style>
