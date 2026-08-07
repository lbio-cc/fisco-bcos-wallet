<script lang="ts" setup>
import { computed } from 'vue'
import WalletBackupView from './wallet-access/WalletBackupView.vue'
import WalletConfirmView from './wallet-access/WalletConfirmView.vue'
import WalletCreateView from './wallet-access/WalletCreateView.vue'
import WalletLoadingView from './wallet-access/WalletLoadingView.vue'
import WalletResetView from './wallet-access/WalletResetView.vue'
import WalletRestoreView from './wallet-access/WalletRestoreView.vue'
import WalletUnlockView from './wallet-access/WalletUnlockView.vue'
import WalletWelcomeView from './wallet-access/WalletWelcomeView.vue'
import { useWalletUiStore, type WalletAccessView } from '@/stores/walletUi'

const walletUi = useWalletUiStore()
const view = computed<WalletAccessView>(() => walletUi.view as WalletAccessView)
</script>

<template>
  <WalletLoadingView v-if="view === 'loading'" />
  <WalletWelcomeView v-else-if="view === 'welcome'" />
  <WalletCreateView v-else-if="view === 'create'" />
  <WalletRestoreView v-else-if="view === 'restore'" />
  <WalletBackupView v-else-if="view === 'backup'" />
  <WalletConfirmView v-else-if="view === 'confirm'" />
  <WalletUnlockView v-else-if="view === 'unlock'" />
  <WalletResetView v-else />
</template>
