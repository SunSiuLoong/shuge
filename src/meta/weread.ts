import { ref } from 'vue'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { dav } from '../sync/webdav'
import { MATCH_FLOOR, scoreOf } from './match'
import type { RatingHit } from './types'

/**
 * 微信读书评分查询。
 *
 * 为什么加这个源：豆瓣对连载网文覆盖很差，而且常常只有「分卷」评分。
 * 实测 2026-11-16，12 本书全部命中，包括豆瓣没有的《剑来》《秘术纪元》。
 *
 * 接口是搜索页自己用的那个 JSON 接口，不需要登录、不需要 Cookie：
 *   GET https://weread.qq.com/web/search/global?keyword=<书名>
 * 返回的 `bookInfo.newRating` 是推荐值（0–1000，即 0–100%），`newRatingCount` 是评分人数。
 *
 * 注意推荐值和豆瓣分不是同一个量纲：推荐值天然偏高（80%+ 很常见），
 * 所以只在豆瓣没有精确同名条目时才用它，并且界面上标明来源。
 */

export const lastWereadError = ref<string | null>(null)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

interface WereadBook {
  bookId?: string
  title?: string
  author?: string
  newRating?: number
  newRatingCount?: number
  ispub?: number
}

/** 推荐值 0–1000 折成十分制：861 → 8.6 */
const toTen = (raw: number): number => Math.round(raw / 10) / 10

const pickBest = (list: WereadBook[], title: string, author?: string): RatingHit | null => {
  let best: WereadBook | null = null
  let bestScore = 0
  let bestCount = -1
  for (const b of list) {
    if (!b || !(Number(b.newRating) > 0)) continue
    const s = scoreOf(b.title ?? '', b.author, title, author)
    const cnt = Number(b.newRatingCount ?? 0)
    // 同分取人数多的：同名书里人多的那本才是大众读的那本
    if (s > bestScore || (s === bestScore && cnt > bestCount)) {
      bestScore = s
      bestCount = cnt
      best = b
    }
  }
  if (!best || bestScore < MATCH_FLOOR) return null
  // 5 人以下的推荐值没有参考意义，宁可留空
  if (Number(best.newRatingCount ?? 0) < 5) return null
  const raw = Number(best.newRating)
  return {
    rating: toTen(raw),
    count: best.newRatingCount,
    source: 'weread',
    matchedTitle: best.title ?? title,
    percent: Math.round(raw) / 10,
    url: best.bookId ? `https://weread.qq.com/web/bookDetail/${best.bookId}` : undefined,
  }
}

const relayBase = (): string => (dav.relay || '').replace(/\/+$/, '')

const lookupNative = async (title: string, author?: string): Promise<RatingHit | null> => {
  const res = await CapacitorHttp.get({
    url: `https://weread.qq.com/web/search/global?keyword=${encodeURIComponent(title)}`,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://weread.qq.com/',
    },
    connectTimeout: 8000,
    readTimeout: 10000,
  })
  const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as {
    books?: { bookInfo?: WereadBook }[]
  } | null
  const list = (data?.books ?? []).map((b) => b?.bookInfo).filter(Boolean) as WereadBook[]
  return pickBest(list, title, author)
}

const lookupRelay = async (title: string, author?: string): Promise<RatingHit | null> => {
  const base = relayBase()
  if (!base) {
    lastWereadError.value = '浏览器里查评分需要先在同步设置里填中继地址'
    return null
  }
  const qs = new URLSearchParams({ title })
  if (author) qs.set('author', author)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  try {
    const res = await fetch(`${base}/api/meta/weread?${qs.toString()}`, { signal: ctl.signal })
    if (!res.ok) {
      lastWereadError.value = `中继返回 ${res.status}`
      return null
    }
    const data = (await res.json()) as ({ ok: true } & RatingHit) | { ok: false; reason?: string }
    if (!('ok' in data) || data.ok !== true) {
      lastWereadError.value = ('reason' in data && data.reason) || '微信读书没收录这本'
      return null
    }
    return {
      rating: data.rating,
      count: data.count,
      source: 'weread',
      matchedTitle: data.matchedTitle,
      percent: data.percent,
      url: data.url,
    }
  } catch (e) {
    lastWereadError.value =
      e instanceof Error && e.name === 'AbortError' ? '请求超时' : '网络不通或中继未启动'
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const lookupWeread = async (title: string, author?: string): Promise<RatingHit | null> => {
  try {
    return Capacitor.isNativePlatform()
      ? await lookupNative(title, author)
      : await lookupRelay(title, author)
  } catch (e) {
    lastWereadError.value = e instanceof Error ? e.message : String(e)
    return null
  }
}
