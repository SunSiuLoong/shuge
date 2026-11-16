import { ref } from 'vue'
import { db, patchBook } from '../db'
import type { Book } from '../types'
import { settings } from '../settings'
import { lastSourceError, pickBest, searchSources } from './sources'
import { tagsFromName } from './tags'
import type { SourceCandidate } from './types'
import { toBookLink } from './types'

/**
 * 元数据入口。
 * - 标签：本地从文件名 / dc:subject 生成，导入时已写好；这里只负责给老书补齐。
 * - 评分与关联：问各评分站，按「评分人数最多」挑一条自动关联；用户也可以在
 *   编辑面板里打开候选列表自己挑。
 *
 * 批量查询刻意慢：豆瓣对高频请求会 403，一本之间隔 600ms，
 * 500 本全跑一遍大约 3 分钟——比被封 IP 强。
 */

export type { SourceCandidate }
export { searchSources, lastSourceError, pickBest }

/** 查不到时给界面看的提示 */
export const lastRatingError = ref<string | null>(null)

/** 查一条最佳候选。查不到返回 null，不猜。 */
export const lookupRating = async (
  title: string,
  author?: string,
): Promise<SourceCandidate | null> => {
  const list = await searchSources(title, author)
  // 用户在设置里指定的优先站排在最前；auto 时还是按评分人数
  const best = pickBest(list, settings.ratingSource)
  lastRatingError.value = best ? null : lastSourceError.value || '各评分站都没收录这本'
  return best
}

/** 候选 → 书籍字段。关联的意思就是「这本书的评分以这条记录为准」 */
export const linkPatch = (c: SourceCandidate, auto = false): Partial<Book> => ({
  rating: c.rating,
  ratingCount: c.ratingCount,
  metaSource: c.site,
  metaUpdatedAt: Date.now(),
  link: toBookLink(c, auto),
})

export const applyLink = async (
  bookId: number,
  c: SourceCandidate,
  auto = false,
): Promise<void> => {
  await patchBook(bookId, linkPatch(c, auto))
}

/** 解除关联：评分退回手动口径，但保留分数本身（用户可能还想留着排序） */
export const unlinkBook = async (bookId: number): Promise<void> => {
  await patchBook(bookId, { link: undefined, metaSource: 'manual', metaUpdatedAt: Date.now() })
}

export interface EnrichPatch {
  tags?: string[]
  rating?: number
  ratingCount?: number
  metaSource?: Book['metaSource']
  metaUpdatedAt?: number
  link?: Book['link']
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
    if (hit) Object.assign(patch, linkPatch(hit, true))
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
