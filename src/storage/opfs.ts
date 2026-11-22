const BOOKS_DIR = 'books'

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()

const getWorker = (): Worker => {
  if (worker) return worker
  worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (
    e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>,
  ) => {
    const { id, ok, result, error } = e.data
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (ok) p.resolve(result)
    else p.reject(new Error(error ?? 'OPFS 操作失败'))
  }
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(e.message || 'OPFS worker 异常'))
    pending.clear()
  }
  return worker
}

const rpc = <T>(payload: Record<string, unknown>): Promise<T> => {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ id, ...payload })
  })
}

const booksDir = async (create: boolean): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(BOOKS_DIR, { create })
}

/** 采样指纹（主线程版，仅用于未走 worker 的场景） */
export const hashFile = (file: File): Promise<string> =>
  rpc<string>({ type: 'hash', file })

/** 写入书籍文件，返回采样指纹 */
export const putBookFile = async (fileName: string, file: File): Promise<string> => {
  const { fingerprint } = await rpc<{ fingerprint: string }>({
    type: 'put',
    name: fileName,
    file,
  })
  return fingerprint
}

export const deleteBookFile = (fileName: string): Promise<void> =>
  rpc<void>({ type: 'delete', name: fileName })

/** 删书时保留本地文件：把书文件挪进回收站，启动对账不会再把它当孤儿删掉 */
export const moveBookFileToTrash = (fileName: string): Promise<void> =>
  rpc<void>({ type: 'trash', name: fileName })

export const listTrashFiles = (): Promise<{ name: string; size: number }[]> =>
  rpc<{ name: string; size: number }[]>({ type: 'listTrash' })

export const clearTrash = (): Promise<number> => rpc<number>({ type: 'clearTrash' })

export const getBookFile = async (fileName: string): Promise<File | null> => {
  try {
    // 不走 booksDir()：直接从根句柄三级定位，少一层 rpc 包装
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(BOOKS_DIR, { create: false })
    const handle = await dir.getFileHandle(fileName, { create: false })
    return await handle.getFile()
  } catch {
    return null
  }
}

/** 列出 OPFS 中已有的书名文件，用于启动对账清理孤儿文件 */
export const listBookFiles = async (): Promise<string[]> => {
  const names: string[] = []
  try {
    const dir = await booksDir(false)
    for await (const [name] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (name.endsWith('.epub')) names.push(name)
    }
  } catch {
    /* 目录不存在 */
  }
  return names
}

export interface StorageInfo {
  supported: boolean
  persisted: boolean
  usage: number
  quota: number
}

export const getStorageInfo = async (): Promise<StorageInfo> => {
  const supported = typeof navigator !== 'undefined' && !!navigator.storage?.estimate
  const persisted = navigator.storage?.persisted
    ? await navigator.storage.persisted()
    : false
  let usage = 0
  let quota = 0
  if (supported) {
    const est = await navigator.storage.estimate()
    usage = est.usage ?? 0
    quota = est.quota ?? 0
  }
  return { supported, persisted, usage, quota }
}

/** 请求持久化存储；返回是否授予 */
export const requestPersist = async (): Promise<boolean> => {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export const formatBytes = (n: number): string => {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / Math.pow(1024, i)
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
