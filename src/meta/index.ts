import { ref } from 'vue'
import { db, patchBook } from '../db'
import type { Book } from '../types'
import { lastMetaError, lookupDouban, normTitle } from './douban'
import { lastWereadError, lookupWeread } from './weread'
import { tagsFromName } from './tags'
import type { RatingHit } from './types'

/**
 * 元数据补全入口。
 * - 标签：本地从文件名生成，导入时已写好；这里只负责给老书补齐（版本升级前导入的书没有）。
 * - 评分：豆瓣优先，微信读书兜底。查不到就留空，不猜。
 *
 * 批量补全刻意慢：豆瓣对高频请求会 403，一本之间隔 600ms、并发 2，
 * 500 本全跑一遍大约 3 分钟——比被封 IP 强。
 */

export type { RatingHit }

/** 两个源都没查到时给界面看的合并提示 */
export const lastRatingError = ref<string | null>(null)

/**
 * 双源评分查询。
 *
 * 顺序不是简单的「豆瓣优先」，因为豆瓣对网文常常只有分卷评分：
 * 《剑来》在豆瓣能搜到《剑来1：少年起微末》7.0 分（2463 人），
 * 而微信读书的《剑来》是全集 8.6（15.5 万人）。用前者代表整套书明显偏低。
 *
 * 所以规则是：
 *   1. 豆瓣精确同名 → 用豆瓣（出版物的豆瓣分区分度比推荐值好）
 *   2. 否则问微信读书，命中就用微信读书（覆盖全集/连载，样本也大）
 *   3. 微信读书也没有 → 退回豆瓣的分卷分数，但标 partial，界面要能看出来
 */
export const lookupRating = async (title: string, author?: string): Promise<RatingHit | null> => {
  lastRatingError.value = null
  lastMetaError.value = null
  lastWereadError.value = null

  const dbHit = await lookupDouban(title, author)
  const dbErr = lastMetaError.value
  if (dbHit && normTitle(dbHit.matchedTitle) === normTitle(title)) return dbHit

  const wrHit = await lookupWeread(title, author)
  const wrErr = lastWereadError.value
  if (wrHit) return wrHit
  if (dbHit) return { ...dbHit, partial: true }

  lastRatingError.value =
    [dbErr, wrErr].filter(Boolean).join('；') || '豆瓣和微信读书都没收录这本'
  return null
}

export interface EnrichPatch {
  tags?: string[]
  rating?: number
  ratingCount?: number
  metaSource?: Book['metaSource']
  metaUpdatedAt?: number
}

/** 给一本书算出「还缺什么」并补上，返回要写入的字段（没有可写的返回 null） */
export const enrichOne = async (
  book: Book,
  opts: { tags?: boolean; rating?: boolean; overwrite?: boolean } = {},
): Promise<EnrichPatch | null> => {
  const wantTags = opts.tags !== false
  const wantRating = opts.rating !== false
  // 覆盖重查时不碰手动打的分：那是用户自己看过书之后的判断，没理由被网络数据顶掉
  const ratingNeeded =
    wantRating && (book.rating == null || (opts.overwrite === true && book.metaSource !== 'manual'))
  const patch: EnrichPatch = {}

  if (wantTags && !book.tags?.length) {
    const tags = tagsFromName(book.title, book.author).map((t) => t.name)
    if (tags.length) patch.tags = tags
  }

  if (ratingNeeded) {
    const hit = await lookupRating(book.title, book.author)
    if (hit) {
      patch.rating = hit.rating
      patch.ratingCount = hit.count
      patch.metaSource = hit.source
      patch.metaUpdatedAt = Date.now()
    }
  }

  return Object.keys(patch).length ? patch : null
}

export interface EnrichResult {
  ok: number
  miss: number
  failed: number
  patched: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface EnrichOptions {
  tags?: boolean
  rating?: boolean
  /** 连已有评分一起重查（手动打的分仍然跳过）。用于规则升级后把旧的低分刷成准的 */
  overwrite?: boolean
  /** 每本间隔毫秒数，默认 600 */
  gap?: number
  onProgress?: (done: number, total: number, title: string) => void
  /** 返回 true 就停下 */
  isCancelled?: () => boolean
}

/** 批量补全：只处理缺字段的书 */
export const enrichMany = async (list: Book[], opts: EnrichOptions = {}): Promise<EnrichResult> => {
  const gap = opts.gap ?? 600
  const targets = list.filter((b) => {
    const needTags = opts.tags !== false && !b.tags?.length
    const needRating =
      opts.rating !== false &&
      (b.rating == null || (opts.overwrite === true && b.metaSource !== 'manual'))
    return needTags || needRating
  })

  const res: EnrichResult = { ok: 0, miss: 0, failed: 0, patched: 0 }
  let done = 0

  for (const book of targets) {
    if (opts.isCancelled?.()) break
    opts.onProgress?.(done, targets.length, book.title)
    try {
      const patch = await enrichOne(book, {
        tags: opts.tags,
        rating: opts.rating,
        overwrite: opts.overwrite,
      })
      if (patch) {
        if (book.id != null) await patchBook(book.id, patch)
        res.patched += 1
        if (patch.rating != null) res.ok += 1
        else res.miss += 1
      } else {
        res.miss += 1
      }
    } catch {
      res.failed += 1
    }
    done += 1
    if (gap > 0 && done < targets.length) await sleep(gap)
  }

  opts.onProgress?.(done, targets.length, '')
  return res
}

/**
 * 给升级前导入的老书补标签。
 *
 * v1.9.0 之前导入的书没有 tags 字段，但那时候 title 还没做清洗，
 * 往往还带着 `【W18】…[游戏异界]v1.0` 的原始痕迹，正好能反向提取。
 * 纯本地操作、幂等，启动时跑一次不影响速度。
 */
export const backfillTags = async (): Promise<number> => {
  const all = await db.books.toArray()
  const need = all.filter((b) => !b.tags?.length)
  if (!need.length) return 0
  let patched = 0
  for (const b of need) {
    const tags = tagsFromName(b.title, b.author).map((t) => t.name)
    if (tags.length && b.id != null) {
      await patchBook(b.id, { tags })
      patched += 1
    }
  }
  return patched
}
