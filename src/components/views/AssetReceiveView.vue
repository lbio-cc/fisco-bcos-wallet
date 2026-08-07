<script setup lang="ts">
import {computed, onMounted} from 'vue'
import {storeToRefs} from 'pinia'
import CopyButton from '@/components/common/CopyButton.vue'
import QrcodeVue from 'qrcode.vue'
import {useNetworkManagementStore} from '@/stores/networkManagement'
import {useWalletSessionStore} from '@/stores/walletSession'

defineEmits<{back: []}>()
const session = useWalletSessionStore()
const networks = useNetworkManagementStore()
const {savedNetworks, busy, error} = storeToRefs(networks)
const address = computed(() => session.accountAddress(session.activeAccount))
const chainDetail = computed(() => {
	const network = session.activeNetwork
	if (!network) return '未选择链'
	return network.mode === 'legacy'
		? `Group ${network.groupId ?? '—'} · Chain ${network.chainId}`
		: `Chain ID ${network.chainId}`
})

onMounted(() => void networks.refresh())
</script>

<template>
	<section class="receive-page">
		<button class="back" type="button" @click="$emit('back')">← 返回首页</button>
		<header>
			<p>接收资产</p>
			<h1>我的接收地址</h1>
			<small>选择网络后，可复制地址或扫描二维码</small>
		</header>
		<label>
			<span>选择链</span>
			<select :disabled="busy" :value="session.activeNetwork?.id" @change="networks.switchTo(($event.target as HTMLSelectElement).value)">
				<option v-for="network in savedNetworks" :key="network.id" :value="network.id">{{ network.name }}</option>
			</select>
		</label>
		<div class="chain-card">
			<strong>{{ session.activeNetwork?.name ?? '未选择网络' }}</strong>
			<small>{{ chainDetail }}</small>
		</div>
		<div v-if="address" :aria-label="`${session.activeNetwork?.name ?? ''} 收款地址二维码`" class="qr-code" role="img">
			<QrcodeVue :margin="2" :size="196" :value="address" level="M" render-as="svg"/>
		</div>
		<div class="address-card">
			<small>接收地址</small>
			<code>{{ address }}</code>
			<CopyButton v-if="address" :value="address" feedback-key="asset-receive-address" label="复制接收地址"/>
		</div>
		<p v-if="error" class="error" role="alert">{{ error }}</p>
		<p class="warning">请确认发送方选择相同的链与 Group。跨链转入可能导致资产无法找回。</p>
	</section>
</template>

<style scoped lang="scss">
.receive-page {
	display: grid;
	justify-items: stretch;
	gap: 14px;

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

	> label {
		display: grid;
		gap: 6px;
		font-size: 11px;
		font-weight: 700;

		select {
			min-height: 42px;
			padding: 0 11px;
			border: 1px solid #ccd9d4;
			border-radius: 9px;
			background: #fff;
		}
	}

	.chain-card,
	.address-card {
		display: grid;
		gap: 5px;
		padding: 12px;
		border: 1px solid #dce5e1;
		border-radius: 10px;
		background: #fff;

		small {
			color: #718078;
			font-size: 10px;
		}
	}

	.qr-code {
		justify-self: center;
		padding: 6px;
		border: 1px solid #dce5e1;
		border-radius: 12px;
		background: #fff;

		:deep(svg) {
			display: block;
		}
	}

	.address-card {
		grid-template-columns: minmax(0, 1fr) auto;

		small,
		code {
			grid-column: 1;
		}

		code {
			overflow-wrap: anywhere;
			font-size: 11px;
		}

		:deep(button) {
			grid-column: 2;
			grid-row: 1 / 3;
			align-self: center;
		}
	}

	.warning,
	.error {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
	}

	.warning {
		color: #87652a;
	}
}
</style>
