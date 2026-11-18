import { Capacitor } from '@capacitor/core'
import { watch } from 'vue'
import { settings, resolveTheme } from './settings'
import { READER_PALETTES } from './reader/theme'
import { route, navigate } from './router'
import { setNativeWindowBackground } from './ui/systemcolor'

/** 是否跑在 Capacitor 原生壳里（APK） */
export const isNative = Capacitor.isNativePlatform()

/**
 * 原生壳适配：
 * 1. 状态栏图标深浅随主题切换（inset/CSS 变量由 Capacitor 8 内置
 *    SystemBars 插件在原生侧自动注入 --safe-area-inset-*，见 base.css）
 * 2. Android 返回键：先关浮层 → 回书架 → 退出
 */
export const initNative = async (): Promise<void> => {
  if (!isNative) return

  try {
    // [shuge] 从 @capacitor/status-bar 迁移到 Capacitor 8 内置 SystemBars：
    // targetSdk 35 强制 edge-to-edge 后 setOverlaysWebView/setBackgroundColor
    // 已无意义，SystemBars 的 setStyle 只负责图标深浅
    const { SystemBars, SystemBarsStyle, SystemBarType } = await import('@capacitor/core')
    const syncBars = async (): Promise<void> => {
      const dark = resolveTheme(settings.theme) === 'night'
      try {
        await SystemBars.setStyle({
          bar: SystemBarType.StatusBar,
          style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        })
      } catch {
        /* 某些 ROM 不支持，忽略 */
      }
    }
    await syncBars()
    watch(() => settings.theme, () => void syncBars())
  } catch (e) {
    console.warn('状态栏初始化失败', e)
  }

  // [shuge] 老 WebView（<140）走 SystemBars 原生 padding 路径时，状态栏区域
  // 露出的是 Activity 窗口背景（capacitor.config 里静态的 #FBF9F4），暗色
  // 主题下是一条白边。随主题与路由把窗口背景刷成当前页面底色：
  // 阅读页跟阅读配色走，其余页面跟 App 明暗方案走。
  const syncWindowBackground = (): void => {
    let color: string
    if (route.value.name === 'reader') {
      color = READER_PALETTES[resolveTheme(settings.theme)].bg
    } else {
      color = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim() || '#fbf9f4'
    }
    void setNativeWindowBackground(color)
  }
  syncWindowBackground()
  watch(() => [settings.theme, route.value.name], () => syncWindowBackground())

  try {
    const { App } = await import('@capacitor/app')
    await App.addListener('backButton', async () => {
      // 浮层/光箱先关：页面里 preventDefault 表示已消费
      const consumed = !window.dispatchEvent(
        new CustomEvent('shuge:back', { cancelable: true }),
      )
      if (consumed) return
      // [shuge] 设置页二级分类：返回键先退到分类列表，再退才是书架（与右滑一致）
      if (route.value.name === 'settings' && route.value.section) {
        navigate('/settings')
        return
      }
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
