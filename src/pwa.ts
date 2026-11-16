/// <reference types="vite-plugin-pwa/client" />
import { Capacitor } from '@capacitor/core'
import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

export const offlineReady = ref(false)
export const needRefresh = ref(false)

let updateSW: ((reload?: boolean) => Promise<void>) | null = null

export const initPWA = (): void => {
  // 原生壳里资源随 APK 打包，WebView 的 Service Worker 不可靠且无意义
  if (Capacitor.isNativePlatform()) return
  if (!('serviceWorker' in navigator)) return
  updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      offlineReady.value = true
      setTimeout(() => (offlineReady.value = false), 4000)
    },
    onNeedRefresh() {
      needRefresh.value = true
    },
    onRegisteredSW(_url, registration) {
      // PWA 主屏图标启动时浏览器不会主动查更新，每 30 分钟补一次
      if (!registration) return
      setInterval(() => void registration.update(), 30 * 60 * 1000)
    },
  })
}

export const applyUpdate = async (): Promise<void> => {
  needRefresh.value = false
  await updateSW?.(true)
}
