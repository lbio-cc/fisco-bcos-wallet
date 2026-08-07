<script lang="ts" setup>
import { reactive, watch } from 'vue'
import { useWalletController } from '@/composables/useWalletController'
import { useWalletUiStore } from '@/stores/walletUi'

const controller = useWalletController()
const walletUi = useWalletUiStore()
const { confirmPositions } = controller
const answers = reactive<Record<number, string>>({})

const clearAnswers = (): void => {
  for (const key of Object.keys(answers)) delete answers[Number(key)]
}

const submit = (): void => {
  void controller.submitConfirmation({ ...answers })
}

watch(confirmPositions, clearAnswers)
watch(() => walletUi.sensitiveStateRevision, clearAnswers, { flush: 'sync' })
</script>

<template>
  <section class="confirm-page">
    <button class="back" type="button" @click="walletUi.go('backup')">← 返回检查</button>
    <p class="eyebrow">核对助记词</p>
    <h1>确认备份</h1>
    <p class="subcopy">填写指定位置的单词，确保备份顺序正确。</p>
    <form @submit.prevent="submit">
      <label v-for="position in confirmPositions" :key="position">
        第 {{ position }} 个单词
        <input
          v-model="answers[position]"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <p v-if="walletUi.error" class="error">{{ walletUi.error }}</p>
      <button :disabled="walletUi.busy" class="primary" type="submit">
        {{ walletUi.busy ? '正在确认…' : '完成验证' }}
      </button>
    </form>
  </section>
</template>

<style lang="scss" scoped>
.confirm-page {
  h1 {
    font-size: 25px;
  }

  form {
    margin-top: 22px;
  }
}
</style>
