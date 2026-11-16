import type { TocItem } from '../types'
import { langText, openBook, type FoliateBook } from '../reader/book'

export interface ParsedEpub {
  title: string
  author: string
  publisher?: string
  language?: string
  description?: string
  toc: TocItem[]
  chapterCount: number
  cover?: Blob
}

const COVER_EDGE = 480

const stripExt = (name: string): string =>
  name.replace(/\.epub$/i, '').replace(/[_]+/g, ' ').trim()

/**
 * 文件名兜底作者：OPF 里没有 dc:creator 时（多见于 repack/多看版），作者只在文件名里。
 * 按可靠度依次试：①《书名》后面紧跟 ② 书名-作者（多看/知轩） ③ [作者][标签] ④ 结尾 (作者)。
 * 每个候选都要过两道闸：不像版本词（初版/精校/第X卷…）、像人名（2-12 字、不以数字开头）。
 */
const NOT_AUTHOR = /初版|重置|精校|全本|校对|完本|自制|多看|全屏|全面|版本|番外|连载|删减|修订|合集|repack|txt|epub|第[一二三四五六七八九十百\d]+[部卷章节集]/i
const AUTHOR_LIKE = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9·.]{1,11}$/

const stripDecor = (s: string): string =>
  s
    .replace(/（[^）]*）/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[[【｛{][^\]】｝}]*[\]】｝}]/g, ' ')
    .replace(/作者[：:]\s*/g, '')
    .replace(/\s*著\s*/g, ' ')
    .replace(/\sv\d+(?:\.\d+)*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

const pickAuthor = (s: string | undefined): string | undefined => {
  if (!s) return undefined
  const cand = stripDecor(s)
  if (!cand || NOT_AUTHOR.test(cand) || !AUTHOR_LIKE.test(cand)) return undefined
  return cand
}

const authorFromName = (name: string): string | undefined => {
  const raw = name.replace(/\.epub$/i, '').trim()
  // ①《书名》作者
  const byBook = pickAuthor(/》\s*(.+)$/.exec(raw)?.[1])
  if (byBook) return byBook
  // ② 书名-作者[标签]v1.0
  const base = raw.replace(/^【[^】]*】\s*/, '')
  const segs = base.split(/[-－]/)
  if (segs.length === 2) {
    const byDash = pickAuthor(segs[1])
    if (byDash) return byDash
  }
  // ③ 编号-书名[作者][标签][by转载者]：第一个方括号是作者
  const byBracket = pickAuthor(/\[([^\]]{2,12})\]/.exec(raw)?.[1])
  if (byBracket) return byBracket
  // ④ 结尾 (作者)
  return pickAuthor(/[(（]([^)）]{2,12})[)）]\s*$/.exec(raw)?.[1])
}

const cleanText = (s: string): string =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const flattenToc = (items: any[] | undefined, depth = 0, out: TocItem[] = []): TocItem[] => {
  if (!items) return out
  for (const item of items) {
    const label = cleanText(langText(item.label) || '')
    const href = item.href ?? ''
    if (label || href) out.push({ label, href, depth })
    if (item.subitems?.length) flattenToc(item.subitems, depth + 1, out)
  }
  return out
}

/** 把封面缩到长边 480 的 webp，避免书架存原图 */
const shrink = async (blob: Blob): Promise<Blob | undefined> => {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = COVER_EDGE / Math.max(bitmap.width, bitmap.height)
    const w = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)))
    const h = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.84 })
    return out.size > 0 ? out : blob
  } catch {
    return blob
  }
}

const extractCover = async (book: FoliateBook): Promise<Blob | undefined> => {
  try {
    const blob = await book.getCover?.()
    if (blob && blob.size > 0) return await shrink(blob)
  } catch {
    /* 无封面 */
  }
  return undefined
}

export const parseEpub = async (file: File): Promise<ParsedEpub> => {
  const book = await openBook(file)
  const md = book.metadata ?? {}
  const title = cleanText(langText(md.title)) || stripExt(file.name)
  const author = cleanText(langText(md.author)) || authorFromName(file.name) || '佚名'
  const toc = flattenToc(book.toc)
  const cover = await extractCover(book)

  return {
    title,
    author,
    publisher: cleanText(langText(md.publisher)) || undefined,
    language: cleanText(langText(md.language)) || undefined,
    description: cleanText(langText(md.description)).slice(0, 600) || undefined,
    toc,
    chapterCount: book.sections?.length ?? 0,
    cover,
  }
}
