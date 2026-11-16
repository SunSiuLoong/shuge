import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { dav } from '../sync/webdav'
import { listDoubanNative } from './douban'
import { normTitle } from './match'
import type { SourceCandidate } from './types'
import { listWereadNative } from './weread'

/**
 * 多源候选查询：一次问所有评分站，按「评分人数」从多到少排。
 *
 * 这是「关联」面板的数据源，也是导入后自动关联的依据。
 * 用户定的规则是「评分人数最多的站」——人数代表样本量，比按站点固定优先级更合理：
 * 《活着》豆瓣 93 万 > 微信读书 21 万，用豆瓣；《剑来》微信读书 15.5 万 > 豆瓣分卷 2463，用微信读书。
 *
 * 浏览器里两个站都没有 CORS 头，走 relay 的 /api/meta/sources；
 * App 内用原生 HTTP 直连，不需要中继。
 */

export const lastSourceError = ref<string | null>(null)

const relayBase = (): string => (dav.relay || '').replace(/\/+$/, '')

/**
 * 豆瓣封面有防盗链，不带 Referer 直接 418，而 img 标签改不了 Referer。
 * 有中继时统一让中继去取（它也顺手做了缓存）；没配中继就原样返回，图挂了由 UI 兜底。
 */
const coverSrc = (u?: string): string | undefined => {
  if (!u) return undefined
  const base = relayBase()
  if (!base) return u
  if (!/doubanio\.com|douban\.com/i.test(u)) return u
  return `${base}/api/meta/cover?url=${encodeURIComponent(u)}`
}

const withCovers = (list: SourceCandidate[]): SourceCandidate[] =>
  list.map((c) => ({ ...c, coverUrl: coverSrc(c.coverUrl) }))

/** 两条以上强匹配时，把只是名字相近的（《活着为了讲述》）挤掉 */
const finalize = (list: SourceCandidate[]): SourceCandidate[] => {
  const seen = new Set<string>()
  const clean = list.filter((x) => {
    if (!x || typeof x.rating !== 'number' || !(x.rating > 0)) return false
    const key = `${x.site}:${normTitle(x.title)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  clean.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
  const strong = clean.filter((x) => x.score >= 85)
  return (strong.length >= 2 ? strong : clean).slice(0, 6)
}

/** 评分人数最多的那条；人数一样时取匹配度高的 */
export const pickBest = (list: SourceCandidate[]): SourceCandidate | null => {
  let best: SourceCandidate | null = null
  for (const c of list) {
    if (!best) {
      best = c
      continue
    }
    const a = c.ratingCount ?? 0
    const b = best.ratingCount ?? 0
    if (a > b || (a === b && c.score > best.score)) best = c
  }
  return best
}

const fromRelay = async (title: string, author?: string): Promise<SourceCandidate[]> => {
  const base = relayBase()
  if (!base) {
    lastSourceError.value = '浏览器里查评分需要先在同步设置里填中继地址'
    return []
  }
  const qs = new URLSearchParams({ title })
  if (author) qs.set('author', author)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 25000)
  try {
    const res = await fetch(`${base}/api/meta/sources?${qs.toString()}`, { signal: ctl.signal })
    if (!res.ok) {
      lastSourceError.value = `中继返回 ${res.status}`
      return []
    }
    const data = (await res.json()) as {
      ok?: boolean
      items?: SourceCandidate[]
      notes?: string[]
      reason?: string
    }
    if (data.ok === false) {
      lastSourceError.value = data.reason || '中继查询失败'
      return []
    }
    const items = Array.isArray(data.items) ? withCovers(data.items) : []
    if (!items.length) {
      lastSourceError.value = (data.notes ?? []).filter(Boolean).join('；') || '各评分站都没收录这本'
    }
    return items
  } catch (e) {
    lastSourceError.value =
      e instanceof Error && e.name === 'AbortError' ? '请求超时' : '网络不通或中继未启动'
    return []
  } finally {
    clearTimeout(timer)
  }
}

const fromNative = async (title: string, author?: string): Promise<SourceCandidate[]> => {
  const notes: string[] = []
  const [db, wr] = await Promise.allSettled([
    listDoubanNative(title, author),
    listWereadNative(title, author),
  ])
  const items: SourceCandidate[] = []
  if (db.status === 'fulfilled') items.push(...db.value)
  else notes.push(`豆瓣：${db.reason instanceof Error ? db.reason.message : String(db.reason)}`)
  if (wr.status === 'fulfilled') items.push(...wr.value)
  else notes.push(`微信读书：${wr.reason instanceof Error ? wr.reason.message : String(wr.reason)}`)
  if (!items.length) {
    lastSourceError.value = notes.join('；') || '各评分站都没收录这本'
  }
  return withCovers(items)
}

export const searchSources = async (
  title: string,
  author?: string,
): Promise<SourceCandidate[]> => {
  lastSourceError.value = null
  try {
    const items = Capacitor.isNativePlatform()
      ? await fromNative(title, author)
      : await fromRelay(title, author)
    return finalize(items)
  } catch (e) {
    lastSourceError.value = e instanceof Error ? e.message : String(e)
    return []
  }
}
