import { Capacitor, registerPlugin } from '@capacitor/core'

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
}

const SystemColor = registerPlugin<SystemColorPlugin>('SystemColor')

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
