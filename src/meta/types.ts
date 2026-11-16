import type { BookLink, LinkSite } from '../types'

/**
 * 一个评分站上的候选条目。
 *
 * 比 BookLink 多两个字段：
 * - `score` 匹配度（书名比对分），界面据此决定要不要提示「这只是分卷」；
 * - `partial` 只匹配到分卷/近似条目，分数代表性差。
 *
 * 两个源统一成同一个形状，前端不用关心背后是谁给的；
 * relay 返回的也是这个形状（字段名一致，见 relay/core.mjs）。
 */
export interface SourceCandidate {
  site: LinkSite
  siteName: string
  bookId?: string
  title: string
  author: string
  coverUrl?: string
  categories?: string[]
  /** 0–10 分制一位小数。豆瓣原样，微信读书按推荐值百分比折算 */
  rating: number
  /** 评分人数。豆瓣是「评价人数」，微信读书是「评分人数」，口径不同但都看样本量 */
  ratingCount?: number
  /** 微信读书推荐值原始百分比（86.1） */
  percent?: number
  url?: string
  score: number
  partial?: boolean
}

/** 候选 → 要落库的关联记录 */
export const toBookLink = (c: SourceCandidate, auto = false): BookLink => ({
  site: c.site,
  siteName: c.siteName,
  bookId: c.bookId,
  title: c.title,
  author: c.author,
  coverUrl: c.coverUrl,
  categories: c.categories,
  rating: c.rating,
  ratingCount: c.ratingCount,
  url: c.url,
  linkedAt: Date.now(),
  auto,
})
