<script lang="ts" setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useWalletController } from '@/composables/useWalletController'
import { useClipboardFeedbackStore } from '@/stores/clipboardFeedback'
import { useWalletUiStore } from '@/stores/walletUi'

const controller = useWalletController()
const clipboard = useClipboardFeedbackStore()
const walletUi = useWalletUiStore()
const { mnemonicWords } = controller
const copied = ref(false)
let copyRevision = 0

const clearCopyState = (): void => {
  copyRevision += 1
  copied.value = false
}

const copyMnemonic = async (): Promise<void> => {
  if (!mnemonicWords.value.length) return
  const currentRevision = copyRevision
  try {
    await clipboard.writeText(mnemonicWords.value.join(' '))
    if (currentRevision !== copyRevision) return
    copied.value = true
    window.setTimeout(() => {
      if (currentRevision === copyRevision) copied.value = false
    }, 1600)
  } catch {
    if (currentRevision === copyRevision) {
      walletUi.error = '复制失败，请手动抄写助记词'
    }
  }
}

watch(() => walletUi.sensitiveStateRevision, clearCopyState, { flush: 'sync' })
onBeforeUnmount(clearCopyState)
</script>

<template>
  <section class="backup-page">
    <p class="eyebrow">备份助记词</p>
    <h1>抄写恢复短语</h1>
    <p class="warning">
      <b>任何人获得这些单词，都能控制你的账户。</b><br />请离线抄写，切勿截图或发送给他人。
    </p>
    <ol class="mnemonic-grid">
      <li v-for="(word, index) in mnemonicWords" :key="index">
        <span>{{ String(index + 1).padStart(2, '0') }}</span
        ><b>{{ word }}</b>
      </li>
    </ol>
    <button class="text-button" type="button" @click="copyMnemonic">
      {{ copied ? '已复制' : '复制到剪贴板' }}
    </button>
    <button class="primary" type="button" @click="walletUi.go('confirm')">我已安全保存</button>
  </section>
</template>

<style lang="scss" scoped>
.backup-page h1 {
  font-size: 25px;
}

.warning {
  margin: 18px 0;
  padding: 13px;
  border: 0;
  border-radius: 10px;
  color: #745519;
  background: #fff6dd;
  font-size: 11px;
  line-height: 1.55;
}

.mnemonic-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 0;
  padding: 12px;
  border: 1px solid #dfe7e2;
  border-radius: 14px;
  background: #fff;

  li {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 9px;
    border-radius: 8px;
    background: #f5f8f6;
  }

  span {
    color: #8b9792;
    font:
      600 10px/1 ui-monospace,
      monospace;
  }

  b {
    overflow: hidden;
    color: #25302c;
    font:
      650 11px/1.2 ui-monospace,
      monospace;
    text-overflow: ellipsis;
  }
}

.text-button {
  width: 100%;
  margin: 12px 0;
  padding: 8px;
  border: 0;
  color: #176b57;
  background: transparent;
  font-size: 11px;
  font-weight: 700;
}

@media (max-width: 389px) {
  .mnemonic-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
