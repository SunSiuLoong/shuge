import { APP_VERSION } from './version'
import { LATEST_RELEASE_API, RELEASES_URL } from './appinfo'

/**
 * 检查更新：读 GitHub 最新 Release。
 *
 * 只认 tag 里的版本号（v1.12.0 / 1.12.0 都认），不比较 commit——
 * 用户装的是 APK，能看到「有没有比我这版新的安装包」就够了。
 * 私有仓库时代这里会 404，所以失败信息要说清是「仓库不可访问」还是「网络不通」。
 */
export interface ReleaseInfo {
  version: string
  name: string
  notes: string
  /** 直接可下载的 APK 地址，没传包时为空 */
  apkUrl?: string
  apkSize?: number
  pageUrl: string
  publishedAt?: string
}

export interface UpdateResult {
  latest: ReleaseInfo
  hasUpdate: boolean
}

const parseVersion = (v: string): number[] =>
  v
    .replace(/^v/i, '')
    .trim()
    .split(/[.\-+]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0)

export const compareVersion = (a: string, b: string): number => {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  assets?: { name?: string; size?: number; browser_download_url?: string }[]
}

export const checkUpdate = async (): Promise<UpdateResult> => {
  let res: Response
  try {
    res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    })
  } catch {
    throw new Error('网络不通，检查一下连接再试')
  }
  if (res.status === 404) {
    throw new Error('仓库里还没有发布版本')
  }
  if (res.status === 403) {
    throw new Error('请求太频繁，稍等一会儿再试')
  }
  if (!res.ok) {
    throw new Error(`GitHub 返回 ${res.status}`)
  }
  const data = (await res.json()) as GitHubRelease
  const tag = (data.tag_name || data.name || '').trim()
  const assets = data.assets ?? []
  // 优先 Android 包；Release 里可能还挂了别的东西，不能无脑取第一个
  const apk = assets.find((a) => (a.name ?? '').toLowerCase().endsWith('.apk'))
  const latest: ReleaseInfo = {
    version: tag || APP_VERSION,
    name: data.name || tag || '最新版本',
    notes: (data.body || '').trim(),
    apkUrl: apk?.browser_download_url,
    apkSize: apk?.size,
    pageUrl: data.html_url || RELEASES_URL,
    publishedAt: data.published_at,
  }
  return { latest, hasUpdate: compareVersion(latest.version, APP_VERSION) > 0 }
}
