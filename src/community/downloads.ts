/**
 * 社区下载：经内置浏览器/系统下载器拉取阡陌居附件，并留一份本地记录。
 *
 * App 里走 CommunityHttp.download（Android DownloadManager，带 WebView Cookie，
 * 登录后才能下的附件也能下）；网页端退化为新开标签页交给浏览器下载。
 */
import { reactive, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { CommunityHttp } from './qm'

const KEY = 'shuge.community.downloads.v1'

export interface DownloadRecord {
  id: string
  name: string
  url: string
  time: number
}

const load = (): DownloadRecord[] => {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as DownloadRecord[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export const downloadState = reactive({
  records: load(),
})

watch(
  () => downloadState.records,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v.slice(0, 100)))
    } catch {
      /* 存储被禁用时忽略 */
    }
  },
  { deep: true },
)

export const recordDownload = (name: string, url: string): void => {
  downloadState.records.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    url,
    time: Date.now(),
  })
}

export const clearDownloadRecords = (): void => {
  downloadState.records = []
}

export const removeDownloadRecord = (id: string): void => {
  downloadState.records = downloadState.records.filter((r) => r.id !== id)
}

export interface DownloadStartResult {
  ok: boolean
  message: string
}

export const startDownload = async (url: string, name?: string): Promise<DownloadStartResult> => {
  const safeName = (name || url.split('/').pop() || 'attachment').slice(0, 120)
  if (Capacitor.isNativePlatform()) {
    try {
      await CommunityHttp.download({ url, name: safeName })
      recordDownload(safeName, url)
      return { ok: true, message: '已加入系统下载队列' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '下载失败'
      recordDownload(safeName, url)
      return { ok: false, message: msg }
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  recordDownload(safeName, url)
  return { ok: true, message: '已交给浏览器下载' }
}
