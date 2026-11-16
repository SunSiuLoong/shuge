import { ref } from 'vue'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { dav } from '../sync/webdav'

/**
 * 豆瓣评分查询：只取「评分数字 + 评价人数」，不取短评、不取评论正文、不取标签。
 *
 * 两条路：
 *   - APK：Capacitor 原生 HTTP 直连，不受同源策略约束；
 *   - 浏览器：走 relay 的 /api/meta/douban（豆瓣不返回 CORS 头，前端直连必被拦）。
 *
 * 命中率实测（2026-11-16）：出版过的网文能查到（诡秘之主 8.5、斗破苍穹 6.5、三体 8.9），
 * 没出过实体书的查不到（剑来、秘术纪元返回空）。查不到就是查不到，不编一个分数出来。
 */

export interface DoubanRating {
  rating: number
  count?: number
  doubanId: string
  matchedTitle: string
}

/** 最近一次失败原因，给界面提示用；成功时清空 */
export const lastMetaError = ref<string | null>(null)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 书名归一化：全半角、书名号、括注、空白都抹掉再比 */
export const normTitle = (s: string): string =>
  (s || '')
    .replace(/[《》「」『』]/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\u3000·・\-—_、,，。.!！?？:：'"“”]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()

const scoreOf = (candTitle: string, candAuthor: string, title: string, author?: string): number => {
  const a = normTitle(candTitle)
  const b = normTitle(title)
  if (!a || !b) return 0
  let s = 0
  if (a === b) s = 100
  else if (a.includes(b) || b.includes(a)) s = 60
  else return 0
  // 作者对得上再加分，避免同名书选错版本
  if (author && author !== '佚名') {
    const na = normTitle(author)
    const ca = normTitle(candAuthor)
    if (ca && (ca.includes(na) || na.includes(ca))) s += 30
  }
  return s
}

interface SuggestItem {
  title?: string
  author_name?: string
  id?: string
  type?: string
}

const pickBest = (items: SuggestItem[], title: string, author?: string): SuggestItem | null => {
  let best: SuggestItem | null = null
  let bestScore = 0
  for (const it of items) {
    if (!it?.id || (it.type && it.type !== 'b')) continue
    const s = scoreOf(it.title ?? '', it.author_name ?? '', title, author)
    if (s > bestScore) {
      bestScore = s
      best = it
    }
  }
  // 低于 60 说明连书名都没对上，宁可留空
  return bestScore >= 60 ? best : null
}

const relayBase = (): string => (dav.relay || '').replace(/\/+$/, '')

/** 原生直连：suggest 找 id → rexxar 取评分 */
const lookupNative = async (title: string, author?: string): Promise<DoubanRating | null> => {
  const sRes = await CapacitorHttp.get({
    url: `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`,
    headers: { 'User-Agent': UA },
    connectTimeout: 8000,
    readTimeout: 8000,
  })
  const items = (typeof sRes.data === 'string' ? JSON.parse(sRes.data) : sRes.data) as
    | SuggestItem[]
    | null
  const best = pickBest(items ?? [], title, author)
  if (!best) return null

  const dRes = await CapacitorHttp.get({
    url: `https://m.douban.com/rexxar/api/v2/book/${best.id}?ck=&for_mobile=1`,
    headers: { 'User-Agent': UA, Referer: 'https://m.douban.com/' },
    connectTimeout: 8000,
    readTimeout: 8000,
  })
  const detail = (typeof dRes.data === 'string' ? JSON.parse(dRes.data) : dRes.data) as {
    rating?: { value?: number; count?: number }
  } | null
  const value = detail?.rating?.value
  if (!value || value <= 0) return null
  return {
    rating: Number(value),
    count: detail?.rating?.count,
    doubanId: String(best.id),
    matchedTitle: best.title ?? title,
  }
}

/** 浏览器走 relay；relay 自己完成两步请求 */
const lookupRelay = async (title: string, author?: string): Promise<DoubanRating | null> => {
  const base = relayBase()
  if (!base) {
    lastMetaError.value = '浏览器里查豆瓣需要先在中继地址填上 relay 部署地址'
    return null
  }
  const qs = new URLSearchParams({ title })
  if (author) qs.set('author', author)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 12000)
  try {
    const res = await fetch(`${base}/api/meta/douban?${qs.toString()}`, { signal: ctl.signal })
    if (!res.ok) {
      lastMetaError.value = `中继返回 ${res.status}`
      return null
    }
    const data = (await res.json()) as
      | ({ ok: true } & DoubanRating)
      | { ok: false; reason?: string }
    if (!('ok' in data) || data.ok !== true) {
      lastMetaError.value = ('reason' in data && data.reason) || '未查到这本书的评分'
      return null
    }
    return {
      rating: data.rating,
      count: data.count,
      doubanId: data.doubanId,
      matchedTitle: data.matchedTitle,
    }
  } catch (e) {
    lastMetaError.value =
      e instanceof Error && e.name === 'AbortError' ? '请求超时' : '网络不通或中继未启动'
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const lookupDouban = async (
  title: string,
  author?: string,
): Promise<DoubanRating | null> => {
  lastMetaError.value = null
  try {
    return Capacitor.isNativePlatform()
      ? await lookupNative(title, author)
      : await lookupRelay(title, author)
  } catch (e) {
    lastMetaError.value = e instanceof Error ? e.message : String(e)
    return null
  }
}
