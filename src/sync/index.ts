import { db, saveProgress, patchBook } from '../db'
import type { Book, Progress } from '../types'
import { dav, davConfigured, ensureDir, readRemote, writeRemote } from './webdav'

/**
 * 同步什么、不同步什么：
 * - 只同步「索引 + 进度 + 书签」，不同步 epub 本体。500 本十几 MB 的书传网盘既慢又没必要，
 *   书本身留在手机本地，换设备时自己拷文件。
 * - 书的唯一键用指纹（导入时算的采样哈希），因为本地 id 是自增的，跨设备对不上。
 * - 合并规则：进度按 updatedAt 取新；书签按 (指纹 + cfi) 去重；书名作者以本地为准，
 *   只补空（比如本地是「佚名」而远端有作者）。
 */
export interface SyncBook {
  fingerprint: string
  title: string
  author: string
  chapterCount: number
  fileSize: number
  addedAt: number
  lastOpenedAt?: number
  tags?: string[]
  rating?: number
}

export interface SyncProgress {
  fingerprint: string
  cfi?: string
  fraction: number
  chapterIndex: number
  percent: number
  chapterLabel?: string
  updatedAt: number
}

export interface SyncBookmark {
  fingerprint: string
  cfi: string
  excerpt: string
  chapterIndex: number
  percent: number
  note?: string
  createdAt: number
}

export interface Snapshot {
  version: 1
  deviceId: string
  updatedAt: number
  books: SyncBook[]
  progress: SyncProgress[]
  bookmarks: SyncBookmark[]
}

export interface SyncReport {
  at: number
  booksLocal: number
  booksRemoteOnly: number
  progressApplied: number
  progressPushed: number
  bookmarksApplied: number
  bookmarksPushed: number
  authorsFilled: number
}

const DEVICE_KEY = 'shuge.device.v1'

const deviceId = (): string => {
  try {
    const exist = localStorage.getItem(DEVICE_KEY)
    if (exist) return exist
    const id = `dev-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    return 'dev-anon'
  }
}

const emptySnapshot = (): Snapshot => ({
  version: 1,
  deviceId: deviceId(),
  updatedAt: Date.now(),
  books: [],
  progress: [],
  bookmarks: [],
})

/** 把本地库读成快照 */
export const buildSnapshot = async (): Promise<Snapshot> => {
  const [books, progress, bookmarks] = await Promise.all([
    db.books.toArray(),
    db.progress.toArray(),
    db.bookmarks.toArray(),
  ])
  const byId = new Map<number, Book>()
  for (const b of books) if (b.id != null) byId.set(b.id, b)

  const toBook = (b: Book): SyncBook => ({
    fingerprint: b.fingerprint,
    title: b.title,
    author: b.author,
    chapterCount: b.chapterCount,
    fileSize: b.fileSize,
    addedAt: b.addedAt,
    lastOpenedAt: b.lastOpenedAt,
    tags: b.tags,
    rating: b.rating,
  })

  const toProgress = (p: Progress): SyncProgress | null => {
    const book = byId.get(p.bookId)
    if (!book) return null
    return {
      fingerprint: book.fingerprint,
      cfi: p.cfi,
      fraction: p.fraction,
      chapterIndex: p.chapterIndex,
      percent: p.percent,
      chapterLabel: p.chapterLabel,
      updatedAt: p.updatedAt,
    }
  }

  const toBookmark = (bm: (typeof bookmarks)[number]): SyncBookmark | null => {
    const book = byId.get(bm.bookId)
    if (!book) return null
    return {
      fingerprint: book.fingerprint,
      cfi: bm.cfi,
      excerpt: bm.excerpt,
      chapterIndex: bm.chapterIndex,
      percent: bm.percent,
      note: bm.note,
      createdAt: bm.createdAt,
    }
  }

  return {
    version: 1,
    deviceId: deviceId(),
    updatedAt: Date.now(),
    books: books.map(toBook),
    progress: progress.map(toProgress).filter((p): p is SyncProgress => p !== null),
    bookmarks: bookmarks.map(toBookmark).filter((b): b is SyncBookmark => b !== null),
  }
}

const isFilled = (s: string | undefined): boolean =>
  Boolean(s && s.trim() && s.trim() !== '佚名')

/** 合并：远端进本地、本地进远端，逐条取新 */
export const mergeSnapshot = (
  local: Snapshot,
  remote: Snapshot,
): { merged: Snapshot; remoteOnlyBooks: number } => {
  const books = new Map<string, SyncBook>()
  for (const b of remote.books) books.set(b.fingerprint, b)
  let remoteOnlyBooks = 0
  for (const b of local.books) {
    const r = books.get(b.fingerprint)
    if (!r) {
      books.set(b.fingerprint, b)
      continue
    }
    // 元数据只补空，不覆盖本地已有的（本地可能被用户手改过）
    books.set(b.fingerprint, {
      ...r,
      ...b,
      author: isFilled(b.author) ? b.author : r.author,
      title: isFilled(b.title) ? b.title : r.title,
      tags: b.tags?.length ? b.tags : r.tags,
      rating: b.rating ?? r.rating,
      lastOpenedAt: Math.max(b.lastOpenedAt ?? 0, r.lastOpenedAt ?? 0) || undefined,
    })
  }
  const localKeys = new Set(local.books.map((b) => b.fingerprint))
  for (const r of remote.books) if (!localKeys.has(r.fingerprint)) remoteOnlyBooks += 1

  const progress = new Map<string, SyncProgress>()
  for (const p of remote.progress) progress.set(p.fingerprint, p)
  for (const p of local.progress) {
    const r = progress.get(p.fingerprint)
    if (!r || p.updatedAt >= r.updatedAt) progress.set(p.fingerprint, p)
  }

  const bookmarks = new Map<string, SyncBookmark>()
  for (const bm of remote.bookmarks) bookmarks.set(`${bm.fingerprint}|${bm.cfi}`, bm)
  for (const bm of local.bookmarks) bookmarks.set(`${bm.fingerprint}|${bm.cfi}`, bm)

  return {
    merged: {
      version: 1,
      deviceId: local.deviceId,
      updatedAt: Date.now(),
      books: [...books.values()],
      progress: [...progress.values()],
      bookmarks: [...bookmarks.values()],
    },
    remoteOnlyBooks,
  }
}

/** 把合并结果写回本地：进度更旧的跳过，书签去重，作者只补空 */
export const applySnapshot = async (
  snapshot: Snapshot,
): Promise<{ progress: number; bookmarks: number; authors: number; missing: number }> => {
  const books = await db.books.toArray()
  const byFp = new Map<string, Book>()
  for (const b of books) byFp.set(b.fingerprint, b)

  let progress = 0
  let bookmarks = 0
  let authors = 0
  let missing = 0

  for (const sp of snapshot.progress) {
    const book = byFp.get(sp.fingerprint)
    if (!book?.id) {
      missing += 1
      continue
    }
    const exist = await db.progress.where('bookId').equals(book.id).first()
    if (exist && (exist.updatedAt ?? 0) >= sp.updatedAt) continue
    await saveProgress({
      bookId: book.id,
      cfi: sp.cfi,
      fraction: sp.fraction,
      chapterIndex: sp.chapterIndex,
      percent: sp.percent,
      chapterLabel: sp.chapterLabel,
      updatedAt: sp.updatedAt,
    })
    progress += 1
  }

  for (const sb of snapshot.bookmarks) {
    const book = byFp.get(sb.fingerprint)
    if (!book?.id) continue
    const exist = await db.bookmarks
      .where('[bookId+cfi]')
      .equals([book.id, sb.cfi])
      .first()
    if (exist) continue
    await db.bookmarks.add({
      bookId: book.id,
      cfi: sb.cfi,
      excerpt: sb.excerpt,
      chapterIndex: sb.chapterIndex,
      percent: sb.percent,
      note: sb.note,
      createdAt: sb.createdAt,
    })
    bookmarks += 1
  }

  for (const sb of snapshot.books) {
    const book = byFp.get(sb.fingerprint)
    if (!book?.id) continue
    if (!isFilled(book.author) && isFilled(sb.author)) {
      await patchBook(book.id, { author: sb.author })
      authors += 1
    }
  }

  return { progress, bookmarks, authors, missing }
}

/** 一次完整同步：拉远端 → 合并 → 写本地 → 推远端 */
export const syncNow = async (): Promise<SyncReport> => {
  if (!davConfigured()) throw new Error('WebDAV 还没配全')
  await ensureDir()

  const local = await buildSnapshot()
  const raw = await readRemote()
  let remote = emptySnapshot()
  if (raw) {
    try {
      remote = JSON.parse(raw) as Snapshot
    } catch {
      // 远端文件坏了不能直接覆盖，先报错，让人自己决定
      throw new Error('远端 shuge.json 解析失败，没有覆盖它。可以手动删掉再同步。')
    }
  }

  const { merged, remoteOnlyBooks } = mergeSnapshot(local, remote)
  const applied = await applySnapshot(merged)
  const afterApply = await buildSnapshot()
  const finalMerge = mergeSnapshot(afterApply, merged)
  await writeRemote(JSON.stringify(finalMerge.merged))

  const report: SyncReport = {
    at: Date.now(),
    booksLocal: afterApply.books.length,
    booksRemoteOnly: remoteOnlyBooks,
    progressApplied: applied.progress,
    progressPushed: afterApply.progress.length,
    bookmarksApplied: applied.bookmarks,
    bookmarksPushed: afterApply.bookmarks.length,
    authorsFilled: applied.authors,
  }

  dav.lastSyncAt = report.at
  dav.lastResult = reportText(report)
  return report
}

export const reportText = (r: SyncReport): string => {
  const parts = [`进度 +${r.progressApplied}`, `书签 +${r.bookmarksApplied}`]
  if (r.authorsFilled) parts.push(`补作者 ${r.authorsFilled}`)
  if (r.booksRemoteOnly) parts.push(`远端多 ${r.booksRemoteOnly} 本（本地没文件）`)
  return parts.join(' · ')
}

export const formatTime = (ts: number): string => {
  if (!ts) return '从未'
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const AUTO_GAP = 10 * 60 * 1000

/**
 * 启动时的自动同步：静默失败。
 * 失败原因不弹窗（一开 App 就弹错很烦），但会写进 dav.lastResult，设置页能看到。
 * 10 分钟内同步过就跳过，避免切前后台来回打请求。
 */
export const maybeAutoSync = async (): Promise<void> => {
  if (!dav.auto || !davConfigured()) return
  if (Date.now() - dav.lastSyncAt < AUTO_GAP) return
  try {
    await syncNow()
  } catch (e) {
    dav.lastResult = `自动同步失败：${e instanceof Error ? e.message : String(e)}`
  }
}
