import { reactive } from 'vue'
import { registerPlugin } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { isNative } from '../native'

/**
 * 书评/网文站在哪打开。
 *
 * - 安卓 App：走自家的原生内置浏览器 `InAppWebPlugin`（整屏 WebView + 工具栏）。
 *   **不能用 @capacitor/browser**：Custom Tabs 的 Cookie 是系统浏览器那一套，
 *   跟 App WebView 的 CookieManager 不互通，社区（阡陌居）在那边登录后，
 *   签到/领任务读 Cookie 仍是未登录。同一个 WebView 才能共享登录态。
 * - 网页 / PWA：没有原生层，用下面的全屏内嵌层（iframe）。豆瓣、微信读书
 *   允许被嵌入；番茄有 frame-ancestors、起点给挑战页，这两个站点在 sites.ts 里
 *   标了 embed:false，直接交给系统浏览器，不让用户对着白屏猜。
 *
 * 内嵌层的状态放这里而不是组件里：LinkSheet 关掉以后层还在，需要一份跨组件的状态。
 */
export const inAppBrowser = reactive({
  open: false,
  url: '',
  title: '',
})

/** 原生内置浏览器插件（Android 侧 InAppWebPlugin.java） */
interface InAppWebPlugin {
  open(o: { url: string; title?: string; bg?: string; fg?: string }): Promise<void>
}

const InAppWeb = registerPlugin<InAppWebPlugin>('InAppWeb')

export const closeInAppBrowser = (): void => {
  inAppBrowser.open = false
  inAppBrowser.url = ''
  inAppBrowser.title = ''
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
const hex2 = (n: number): string => clamp255(n).toString(16).padStart(2, '0')

/**
 * Custom Tabs 的 toolbarColor 只吃 #rrggbb，但主题令牌里 --bg 常常是
 * color(srgb 0.98 0.97 0.95) 这种现代写法，直接传会被忽略（退回浏览器默认色）。
 * 这里把几种常见格式都折成 hex。
 */
const toHex = (raw: string): string | null => {
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(raw)
  if (srgb) return '#' + [1, 2, 3].map((i) => hex2(parseFloat(srgb[i]) * 255)).join('')
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(raw)
  if (rgb) return '#' + [1, 2, 3].map((i) => hex2(parseFloat(rgb[i]))).join('')
  return null
}

/** App 底色的十六进制值，给原生工具栏上色，跟当前明暗/外观对齐 */
const toolbarColor = (): string => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  return toHex(raw) ?? '#fbf9f4'
}

/** 工具栏前景色（标题与按钮） */
const barTextColor = (): string => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
  return toHex(raw) ?? '#1a1a1a'
}

export const openInApp = async (
  url: string,
  title: string,
  embeddable = true,
): Promise<void> => {
  if (!url) return
  if (isNative) {
    try {
      await InAppWeb.open({ url, title, bg: toolbarColor(), fg: barTextColor() })
      return
    } catch (e) {
      // 插件没进包（例如旧包）时退回 Custom Tabs，别让链接点不动
      console.warn('[shuge] 内置浏览器不可用，退回 Custom Tabs', e)
      try {
        await Browser.open({ url, toolbarColor: toolbarColor() })
        return
      } catch (e2) {
        console.warn('[shuge] Custom Tabs 也失败', e2)
      }
    }
  }
  // 网页端：不能嵌入的站点别开空壳层，直接交给浏览器
  if (!embeddable) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  inAppBrowser.url = url
  inAppBrowser.title = title
  inAppBrowser.open = true
}
