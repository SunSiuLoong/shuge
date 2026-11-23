import Dexie, { type Table } from 'dexie'
import type { Book, Bookmark, Group, Progress, StoredFont } from '../types'

/** 引用模式存的文件句柄（FileSystemFileHandle 可结构化克隆，Dexie 直接存） */
export interface StoredHandle {
  id: string
  handle: unknown
}

export class ReaderDB extends Dexie {
  books!: Table<Book, number>
  progress!: Table<Progress, number>
  bookmarks!: Table<Bookmark, number>
  groups!: Table<Group, number>
  fonts!: Table<StoredFont, string>
  handles!: Table<StoredHandle, string>

  constructor() {
    super('shuge-reader')
    this.version(1).stores({
      books: '++id, title, author, addedAt, lastOpenedAt, fingerprint, *tags, rating',
      progress: '++id, &bookId, updatedAt',
      bookmarks: '++id, bookId, [bookId+cfi], createdAt',
      groups: '++id, name, order',
    })
    // v2：用户导入的阅读字体（ttf/otf/woff），存二进制，随书库一起在本地
    this.version(2).stores({
      books: '++id, title, author, addedAt, lastOpenedAt, fingerprint, *tags, rating',
      progress: '++id, &bookId, updatedAt',
      bookmarks: '++id, bookId, [bookId+cfi], createdAt',
      groups: '++id, name, order',
      fonts: '&id, addedAt',
    })
    // v3：引用模式（不复制原文件）的桌面文件句柄
    this.version(3).stores({
      books: '++id, title, author, addedAt, lastOpenedAt, fingerprint, *tags, rating',
      progress: '++id, &bookId, updatedAt',
      bookmarks: '++id, bookId, [bookId+cfi], createdAt',
      groups: '++id, name, order',
      fonts: '&id, addedAt',
      handles: '&id',
    })
  }
}

export const db = new ReaderDB()

/** 书架排序不变式：最近打开优先，其次按导入时间倒序 */
export const listBooks = async (): Promise<Book[]> => {
  const all = await db.books.toArray()
  return all.sort((a, b) =>
    (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt)
}

export const getBook = (id: number): Promise<Book | undefined> => db.books.get(id)

/**
 * Dexie 的 update 不接受 undefined：`link` 这种对象里只要有一个字段是 undefined，
 * 整条更新就会抛 DataError（表现是「点了没反应」，很容易误判成 UI 问题）。
 * 这里深度清一遍：对象里的 undefined 直接删掉，顶层 undefined 存成 null 表示「清空」。
 */
const cleanValue = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(cleanValue)
  if (v && typeof v === 'object' && !(v instanceof Blob) && !(v instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue
      out[k] = cleanValue(val)
    }
    return out
  }
  return v
}

const cleanPatch = (patch: Partial<Book>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v === undefined ? null : cleanValue(v)
  }
  return out
}

/**
 * 局部更新书籍字段。
 * Book.toc 是递归结构，Dexie 的 UpdateSpec 映射类型会因此报 TS2615，故在此收敛掉类型。
 */
export const patchBook = (id: number, patch: Partial<Book>): Promise<number> =>
  (db.books as unknown as {
    update: (key: number, changes: Record<string, unknown>) => Promise<number>
  }).update(id, cleanPatch(patch))

/**
 * 批量改写标签：所有书放进同一个读写事务，一次提交。
 *
 * 为什么必须批量：
 * 书架用 liveQuery 订阅 books + progress，Dexie 每完成一个写事务就全量重读一次
 * （Book 里还带封面 Blob）。逐本 update 删一个大标签 = 几百次事务 = 几百次全量
 * 重读 + 几百次整页重渲染，安卓 WebView 直接按 OOM 杀进程——表现就是「删标签删
 * 到一半 App 闪退」。合成一个事务后只触发一次重算。
 */
export const patchTagsBulk = async (
  changes: Array<{ id: number; tags: string[] | undefined }>,
): Promise<number> => {
  if (!changes.length) return 0
  return db.transaction('rw', db.books, async () => {
    const table = db.books as unknown as {
      update: (key: number, changes: Record<string, unknown>) => Promise<number>
    }
    let n = 0
    for (const c of changes) {
      // 空数组要写 null（Dexie 不认 undefined），否则标签页会留一个「空壳」
      n += await table.update(c.id, { tags: c.tags && c.tags.length ? c.tags : null })
    }
    return n
  })
}

export const findByFingerprint = (fingerprint: string): Promise<Book | undefined> =>
  db.books.where('fingerprint').equals(fingerprint).first()

export const getProgress = async (bookId: number): Promise<Progress | undefined> =>
  db.progress.where('bookId').equals(bookId).first()

export const saveProgress = async (p: Progress): Promise<void> => {
  const exist = await db.progress.where('bookId').equals(p.bookId).first()
  if (exist?.id) await db.progress.update(exist.id, { ...p, id: exist.id })
  else await db.progress.add(p)
}

export const listBookmarks = (bookId: number): Promise<Bookmark[]> =>
  db.bookmarks.where('bookId').equals(bookId).reverse().sortBy('createdAt')

export const addBookmark = (b: Bookmark): Promise<number> => db.bookmarks.add(b)

export const removeBookmark = (id: number): Promise<void> => db.bookmarks.delete(id)

export const deleteBook = async (id: number): Promise<void> => {
  await db.transaction('rw', [db.books, db.progress, db.bookmarks, db.handles], async () => {
    // 引用模式的书在 handles 表里存着句柄，不删就永久堆积（每本书一条）
    const book = await db.books.get(id)
    if (book?.refKey) await db.handles.delete(book.refKey)
    await db.books.delete(id)
    await db.progress.where('bookId').equals(id).delete()
    await db.bookmarks.where('bookId').equals(id).delete()
  })
}
