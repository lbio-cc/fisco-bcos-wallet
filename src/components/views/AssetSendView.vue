<script setup lang="ts">
import {computed, ref} from 'vue'
import {effectiveAssetName, effectiveAssetSymbol, resolveAssetChainKey, type AssetSnapshot, type TrackedAsset} from '@/shared/assetMessages'
import {sendAsset} from '@/popup/assetClient'
import {useAssetTrackingStore} from '@/stores/assetTracking'
import {useWalletSessionStore} from '@/stores/walletSession'

type DisplayAsset = TrackedAsset & {snapshot?: AssetSnapshot}
const props = withDefaults(defineProps<{asset: DisplayAsset; tokenId?: string; backLabel?: string}>(), {
	backLabel: '返回资产',
})
const emit = defineEmits<{back: []; sent: []}>()
const session = useWalletSessionStore()
const assets = useAssetTrackingStore()
const recipient = ref('')
const amount = ref('')
const busy = ref(false)
const error = ref('')
const transactionHash = ref('')
const available = computed(() => {
	if (props.asset.kind !== 'erc20') return undefined
	const raw = props.asset.snapshot?.rawBalance ?? '0'
	const decimals = props.asset.decimals ?? 0
	if (!decimals) return raw
	const padded = raw.padStart(decimals + 1, '0')
	const whole = padded.slice(0, -decimals) || '0'
	const fraction = padded.slice(-decimals).replace(/0+$/, '')
	return fraction ? `${whole}.${fraction}` : whole
})

const submit = async (): Promise<void> => {
	error.value = ''
	transactionHash.value = ''
	const chainKey = resolveAssetChainKey(props.asset)
	if (!chainKey) return void (error.value = '资产缺少链标识，请刷新后重试')
	busy.value = true
	try {
		const result = await sendAsset(props.asset.contract, chainKey, recipient.value, props.asset.kind === 'erc20'
			? {amount: amount.value}
			: {tokenId: props.tokenId})
		transactionHash.value = result.transactionHash
		await assets.runAction('refresh', props.asset.contract, chainKey)
		emit('sent')
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : '资产发送失败'
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<section class="send-page">
		<button class="back" type="button" @click="$emit('back')">← {{ backLabel }}</button>
		<header>
			<p>发送 {{ asset.kind.toUpperCase() }}</p>
			<h1>{{ effectiveAssetName(asset) }}</h1>
			<small>{{ session.activeNetwork?.name }} · {{ effectiveAssetSymbol(asset) }}<template v-if="tokenId"> · #{{ tokenId }}</template></small>
		</header>
		<form @submit.prevent="submit">
			<label>
				<span>目标地址</span>
				<input v-model.trim="recipient" :disabled="busy" autocomplete="off" placeholder="0x…" required spellcheck="false"/>
			</label>
			<label v-if="asset.kind === 'erc20'">
				<span>数量</span>
				<input v-model.trim="amount" :disabled="busy" inputmode="decimal" placeholder="0.0" required/>
				<small>可用余额 {{ available }} {{ effectiveAssetSymbol(asset) }}</small>
			</label>
			<div v-else class="nft-summary">
				<span>Token ID</span>
				<strong>#{{ tokenId }}</strong>
			</div>
			<p v-if="error" class="error" role="alert">{{ error }}</p>
			<p v-if="transactionHash" class="success">已提交：<code>{{ transactionHash }}</code></p>
			<button :disabled="busy" class="submit" type="submit">{{ busy ? '等待确认…' : '检查并发送' }}</button>
		</form>
		<p class="warning">提交后仍需在交易确认窗口中核对合约、目标链与地址。</p>
	</section>
</template>

<style scoped lang="scss">
.send-page {
	display: grid;
	gap: 16px;

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

	> form {
		display: grid;
		gap: 14px;

		label,
		.nft-summary {
			display: grid;
			gap: 6px;
			font-size: 11px;
			font-weight: 700;
		}

		input {
			min-height: 44px;
			padding: 0 12px;
			border: 1px solid #ccd9d4;
			border-radius: 9px;
			background: #fff;
			font: 12px ui-monospace, monospace;
		}

		label small {
			color: #718078;
			font-size: 9px;
			font-weight: 500;
		}

		.nft-summary {
			padding: 13px;
			border: 1px solid #dce5e1;
			border-radius: 9px;
			background: #fff;

			strong {
				font: 700 15px ui-monospace, monospace;
			}
		}

		.submit {
			min-height: 44px;
			border: 0;
			border-radius: 9px;
			color: #fff;
			background: #176b57;
			font-weight: 750;
		}

		.error,
		.success {
			margin: 0;
			font-size: 10px;
		}

		.success code {
			overflow-wrap: anywhere;
		}
	}

	.warning {
		margin: 0;
		color: #87652a;
		font-size: 10px;
		line-height: 1.5;
	}
}
</style>
