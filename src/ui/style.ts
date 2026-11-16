import { watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { appDark, settings } from '../settings'
import { applyAccentHex, clearMonet, refreshMonet } from './monet'
import { systemAccentHex } from './systemcolor'

/**
 * UI 风格的副作用：莫奈取色需要在 App 生命周期里持续跟着
 * 「当前明暗 + 颜色来源」重算；另外两种风格要把 accent 覆盖清掉。
 *
 * 放在 App.vue 挂一次即可，不要在页面里各自 watch，否则切页会重复取色。
 */

let lastApplied = ''

const syncMonet = async (): Promise<void> => {
  if (settings.uiStyle !== 'monet') {
    clearMonet()
    lastApplied = ''
    return
  }
  const dark = appDark.value
  let hex: string | null = null
  if (settings.monetSource === 'system') hex = await systemAccentHex()
  // 系统取不到（网页端 / Android 11 以下 / ROM 没实现）就退回设置里存的色
  const applied = applyAccentHex(hex ?? settings.monetHex, dark)
  lastApplied = `${hex ?? settings.monetHex}|${dark}|${applied ?? ''}`
}

export const resyncMonet = (): void => {
  void syncMonet()
}

export const initUiStyle = (): void => {
  watch(
    [() => settings.uiStyle, () => settings.monetSource, () => settings.monetHex],
    () => {
      void syncMonet()
    },
    { immediate: true },
  )

  // 明暗变了只需要重算亮度区间，不用重新读系统色
  watch(appDark, (dark) => {
    if (settings.uiStyle === 'monet') refreshMonet(dark)
  })

  // 换了壁纸系统色会变，回前台时重取一次（原生壳里才有意义）
  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (isActive && settings.uiStyle === 'monet' && settings.monetSource === 'system') {
          void syncMonet()
        }
      })
    })
  }
}

export const currentMonetKey = (): string => lastApplied
