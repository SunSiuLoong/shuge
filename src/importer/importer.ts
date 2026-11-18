import { reactive } from 'vue'
import { db, findByFingerprint } from '../db'
import type { Book } from '../types'
import { getStorageInfo, hashFile, putBookFile, deleteBookFile, moveBookFileToTrash } from '../storage/opfs'
import { parseEpub } from './parse'
import { enqueueAutoLink } from '../meta/autolink'
import { settings } from '../settings'

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

/** 引用模式的附加信息：桌面是句柄 key，安卓是 content:// uri */
export interface ImportRef {
  refKey?: string
  refUri?: string
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

export const importFiles = async (files: File[]): Promise<ImportResult[]> =>
  importItems(files.map((file) => ({ file })))

export interface ImportItem {
  file: File
  /** 传了就表示这批走「引用原文件」：不落 OPFS，只登记出处 */
  ref?: ImportRef
}

export const importItems = async (items: ImportItem[]): Promise<ImportResult[]> => {
  // 引用开关关掉时，把带引用的条目降级为复制入库
  const epubItems = items
    .filter((it) => isEpub(it.file))
    .map((it) => (settings.importByRef ? it : { ...it, ref: undefined }))
  const results: ImportResult[] = []

  importState.running = true
  importState.total = epubItems.length
  importState.done = 0
  importState.currentName = ''
  importState.results = []

  const skipped = items.length - epubItems.length
  if (skipped > 0) {
    results.push({
      name: `${skipped} 个非 EPUB 文件`,
      status: 'failed',
      reason: '格式不支持，已跳过',
    })
  }

  try {
    for (const item of epubItems) {
      const file = item.file
      importState.currentName = file.name
      try {
        // 1. 去重
        const fingerprint = await hashFile(file)
        const dup = await findByFingerprint(fingerprint)
        if (dup) {
          results.push({ name: file.name, status: 'duplicate', bookId: dup.id })
          continue
        }

        // 2. 配额预检（引用模式不占书库空间，不用检）
        if (!item.ref) {
          const info = await getStorageInfo()
          if (info.quota && info.quota - info.usage < file.size * 1.2) {
            results.push({
              name: file.name,
              status: 'failed',
              reason: '可用存储不足',
            })
            continue
          }
        }

        // 3. 解析（同时校验文件完整性）
        const parsed = await parseEpub(file)

        // 4. 落盘：复制入库；引用模式只登记出处
        const fileName = item.ref ? '' : newFileName()
        if (item.ref) {
          // 没有本地副本，防止用户清缓存丢书——这里如实提示
        } else {
          await putBookFile(fileName, file)
        }

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
          tags: parsed.tags.length ? parsed.tags : undefined,
          toc: parsed.toc,
          chapterCount: parsed.chapterCount,
          opfsPath: fileName,
          ...(item.ref
            ? { source: 'ref' as const, ...item.ref, refName: file.name }
            : {}),
          addedAt: Date.now(),
        }
        const bookId = await db.books.add(record)
        results.push({ name: file.name, status: 'added', bookId: bookId as number })
        // 后台排队去匹配评分站，不等它——导入不应该被网络拖慢
        enqueueAutoLink(bookId as number)
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

/**
 * 删除书籍。
 *
 * `keepFile`（默认 false）对应删除弹窗里的「同时删除本地文件」：
 * - 复制入库的书：keepFile=true 时把文件挪进回收站，而不是直接抹掉——
 *   否则下一次启动对账会把没人引用的文件当孤儿清理，「保留」等于没保留。
 * - 引用模式的书：本机书库里没有副本，原文件在用户自己的目录里，
 *   这里永远不动它（删用户原文件是不可逆操作，不该藏在删书按钮里）。
 */
export const removeBook = async (
  book: Book,
  opts: { keepFile?: boolean } = {},
): Promise<void> => {
  if (book.id == null) return
  if (book.source !== 'ref' && book.opfsPath) {
    if (opts.keepFile) await moveBookFileToTrash(book.opfsPath)
    else await deleteBookFile(book.opfsPath)
  }
  await db.transaction('rw', [db.books, db.progress, db.bookmarks], async () => {
    await db.books.delete(book.id!)
    await db.progress.where('bookId').equals(book.id!).delete()
    await db.bookmarks.where('bookId').equals(book.id!).delete()
  })
}
