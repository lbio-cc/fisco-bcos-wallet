<script lang="ts" setup>
import WalletHeader from '@/components/layout/WalletHeader.vue'
import WalletHomeView from '@/components/home/WalletHomeView.vue'
import AccountManagementView from '@/components/views/AccountManagementView.vue'
import NetworkManagementView from '@/components/views/NetworkManagementView.vue'
import SecretExportView from '@/components/views/SecretExportView.vue'
import WalletAccessFlow from '@/components/views/WalletAccessFlow.vue'
import {provideWalletController} from '@/composables/useWalletController'

const {expanded, view, accessView} = provideWalletController()
</script>

<template>
	<div :class="{ expanded }" class="wallet-shell">
		<WalletHeader/>

		<main aria-live="polite" class="panel">
			<WalletAccessFlow v-if="accessView"/>

			<SecretExportView v-else-if="view === 'secret-export'"/>

			<AccountManagementView v-else-if="view === 'accounts' || view === 'account'"/>

			<NetworkManagementView v-else-if="view === 'networks' || view === 'network'"/>

			<WalletHomeView v-else/>
		</main>
	</div>
</template>

<style lang="scss" src="./styles/wallet.scss"></style>

<style lang="scss" scoped>
.wallet-shell {
	width: 390px;
	min-height: 560px;
	background: #f4f1e8;
	border: 1px solid #cbc7bc;

	&.expanded {
		width: min(720px, calc(100vw - 48px));
		min-height: calc(100vh - 48px);
		margin: 24px auto;
		box-shadow: 6px 6px 0 rgba(20, 33, 61, 0.16);
	}
}

.panel {
	min-height: 496px;
	padding: 26px 24px 28px;
	background-image: linear-gradient(#dedbd2 1px, transparent 1px);
	background-size: 100% 32px;
}

.expanded .panel {
	min-height: calc(100vh - 112px);
	padding: 32px 38px 38px;

	> :deep(section) {
		max-width: 620px;
		margin-inline: auto;
	}
}

/* Modern wallet shell */
.wallet-shell {
	min-height: 600px;
	overflow: hidden;
	border: 0;
	color: #17201d;
	background: #f4f6f3;

	&.expanded {
		width: min(720px, calc(100vw - 40px));
		min-height: calc(100vh - 40px);
		margin: 20px auto;
		border: 1px solid #e2e8e4;
		border-radius: 20px;
		box-shadow: 0 18px 60px rgba(30, 51, 44, 0.09);
	}
}

.panel {
	min-height: 536px;
	padding: 28px 24px 32px;
	color: #17201d;
	background: #f4f6f3 none;

	> :deep(section) {
		color: #17201d;
		background: transparent;
		font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
	}
}

.expanded .panel {
	min-height: calc(100vh - 105px);
	padding: 38px clamp(30px, 8vw, 72px) 48px;

	> :deep(section) {
		padding: 36px;
		border: 1px solid #e2e8e4;
		border-radius: 18px;
		background: #fff;
		box-shadow: 0 10px 30px rgba(31, 52, 45, 0.055);
	}
}

@media (max-width: 389px) {
	.wallet-shell {
		width: 100vw;
	}

	.panel {
		padding-inline: 18px;
	}

	.wallet-shell.expanded {
		width: calc(100vw - 24px);
		min-height: calc(100vh - 24px);
		margin: 12px auto;
		border-radius: 16px;
	}

	.expanded .panel {
		min-height: calc(100vh - 88px);
	}
}

@media (max-width: 359px) {
	.panel {
		padding-inline: 16px;
	}
}
</style>
