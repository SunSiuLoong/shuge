import { registerPlugin } from '@capacitor/core'
import { db } from '../db'
import { getBookFile } from './opfs'
import type { Book } from '../types'
import { isNative } from '../native'

/**
 * 引用模式（不复制原文件）的文件解析。
 *
 * - 桌面 Chrome/Edge：File System Access API。导入时把 FileSystemFileHandle
 *   存进 IndexedDB（可持久），打开时 handle.getFile() 拿到的就是原文件的惰性引用。
 * - 安卓 App：SAF（ACTION_OPEN_DOCUMENT + takePersistableUriPermission），
 *   原生 ShugeLocalFile 插件按块读取拼成 File——不落盘，只在内存里走一遍。
 * - 其余环境（iOS、Safari、Firefox）：不支持，importer 会走复制入库。
 */

export const supportsFsAccess =
  typeof window !== 'undefined' && 'showOpenFilePicker' in window

/** File System Access API 的最小类型面（TS 的 DOM lib 没收录选择器入口） */
interface RefFileHandle {
  name: string
  getFile(): Promise<File>
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

type PickerOptions = {
  multiple: boolean
  types: { description: string; accept: Record<string, string[]> }[]
}

const pickerOf = (): ((o: PickerOptions) => Promise<RefFileHandle[]>) | null =>
  supportsFsAccess
    ? (window as unknown as { showOpenFilePicker: (o: PickerOptions) => Promise<RefFileHandle[]> })
        .showOpenFilePicker
    : null

export const supportsRefImport = isNative || supportsFsAccess

interface ShugeLocalFilePlugin {
  pick(): Promise<{ files: LocalRefFile[] }>
  readChunk(options: { uri: string; offset: number; length: number }): Promise<{
    base64: string
    eof: boolean
  }>
}

export interface LocalRefFile {
  /** content:// uri（安卓）或桌面临时标记 */
  uri: string
  name: string
  size: number
}

const plugin = isNative
  ? registerPlugin<ShugeLocalFilePlugin>('ShugeLocalFile')
  : null

/** 桌面：系统文件选择器（多选），返回「句柄 key → File」列表 */
export const pickRefFilesDesktop = async (): Promise<
  { key: string; file: File; name: string }[]
> => {
  const picker = pickerOf()
  if (!picker) throw new Error('当前浏览器不支持引用原文件')
  const handles = await picker({
    multiple: true,
    types: [
      {
        description: 'EPUB 电子书',
        accept: { 'application/epub+zip': ['.epub'] },
      },
    ],
  })
  const out: { key: string; file: File; name: string }[] = []
  for (const handle of handles) {
    const key = `fsh:${handle.name}:${Math.random().toString(36).slice(2, 10)}`
    out.push({ key, file: await handle.getFile(), name: handle.name })
    await db.handles.put({ id: key, handle })
  }
  return out
}

/** 安卓：SAF 选择器（多选），返回 content:// 引用；文件本体不动 */
export const pickRefFilesNative = async (): Promise<LocalRefFile[]> => {
  if (!plugin) throw new Error('原生插件不可用')
  const { files } = await plugin.pick()
  return files ?? []
}

/** 安卓：按块读 content:// 到内存并拼成 File（不落盘） */
export const readRefFileNative = async (uri: string, name: string): Promise<File> => {
  if (!plugin) throw new Error('原生插件不可用')
  const CHUNK = 2 * 1024 * 1024 // 2MB / 次，避开 bridge 单次传大字符串
  const parts: Uint8Array[] = []
  let offset = 0
  for (;;) {
    const { base64, eof } = await plugin.readChunk({ uri, offset, length: CHUNK })
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    parts.push(bytes)
    if (eof || bytes.length === 0) break
    offset += bytes.length
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const merged = new Uint8Array(total)
  let pos = 0
  for (const p of parts) {
    merged.set(p, pos)
    pos += p.length
  }
  return new File([merged], name || 'book.epub', { type: 'application/epub+zip' })
}

/** 桌面：确认句柄还有读权限（用户手势场景下 request 一次即可） */
const ensurePermission = async (handle: RefFileHandle): Promise<boolean> => {
  const q = handle.queryPermission
    ? await handle.queryPermission({ mode: 'read' })
    : 'granted'
  if (q === 'granted') return true
  const r = handle.requestPermission
    ? await handle.requestPermission({ mode: 'read' })
    : 'denied'
  return r === 'granted'
}

/**
 * 把书库记录解析成可读的 File。
 * - 复制入库：走 OPFS
 * - 引用模式：安卓按 uri 分块读；桌面按 handle 读（权限丢的时候在用户手势里补一次）
 * 失败时抛错，由调用方给出「转复制/重新导入」提示。
 */
export const resolveBookFile = async (book: Book): Promise<File> => {
  if (book.source !== 'ref') {
    const f = await getBookFile(book.opfsPath)
    if (!f) throw new Error('本地文件已丢失，请重新导入')
    return f
  }

  if (isNative && book.refUri) {
    return readRefFileNative(book.refUri, book.refName ?? 'book.epub')
  }

  if (book.refKey) {
    const rec = await db.handles.get(book.refKey)
    if (!rec?.handle) throw new Error('原文件引用已失效，请重新导入')
    const handle = rec.handle as RefFileHandle
    const ok = await ensurePermission(handle).catch(() => false)
    if (!ok) throw new Error('没有读取原文件的权限，请重新导入')
    return handle.getFile()
  }

  throw new Error('原文件引用已失效，请重新导入')
}

/** 删除引用模式的书时不该去删 OPFS（那里本来就没有文件） */
export const hasOpfsFile = (book: Book): boolean => book.source !== 'ref'
