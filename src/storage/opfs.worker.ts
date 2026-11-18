/// <reference lib="webworker" />

const BOOKS_DIR = 'books'
/**
 * 回收站目录。删书时选「不删除本地文件」就把文件挪到这里：
 * 书架上不再有记录，但文件还在，App 启动对账只扫 books/ 不会把它当孤儿删掉。
 */
const TRASH_DIR = 'trash'
const SAMPLE = 1 << 20 // 1MB

type Req =
  | { id: number; type: 'put'; name: string; file: File }
  | { id: number; type: 'hash'; file: File }
  | { id: number; type: 'delete'; name: string }
  | { id: number; type: 'trash'; name: string }
  | { id: number; type: 'listTrash' }
  | { id: number; type: 'clearTrash' }

const booksDir = async (create: boolean): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(BOOKS_DIR, { create })
}

const trashDir = async (create: boolean): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(TRASH_DIR, { create })
}

/**
 * 采样指纹：文件大小 + 头/中/尾各 1MB 的 SHA-256。
 * 对电子书这类文件碰撞概率可忽略，比整书哈希省几个数量级的内存与时间。
 */
const fingerprint = async (file: File): Promise<string> => {
  const head = new Uint8Array(await file.slice(0, SAMPLE).arrayBuffer())
  const midStart = Math.max(0, (file.size >> 1) - (SAMPLE >> 1))
  const mid = new Uint8Array(await file.slice(midStart, midStart + SAMPLE).arrayBuffer())
  const tail = new Uint8Array(
    await file.slice(Math.max(0, file.size - SAMPLE)).arrayBuffer(),
  )
  const buf = new Uint8Array(head.length + mid.length + tail.length)
  buf.set(head, 0)
  buf.set(mid, head.length)
  buf.set(tail, head.length + mid.length)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${file.size}-${hex.slice(0, 32)}`
}

const put = async (name: string, file: File): Promise<{ fingerprint: string }> => {
  const fp = await fingerprint(file)
  const dir = await booksDir(true)
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await file.stream().pipeTo(writable)
  } catch (e) {
    try {
      await writable.abort()
    } catch {
      /* ignore */
    }
    await dir.removeEntry(name).catch(() => {})
    throw e
  }
  return { fingerprint: fp }
}

const remove = async (name: string): Promise<void> => {
  try {
    const dir = await booksDir(false)
    await dir.removeEntry(name)
  } catch {
    /* 不存在即视为成功 */
  }
}

/** books/ → trash/：先写副本再删原件，中途失败不会把书弄丢 */
const moveToTrash = async (name: string): Promise<void> => {
  const src = await booksDir(false)
  const file = await (await src.getFileHandle(name)).getFile()
  const dst = await trashDir(true)
  const target = await dst.getFileHandle(name, { create: true })
  const writable = await target.createWritable()
  try {
    await file.stream().pipeTo(writable)
  } catch (e) {
    try {
      await writable.abort()
    } catch {
      /* ignore */
    }
    await dst.removeEntry(name).catch(() => {})
    throw e
  }
  await src.removeEntry(name).catch(() => {})
}

const listTrash = async (): Promise<{ name: string; size: number }[]> => {
  const out: { name: string; size: number }[] = []
  try {
    const dir = await trashDir(false)
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (!name.endsWith('.epub')) continue
      const size = (await (handle as FileSystemFileHandle).getFile()).size
      out.push({ name, size })
    }
  } catch {
    /* 目录不存在 = 空回收站 */
  }
  return out
}

const clearTrash = async (): Promise<number> => {
  let n = 0
  try {
    const dir = await trashDir(false)
    for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      await dir.removeEntry(name).catch(() => {})
      n++
    }
  } catch {
    /* 目录不存在 = 已清空 */
  }
  return n
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data
  try {
    if (req.type === 'put') {
      const res = await put(req.name, req.file)
      self.postMessage({ id: req.id, ok: true, result: res })
    } else if (req.type === 'hash') {
      const fp = await fingerprint(req.file)
      self.postMessage({ id: req.id, ok: true, result: fp })
    } else if (req.type === 'delete') {
      await remove(req.name)
      self.postMessage({ id: req.id, ok: true })
    } else if (req.type === 'trash') {
      await moveToTrash(req.name)
      self.postMessage({ id: req.id, ok: true })
    } else if (req.type === 'listTrash') {
      self.postMessage({ id: req.id, ok: true, result: await listTrash() })
    } else if (req.type === 'clearTrash') {
      self.postMessage({ id: req.id, ok: true, result: await clearTrash() })
    }
  } catch (err) {
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
