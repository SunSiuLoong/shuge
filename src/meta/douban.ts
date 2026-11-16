import { ref } from 'vue'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { dav } from '../sync/webdav'
import { MATCH_FLOOR, normTitle, scoreOf, sliceJsonObject } from './match'
import type { RatingHit } from './types'

/**
 * 豆瓣评分查询：只取「评分数字 + 评价人数」，不取短评、不取评论正文。
 *
 * 主路径是搜索结果页——那一页的 `window.__DATA__` 里每条结果直接带 rating，
 * 一次请求就够；`subject_suggest` 那套两步的留着当兜底，因为它的覆盖范围更窄
 * （《剑来》在豆瓣有条目，但 suggest 一条都不返回，搜索结果页反而能搜到）。
 *
 * 已知短板：豆瓣对网文常常只有「分卷」评分。查《剑来》会命中《剑来1：少年起微末》
 * 7.0 分（2463 人），拿它当全书分数会明显偏低——所以上层会拿微信读书的全书评分对比，
 * 只在豆瓣精确同名时才优先用豆瓣。见 `lookupRating`。
 */

export { normTitle }

/** 最近一次失败原因，给界面提示用；成功时清空 */
export const lastMetaError = ref<string | null>(null)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

interface SearchItem {
  tpl_name?: string
  title?: string
  id?: number | string
  url?: string
  rating?: { value?: number; count?: number }
}

interface SuggestItem {
  title?: string
  author_name?: string
  id?: string
  type?: string
}

/** 从搜索结果页 HTML 里挑出最匹配的一条；解析不出来返回 undefined（表示要回退） */
const pickFromSearchPage = (html: string, title: string, author?: string): RatingHit | null | undefined => {
  const at = html.indexOf('window.__DATA__')
  if (at < 0) return undefined
  const data = sliceJsonObject(html, at) as { items?: SearchItem[] } | null
  if (!data || !Array.isArray(data.items)) return undefined

  const items = data.items.filter(
    (x) => x?.tpl_name === 'search_subject' && x.rating && Number(x.rating.value) > 0,
  )
  let best: SearchItem | null = null
  let bestScore = 0
  let bestCount = -1
  for (const it of items) {
    const s = scoreOf(it.title ?? '', '', title, author)
    const cnt = Number(it.rating?.count ?? 0)
    // 同分取评价人数多的：同一本书的不同版本、不同分册会一起列出来
    if (s > bestScore || (s === bestScore && cnt > bestCount)) {
      bestScore = s
      bestCount = cnt
      best = it
    }
  }
  if (!best || bestScore < MATCH_FLOOR) return null
  return {
    rating: Number(best.rating?.value),
    count: best.rating?.count,
    source: 'douban',
    matchedTitle: best.title ?? title,
    url: best.url || (best.id ? `https://book.douban.com/subject/${best.id}/` : undefined),
  }
}

const relayBase = (): string => (dav.relay || '').replace(/\/+$/, '')

/** App 内直连：搜索结果页一次拿全，结构变了再退回 suggest + rexxar */
const lookupNative = async (title: string, author?: string): Promise<RatingHit | null> => {
  const sRes = await CapacitorHttp.get({
    url: `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(title)}`,
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    responseType: 'text',
    connectTimeout: 8000,
    readTimeout: 10000,
  })
  const html = typeof sRes.data === 'string' ? sRes.data : ''
  const hit = pickFromSearchPage(html, title, author)
  if (hit !== undefined) return hit

  // ---- 兜底：suggest 找 id → rexxar 取评分 ----
  const gRes = await CapacitorHttp.get({
    url: `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`,
    headers: { 'User-Agent': UA },
    connectTimeout: 8000,
    readTimeout: 8000,
  })
  const items = (typeof gRes.data === 'string' ? JSON.parse(gRes.data) : gRes.data) as
    | SuggestItem[]
    | null
  let best: SuggestItem | null = null
  let bestScore = 0
  for (const it of items ?? []) {
    if (!it?.id || (it.type && it.type !== 'b')) continue
    const s = scoreOf(it.title ?? '', it.author_name, title, author)
    if (s > bestScore) {
      bestScore = s
      best = it
    }
  }
  if (!best || bestScore < MATCH_FLOOR) return null

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
    source: 'douban',
    matchedTitle: best.title ?? title,
    url: `https://book.douban.com/subject/${best.id}/`,
  }
}

/** 浏览器：豆瓣不返回 CORS 头，只能走 relay */
const lookupRelay = async (title: string, author?: string): Promise<RatingHit | null> => {
  const base = relayBase()
  if (!base) {
    lastMetaError.value = '浏览器里查评分需要先在同步设置里填中继地址'
    return null
  }
  const qs = new URLSearchParams({ title })
  if (author) qs.set('author', author)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  try {
    const res = await fetch(`${base}/api/meta/douban?${qs.toString()}`, { signal: ctl.signal })
    if (!res.ok) {
      lastMetaError.value = `中继返回 ${res.status}`
      return null
    }
    const data = (await res.json()) as ({ ok: true } & RatingHit) | { ok: false; reason?: string }
    if (!('ok' in data) || data.ok !== true) {
      lastMetaError.value = ('reason' in data && data.reason) || '未查到这本书的评分'
      return null
    }
    return {
      rating: data.rating,
      count: data.count,
      source: 'douban',
      matchedTitle: data.matchedTitle,
      url: data.url,
    }
  } catch (e) {
    lastMetaError.value =
      e instanceof Error && e.name === 'AbortError' ? '请求超时' : '网络不通或中继未启动'
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const lookupDouban = async (title: string, author?: string): Promise<RatingHit | null> => {
  try {
    return Capacitor.isNativePlatform()
      ? await lookupNative(title, author)
      : await lookupRelay(title, author)
  } catch (e) {
    lastMetaError.value = e instanceof Error ? e.message : String(e)
    return null
  }
}
