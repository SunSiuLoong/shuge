import Dexie, { type Table } from 'dexie'
import type { Book, Bookmark, Group, Progress } from '../types'

export class ReaderDB extends Dexie {
  books!: Table<Book, number>
  progress!: Table<Progress, number>
  bookmarks!: Table<Bookmark, number>
  groups!: Table<Group, number>

  constructor() {
    super('shuge-reader')
    this.version(1).stores({
      books: '++id, title, author, addedAt, lastOpenedAt, fingerprint, *tags, rating',
      progress: '++id, &bookId, updatedAt',
      bookmarks: '++id, bookId, [bookId+cfi], createdAt',
      groups: '++id, name, order',
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
 * 局部更新书籍字段。
 * Book.toc 是递归结构，Dexie 的 UpdateSpec 映射类型会因此报 TS2615，故在此收敛掉类型。
 */
export const patchBook = (id: number, patch: Partial<Book>): Promise<number> =>
  (db.books as unknown as {
    update: (key: number, changes: Partial<Book>) => Promise<number>
  }).update(id, patch)

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
  await db.transaction('rw', [db.books, db.progress, db.bookmarks], async () => {
    await db.books.delete(id)
    await db.progress.where('bookId').equals(id).delete()
    await db.bookmarks.where('bookId').equals(id).delete()
  })
}
