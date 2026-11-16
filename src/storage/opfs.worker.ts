/// <reference lib="webworker" />

const BOOKS_DIR = 'books'
const SAMPLE = 1 << 20 // 1MB

type Req =
  | { id: number; type: 'put'; name: string; file: File }
  | { id: number; type: 'hash'; file: File }
  | { id: number; type: 'delete'; name: string }

const booksDir = async (create: boolean): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(BOOKS_DIR, { create })
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
    }
  } catch (err) {
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
