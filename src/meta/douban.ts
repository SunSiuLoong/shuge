import { CapacitorHttp } from '@capacitor/core'
import { isVolumeLike, normTitle, scoreOf, sliceJsonObject, MATCH_FLOOR } from './match'
import type { SourceCandidate } from './types'

/**
 * 豆瓣候选：只取「评分数字 + 评价人数 + 封面 + 作者」，不取短评、不取评论正文。
 *
 * 主路径是搜索结果页——那一页的 `window.__DATA__` 里每条结果直接带 rating 和 cover_url，
 * 一次请求就够；`subject_suggest` 那套两步的留着当兜底，因为它的覆盖范围更窄
 * （《剑来》在豆瓣有条目，但 suggest 一条都不返回，搜索结果页反而能搜到）。
 *
 * 已知短板：豆瓣对网文常常只有「分卷」评分，所以候选里会出现《剑来1：少年起微末》，
 * 上层按评分人数排序时它自然排在微信读书的全集后面。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

interface SearchItem {
  tpl_name?: string
  title?: string
  id?: number | string
  url?: string
  cover_url?: string
  abstract?: string
  rating?: { value?: number; count?: number }
}

interface SuggestItem {
  title?: string
  author_name?: string
  pic?: string
  id?: string
  type?: string
}

const PUBLISHER_RE = /出版社|出版公司|出版集团|出版|书局|书店|^\d{4}(-\d{1,2})?$|^¥|^\d+(\.\d+)?元$|ISBN/i

/** 从豆瓣的 abstract 斜杠串里挑作者：第一段通常是，但有的版本把出版社排第一 */
const authorFromAbstract = (abstract?: string): string => {
  const parts = (abstract ?? '')
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
  const hit = parts.find((x) => !PUBLISHER_RE.test(x)) ?? ''
  // 豆瓣常写成「原著 国王陛下」「[美] 某某 著」，前缀对读者没意义
  return hit
    .replace(/^\[[^\]]{1,6}\]\s*/, '')
    .replace(/^(原著|著者|作者|编著|主编|译者|著|等)[\s:：]*/, '')
    .trim()
}

const dedupe = (list: SourceCandidate[]): SourceCandidate[] => {
  const seen = new Set<string>()
  return list.filter((x) => {
    const key = normTitle(x.title)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const fromSearchPage = (
  html: string,
  title: string,
  author?: string,
): SourceCandidate[] | null => {
  const at = html.indexOf('window.__DATA__')
  if (at < 0) return null
  const data = sliceJsonObject(html, at) as { items?: SearchItem[] } | null
  if (!data || !Array.isArray(data.items)) return null

  const out: SourceCandidate[] = []
  for (const it of data.items) {
    if (it?.tpl_name !== 'search_subject' || !it.rating) continue
    if (!(Number(it.rating.value) > 0)) continue
    const s = scoreOf(it.title ?? '', '', title, author)
    if (s < MATCH_FLOOR) continue
    out.push({
      site: 'douban',
      siteName: '豆瓣',
      bookId: it.id != null ? String(it.id) : undefined,
      title: it.title ?? title,
      author: authorFromAbstract(it.abstract),
      coverUrl: it.cover_url || undefined,
      rating: Number(it.rating.value),
      ratingCount: it.rating.count ?? undefined,
      url: it.url || (it.id ? `https://book.douban.com/subject/${it.id}/` : undefined),
      score: s,
      partial: s < 100,
    })
  }
  out.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
  return dedupe(out).slice(0, 4)
}

/** 兜底：suggest 找 id → rexxar 取评分（搜索结果页结构变了时用） */
const fromSuggest = async (title: string, author?: string): Promise<SourceCandidate[]> => {
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
  if (!best || bestScore < MATCH_FLOOR) return []

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
  if (!value || value <= 0) return []
  return [
    {
      site: 'douban',
      siteName: '豆瓣',
      bookId: String(best.id),
      title: best.title ?? title,
      author: best.author_name ?? '',
      coverUrl: best.pic || undefined,
      rating: Number(value),
      ratingCount: detail?.rating?.count,
      url: `https://book.douban.com/subject/${best.id}/`,
      score: bestScore,
      partial: bestScore < 100,
    },
  ]
}

/** App 内直连豆瓣；浏览器里没有 CORS 头，走 relay（见 sources.ts） */
export const listDoubanNative = async (
  title: string,
  author?: string,
): Promise<SourceCandidate[]> => {
  const res = await CapacitorHttp.get({
    url: `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(title)}`,
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    responseType: 'text',
    connectTimeout: 8000,
    readTimeout: 10000,
  })
  const html = typeof res.data === 'string' ? res.data : ''
  const hit = fromSearchPage(html, title, author)
  if (hit && hit.length) return hit
  if (hit && hit.length === 0) return []
  return fromSuggest(title, author)
}

/** 归一化书名给上层去重用（不同源的书名可能差标点） */
export { isVolumeLike, normTitle }
