<script lang="ts" setup>
import { useWalletUiStore } from '@/stores/walletUi'

const walletUi = useWalletUiStore()
</script>

<template>
  <section class="welcome">
    <img alt="" class="welcome-logo" src="/logo.png" />
    <p class="eyebrow">安全使用钱包</p>
    <h1>管理你的链上账户</h1>
    <p class="lead">创建或恢复助记词钱包。密钥加密后仅保存在当前浏览器。</p>
    <div class="feature-rule">
      <span>本地加密存储</span><i></i><span>支持国密与标准密码体系</span>
    </div>
    <p v-if="walletUi.error" class="error welcome-error">{{ walletUi.error }}</p>
    <button
      v-if="walletUi.error.includes('钱包存储不完整')"
      class="danger-link recovery-reset"
      type="button"
      @click="walletUi.openReset('welcome')"
    >
      清理损坏的钱包数据
    </button>
    <button class="primary" type="button" @click="walletUi.go('create')">创建新钱包</button>
    <button class="secondary" type="button" @click="walletUi.go('restore')">恢复助记词</button>
  </section>
</template>

<style lang="scss" scoped>
.welcome {
  min-height: 500px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-top: 4px;

  h1 {
    font-size: 30px;
  }

  .lead {
    max-width: 310px;
    margin: 12px 0 22px;
  }
}

.welcome-logo {
  width: 62px;
  height: 62px;
  object-fit: contain;
  margin-bottom: 26px;
  border-radius: 18px;
  box-shadow: 0 8px 24px rgba(23, 107, 87, 0.12);
}

.lead {
  color: #69736f;
  font-size: 12px;
  line-height: 1.7;
}

.feature-rule {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 28px;
  color: #61706a;
  font-size: 11px;
  font-weight: 650;

  i {
    width: 4px;
    height: 4px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #89a99d;
  }
}

.welcome-error {
  margin-bottom: 14px;
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

  &.recovery-reset {
    margin: -5px 0 12px;
  }
}
</style>
