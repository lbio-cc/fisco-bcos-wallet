<script lang="ts" setup>
import { reactive, watch } from 'vue'
import { useWalletController } from '@/composables/useWalletController'
import { useWalletUiStore } from '@/stores/walletUi'
import type { CreateWalletForm } from '../walletAccessTypes'

const controller = useWalletController()
const walletUi = useWalletUiStore()
const form = reactive<CreateWalletForm>({
  name: '主钱包',
  wordCount: 12,
  password: '',
  passwordConfirm: '',
})

const clearSensitiveState = (): void => {
  form.password = ''
  form.passwordConfirm = ''
}

const submit = (): void => {
  void controller.submitCreate({ ...form })
}

watch(() => walletUi.sensitiveStateRevision, clearSensitiveState, { flush: 'sync' })
</script>

<template>
  <section class="form-page">
    <button aria-label="返回" class="back" type="button" @click="walletUi.go('welcome')">
      ← 返回
    </button>
    <p class="eyebrow">创建钱包</p>
    <h1>创建助记词钱包</h1>
    <p class="subcopy">生成全新的恢复短语和首个链账户。</p>

    <form @submit.prevent="submit">
      <label>钱包名称<input v-model="form.name" autocomplete="off" maxlength="40" /></label>
      <fieldset>
        <legend>助记词长度</legend>
        <div class="word-count">
          <label><input v-model="form.wordCount" :value="12" type="radio" />12 词</label>
          <label><input v-model="form.wordCount" :value="24" type="radio" />24 词</label>
        </div>
      </fieldset>
      <label>
        钱包密码
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
      <p class="notice">账户私钥统一派生；展示的地址和交易签名由当前群组的密码体系决定。</p>
      <p v-if="walletUi.error" class="error">{{ walletUi.error }}</p>
      <button :disabled="walletUi.busy" class="primary" type="submit">
        {{ walletUi.busy ? '正在创建…' : '生成钱包' }}
      </button>
    </form>
  </section>
</template>

<style lang="scss" scoped>
.word-count {
  overflow: hidden;
  display: flex;
  gap: 18px;
  padding: 11px 13px;
  border: 1px solid #d8e0dc;
  border-radius: 10px;
  background: #fff;

  label {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  input {
    width: auto;
    accent-color: #176b57;
  }
}
</style>
