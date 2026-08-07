import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

const alias = {
  '@': fileURLToPath(new URL('../src', import.meta.url)),
  crypto: fileURLToPath(new URL('../src/shims/nodeCrypto.ts', import.meta.url)),
}

await build({
  configFile: false,
  plugins: [vue()],
  resolve: { alias },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve('html/index.html'),
        connectApproval: resolve('html/connect-approval.html'),
        transactionApproval: resolve('html/transaction-approval.html'),
        switchApproval: resolve('html/switch-approval.html'),
      },
    },
  },
})

for (const name of ['background', 'content', 'inpage']) {
  await build({
    configFile: false,
    resolve: { alias },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: fileURLToPath(new URL(`../src/${name}/index.ts`, import.meta.url)),
        name: `FiscoWallet${name}`,
        formats: ['iife'],
        fileName: () => `${name}.js`,
      },
      minify: true,
    },
  })
}
