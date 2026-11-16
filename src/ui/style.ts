import { watch } from 'vue'
import { books } from '../shelf/store'
import { appDark, settings } from '../settings'
import { applyMonetFromCover, clearMonet, refreshMonet } from './monet'

/**
 * UI 风格的副作用：莫奈取色需要在 App 生命周期里持续跟着
 * 「当前明暗 + 用哪本书的封面」重算；另外两种风格要把 accent 覆盖清掉。
 *
 * 放在 App.vue 挂一次即可，不要在页面里各自 watch，否则切页会重复取色。
 */

/** 取色的样本：优先最近读过的、且有内嵌封面的那本 */
const sampleCover = (): Blob | undefined => {
  const withCover = books.value.filter((b) => b.cover && b.cover.size > 0)
  if (!withCover.length) return undefined
  const sorted = [...withCover].sort(
    (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt,
  )
  return sorted[0]?.cover
}

let lastSampleId: number | undefined

const syncMonet = async (): Promise<void> => {
  if (settings.uiStyle !== 'monet') {
    clearMonet()
    lastSampleId = undefined
    return
  }
  const sample = sampleCover()
  await applyMonetFromCover(sample, appDark.value)
}

export const initUiStyle = (): void => {
  watch(
    () => settings.uiStyle,
    () => {
      void syncMonet()
    },
    { immediate: true },
  )

  // 明暗变了只需要重算亮度区间，不用重新解码封面
  watch(appDark, (dark) => {
    if (settings.uiStyle === 'monet') refreshMonet(dark)
  })

  // 书架第一次加载完（0 → N）或最近读的那本换了，重新取色
  watch(
    () => {
      const b = sampleCover()
      return b ? b.size : 0
    },
    () => {
      if (settings.uiStyle !== 'monet') return
      const b = sampleCover()
      const size = b?.size ?? 0
      // 同一张封面重复触发没意义（liveQuery 会在进度变化时反复推送）
      if (size === lastSampleId) return
      lastSampleId = size
      void syncMonet()
    },
  )
}
