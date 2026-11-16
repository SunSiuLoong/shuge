import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'fonts/serif.woff'],
      manifest: {
        name: '书阁 · 本地 EPUB 阅读器',
        short_name: '书阁',
        description: '本地 EPUB 电子书阅读器，离线可用',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F7F4EC',
        theme_color: '#F7F4EC',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 只缓存 app shell；书籍内容在 OPFS，不进 SW
        globPatterns: ['**/*.{js,css,html,svg,png,woff,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
})
