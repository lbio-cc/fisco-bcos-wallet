<script lang="ts" setup>
import { ref, watch } from 'vue'
import { useWalletController } from '@/composables/useWalletController'
import { useWalletUiStore } from '@/stores/walletUi'

const controller = useWalletController()
const walletUi = useWalletUiStore()
const password = ref('')

const submit = (): void => {
  const value = password.value
  password.value = ''
  void controller.submitUnlock(value)
}

watch(
  () => walletUi.sensitiveStateRevision,
  () => (password.value = ''),
  { flush: 'sync' },
)
</script>

<template>
  <section class="unlock-page">
    <img alt="" class="unlock-logo" src="/logo.png" />
    <h1>钱包已锁定</h1>
    <p class="subcopy">请输入密码解锁钱包。</p>
    <form class="unlock-form" @submit.prevent="submit">
      <label>
        钱包密码
        <input v-model="password" autocomplete="current-password" autofocus type="password" />
      </label>
      <p v-if="walletUi.error" class="error">{{ walletUi.error }}</p>
      <button :disabled="walletUi.busy" class="primary" type="submit">
        {{ walletUi.busy ? '正在解锁…' : '解锁钱包' }}
      </button>
    </form>
    <button class="danger-link" type="button" @click="walletUi.openReset('unlock')">
      忘记密码？重置钱包
    </button>
  </section>
</template>

<style lang="scss" scoped>
.unlock-page {
  padding-top: 12px;

  .unlock-logo {
    display: block;
    width: 54px;
    height: 54px;
    margin: 0 auto 22px;
    border-radius: 15px;
    object-fit: contain;
    box-shadow: 0 8px 24px rgba(23, 107, 87, 0.12);
  }

  h1 {
    font-size: 25px;
    text-align: center;
  }

  .subcopy {
    text-align: center;
  }

  .unlock-form {
    gap: 13px;
  }

  .danger-link {
    width: 100%;
    margin-top: 15px;
    padding: 8px;
    border: 0;
    color: #a0443a;
    background: transparent;
    font-size: 11px;
    font-weight: 700;

    &:hover {
      color: #7e211a;
      text-decoration: underline;
    }
  }
}
</style>
