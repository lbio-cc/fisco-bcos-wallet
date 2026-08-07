<script lang="ts" setup>
import { reactive, watch } from 'vue'
import { useWalletController } from '@/composables/useWalletController'
import { useWalletUiStore } from '@/stores/walletUi'
import type { RestoreWalletForm } from '../walletAccessTypes'

const controller = useWalletController()
const walletUi = useWalletUiStore()
const form = reactive<RestoreWalletForm>({
  name: '恢复钱包',
  mnemonic: '',
  password: '',
  passwordConfirm: '',
})

const clearSensitiveState = (): void => {
  form.mnemonic = ''
  form.password = ''
  form.passwordConfirm = ''
}

const submit = (): void => {
  void controller.submitRestore({ ...form })
}

watch(() => walletUi.sensitiveStateRevision, clearSensitiveState, { flush: 'sync' })
</script>

<template>
  <section class="form-page">
    <button aria-label="返回" class="back" type="button" @click="walletUi.go('welcome')">
      ← 返回
    </button>
    <p class="eyebrow">恢复钱包</p>
    <h1>恢复已有钱包</h1>
    <p class="subcopy">输入原钱包的英文恢复短语。</p>

    <form @submit.prevent="submit">
      <label>钱包名称<input v-model="form.name" autocomplete="off" maxlength="40" /></label>
      <label>
        英文助记词
        <textarea
          v-model="form.mnemonic"
          autocomplete="off"
          placeholder="按顺序输入 12 或 24 个单词，以空格分隔"
          rows="4"
          spellcheck="false"
        ></textarea>
      </label>
      <label>
        新钱包密码
        <input
          v-model="form.password"
          autocomplete="new-password"
          minlength="10"
          placeholder="至少 10 个字符"
          type="password"
        />
      </label>
      <label>
        确认密码
        <input v-model="form.passwordConfirm" autocomplete="new-password" type="password" />
      </label>
      <p v-if="walletUi.error" class="error">{{ walletUi.error }}</p>
      <button :disabled="walletUi.busy" class="primary" type="submit">
        {{ walletUi.busy ? '正在恢复…' : '恢复钱包' }}
      </button>
    </form>
  </section>
</template>
