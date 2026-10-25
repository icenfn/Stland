import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Tauri 开发期要求固定端口，且不清屏以便看到 Rust 端日志
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
    watch: {
      // 避免 Tauri 的 Rust 目标目录触发无限重载
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Android WebView 兼容目标
    target: 'es2021',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
  },
  envPrefix: ['VITE_', 'TAURI_'],
})
