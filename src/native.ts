import { Capacitor } from '@capacitor/core'
import { watch } from 'vue'
import { settings, resolveTheme } from './settings'
import { route, navigate } from './router'

/** 是否跑在 Capacitor 原生壳里（APK） */
export const isNative = Capacitor.isNativePlatform()

/**
 * 原生壳适配：
 * 1. 状态栏透明覆盖（正文顶到状态栏下，时间/电量由系统绘制）
 * 2. 状态栏图标深浅随主题切换
 * 3. Android 返回键：先关浮层 → 回书架 → 退出
 */
export const initNative = async (): Promise<void> => {
  if (!isNative) return

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    const syncBars = async (): Promise<void> => {
      const dark = resolveTheme(settings.theme) === 'night'
      try {
        await StatusBar.setOverlaysWebView({ overlay: true })
        await StatusBar.setBackgroundColor({ color: '#00000000' })
        await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
      } catch {
        /* 某些 ROM 不支持透明，忽略 */
      }
    }
    await syncBars()
    watch(() => settings.theme, () => void syncBars())
  } catch (e) {
    console.warn('状态栏初始化失败', e)
  }

  try {
    const { App } = await import('@capacitor/app')
    await App.addListener('backButton', async () => {
      // 浮层/光箱先关：页面里 preventDefault 表示已消费
      const consumed = !window.dispatchEvent(
        new CustomEvent('shuge:back', { cancelable: true }),
      )
      if (consumed) return
      if (route.value.name !== 'shelf') {
        navigate('/')
        return
      }
      await App.exitApp()
    })
  } catch (e) {
    console.warn('返回键注册失败', e)
  }
}
