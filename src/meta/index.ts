import { db, patchBook } from '../db'
import type { Book } from '../types'
import { lookupDouban } from './douban'
import { tagsFromName } from './tags'

/**
 * 元数据补全入口。
 * - 标签：本地从文件名生成，导入时已写好；这里只负责给老书补齐（版本升级前导入的书没有）。
 * - 评分：问豆瓣要。查不到就留空，不猜。
 *
 * 批量补全刻意慢：豆瓣对高频请求会 403，一本之间隔 600ms、并发 2，
 * 500 本全跑一遍大约 3 分钟——比被封 IP 强。
 */

export interface EnrichPatch {
  tags?: string[]
  rating?: number
  ratingCount?: number
  metaSource?: Book['metaSource']
  metaUpdatedAt?: number
}

/** 给一本书算出「还缺什么」并补上，返回要写入的字段（没有可写的返回 null） */
export const enrichOne = async (book: Book, opts: { tags?: boolean; rating?: boolean } = {}): Promise<EnrichPatch | null> => {
  const wantTags = opts.tags !== false
  const wantRating = opts.rating !== false
  const patch: EnrichPatch = {}

  if (wantTags && !book.tags?.length) {
    const tags = tagsFromName(book.title, book.author).map((t) => t.name)
    if (tags.length) patch.tags = tags
  }

  if (wantRating && book.rating == null) {
    const hit = await lookupDouban(book.title, book.author)
    if (hit) {
      patch.rating = hit.rating
      patch.ratingCount = hit.count
      patch.metaSource = 'douban'
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
    const needRating = opts.rating !== false && b.rating == null
    return needTags || needRating
  })

  const res: EnrichResult = { ok: 0, miss: 0, failed: 0, patched: 0 }
  let done = 0

  for (const book of targets) {
    if (opts.isCancelled?.()) break
    opts.onProgress?.(done, targets.length, book.title)
    try {
      const patch = await enrichOne(book, { tags: opts.tags, rating: opts.rating })
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
