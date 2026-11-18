import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

/**
 * 系统动态色（Android 12+ 的 Material You / 莫奈取色）。
 *
 * 只有原生壳里拿得到：网页端浏览器没有任何 API 能读到壁纸颜色，
 * 所以非原生环境一律返回 null，交给上层用设置里存的 hex 兜底。
 *
 * 原生实现见 android/app/src/main/java/com/sunbo/shuge/SystemColorPlugin.java，
 * 读的是 android.R.color.system_accent1_* 这组系统资源。
 */
interface SystemColorPlugin {
  getColors(): Promise<{ accent?: string; accent2?: string; accent3?: string }>
  /** [shuge] 同步原生窗口背景（老 WebView 状态栏条的底色），见 SystemColorPlugin.java */
  setWindowBackground(opts: { color: string }): Promise<void>
  /** [shuge] 读系统明暗（uiMode 的 NIGHT_MASK）。WebView 的 matchMedia 在部分 ROM 不可靠 */
  getDarkMode(): Promise<{ dark: boolean }>
  addListener(
    eventName: 'systemDarkChanged',
    listenerFunc: (data: { dark: boolean }) => void,
  ): Promise<PluginListenerHandle>
}

export const SystemColor = registerPlugin<SystemColorPlugin>('SystemColor')

const HEX = /^#[0-9a-f]{6}$/i

export const isSystemColorAvailable = (): boolean => Capacitor.isNativePlatform()

export const systemAccentHex = async (): Promise<string | null> => {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const r = await SystemColor.getColors()
    return r?.accent && HEX.test(r.accent) ? r.accent : null
  } catch {
    // 系统低于 12、ROM 不支持、插件没注册，都在这里安静降级
    return null
  }
}

/** [shuge] 把原生窗口背景刷成指定色；非原生环境或调用失败都安静降级 */
export const setNativeWindowBackground = async (color: string): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return
  if (!HEX.test(color)) return
  try {
    await SystemColor.setWindowBackground({ color })
  } catch {
    /* 插件未注册等场景，忽略 */
  }
}
