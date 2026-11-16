import { reactive } from 'vue'
import { db, findByFingerprint } from '../db'
import type { Book } from '../types'
import { getStorageInfo, hashFile, putBookFile, deleteBookFile } from '../storage/opfs'
import { parseEpub } from './parse'

export interface ImportResult {
  name: string
  status: 'added' | 'duplicate' | 'failed'
  reason?: string
  bookId?: number
}

export interface ImportState {
  running: boolean
  total: number
  done: number
  currentName: string
  results: ImportResult[]
}

export const importState = reactive<ImportState>({
  running: false,
  total: 0,
  done: 0,
  currentName: '',
  results: [],
})

const isEpub = (file: File): boolean =>
  /\.epub$/i.test(file.name) || file.type === 'application/epub+zip'

const newFileName = (): string => `${crypto.randomUUID()}.epub`

export const importFiles = async (files: File[]): Promise<ImportResult[]> => {
  const epubFiles = files.filter(isEpub)
  const results: ImportResult[] = []

  importState.running = true
  importState.total = epubFiles.length
  importState.done = 0
  importState.currentName = ''
  importState.results = []

  const skipped = files.length - epubFiles.length
  if (skipped > 0) {
    results.push({
      name: `${skipped} 个非 EPUB 文件`,
      status: 'failed',
      reason: '格式不支持，已跳过',
    })
  }

  try {
    for (const file of epubFiles) {
      importState.currentName = file.name
      try {
        // 1. 去重
        const fingerprint = await hashFile(file)
        const dup = await findByFingerprint(fingerprint)
        if (dup) {
          results.push({ name: file.name, status: 'duplicate', bookId: dup.id })
          continue
        }

        // 2. 配额预检
        const info = await getStorageInfo()
        if (info.quota && info.quota - info.usage < file.size * 1.2) {
          results.push({
            name: file.name,
            status: 'failed',
            reason: '可用存储不足',
          })
          continue
        }

        // 3. 解析（同时校验文件完整性）
        const parsed = await parseEpub(file)

        // 4. 落盘
        const fileName = newFileName()
        await putBookFile(fileName, file)

        // 5. 入库
        const record: Book = {
          title: parsed.title,
          author: parsed.author,
          publisher: parsed.publisher,
          language: parsed.language,
          description: parsed.description,
          fileSize: file.size,
          fingerprint,
          cover: parsed.cover,
          toc: parsed.toc,
          chapterCount: parsed.chapterCount,
          opfsPath: fileName,
          addedAt: Date.now(),
        }
        const bookId = await db.books.add(record)
        results.push({ name: file.name, status: 'added', bookId: bookId as number })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({
          name: file.name,
          status: 'failed',
          reason: msg.includes('Failed to load container')
            ? '不是有效的 EPUB 文件'
            : msg,
        })
      } finally {
        importState.done++
        importState.results = [...results]
      }
    }
  } finally {
    importState.running = false
    importState.currentName = ''
  }

  return results
}

/** 删除书籍（含 OPFS 文件） */
export const removeBook = async (book: Book): Promise<void> => {
  if (book.id == null) return
  await deleteBookFile(book.opfsPath)
  await db.transaction('rw', [db.books, db.progress, db.bookmarks], async () => {
    await db.books.delete(book.id!)
    await db.progress.where('bookId').equals(book.id!).delete()
    await db.bookmarks.where('bookId').equals(book.id!).delete()
  })
}
