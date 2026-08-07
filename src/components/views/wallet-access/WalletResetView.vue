<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useWalletController } from '@/composables/useWalletController'
import { useWalletUiStore } from '@/stores/walletUi'

const controller = useWalletController()
const walletUi = useWalletUiStore()
const confirmation = ref('')

const submit = (): void => {
  void controller.submitReset(confirmation.value)
}

watch(
  () => walletUi.sensitiveStateRevision,
  () => (confirmation.value = ''),
  { flush: 'sync' },
)
</script>

<template>
  <section class="reset-page">
    <button class="back" type="button" @click="walletUi.go(walletUi.resetBack)">← 返回</button>
    <p class="eyebrow danger-text">谨慎操作</p>
    <h1>永久重置钱包</h1>
    <p class="reset-warning">
      <b>此操作无法撤销。</b><br />
      将删除本机加密 vault、账户摘要和所有站点授权。网络配置会保留。
    </p>
    <p class="subcopy">请先确认助记词已经安全备份。没有助记词将无法找回当前账户和资产。</p>
    <form @submit.prevent="submit">
      <label>
        输入“重置钱包”确认
        <input v-model="confirmation" autocomplete="off" placeholder="重置钱包" />
      </label>
      <p v-if="walletUi.error" class="error">{{ walletUi.error }}</p>
      <button
        :disabled="walletUi.busy || confirmation.trim() !== '重置钱包'"
        class="danger-button"
        type="submit"
      >
        {{ walletUi.busy ? '正在重置…' : '永久删除钱包' }}
      </button>
    </form>
  </section>
</template>

<style lang="scss" scoped>
.reset-page h1 {
  font-size: 25px;
}

.reset-warning {
  margin: 18px 0 14px;
  padding: 13px;
  border: 0;
  border-radius: 10px;
  color: #8c3931;
  background: #faece9;
  font-size: 11px;
  line-height: 1.55;
}
</style>
