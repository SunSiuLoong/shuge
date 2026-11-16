import { CapacitorHttp } from '@capacitor/core'
import { scoreOf, MATCH_FLOOR } from './match'
import type { SourceCandidate } from './types'

/**
 * 微信读书候选。
 *
 * 为什么用这个源：豆瓣对连载网文覆盖差，而且常常只有「分卷」评分。
 * 实测 2026-11-16，12 本书全部命中，包括豆瓣没有的《剑来》《秘术纪元》。
 *
 * 接口是搜索页自己用的那个 JSON 接口，不需要登录、不需要 Cookie：
 *   GET https://weread.qq.com/web/search/global?keyword=<书名>
 * `bookInfo.newRating` 是推荐值（0–1000，即 0–100%），`newRatingCount` 是评分人数，
 * `cover` 是书封，`author` 用来交叉核对防串书。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

interface WereadBook {
  bookId?: string
  title?: string
  author?: string
  cover?: string
  newRating?: number
  newRatingCount?: number
}

/** 把接口返回的一页结果转成候选，按评分人数降序，最多 4 条 */
export const pickWeread = (
  list: WereadBook[],
  title: string,
  author?: string,
): SourceCandidate[] => {
  const out: SourceCandidate[] = []
  for (const b of list) {
    if (!b || !(Number(b.newRating) > 0)) continue
    const s = scoreOf(b.title ?? '', b.author, title, author)
    if (s < MATCH_FLOOR) continue
    // 5 人以下的推荐值没有参考意义，宁可留空
    if (Number(b.newRatingCount ?? 0) < 5) continue
    const raw = Number(b.newRating)
    out.push({
      site: 'weread',
      siteName: '微信读书',
      bookId: b.bookId ? String(b.bookId) : undefined,
      title: b.title ?? title,
      author: b.author ?? '',
      coverUrl: b.cover || undefined,
      // 推荐值本质是百分比，折算到十分制才能和豆瓣同屏排序
      rating: Math.round(raw / 10) / 10,
      ratingCount: b.newRatingCount ?? undefined,
      percent: Math.round(raw) / 10,
      url: b.bookId ? `https://weread.qq.com/web/bookDetail/${b.bookId}` : undefined,
      score: s,
      partial: s < 100,
    })
  }
  out.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
  const seen = new Set<string>()
  return out
    .filter((x) => {
      if (seen.has(x.title)) return false
      seen.add(x.title)
      return true
    })
    .slice(0, 4)
}

/** App 内直连微信读书；浏览器里走 relay（见 sources.ts） */
export const listWereadNative = async (
  title: string,
  author?: string,
): Promise<SourceCandidate[]> => {
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
  return pickWeread(list, title, author)
}
