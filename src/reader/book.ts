import { EPUB } from '../vendor/foliate-js/epub.js'

export interface FoliateBook {
  metadata: Record<string, any>
  sections: Array<{ id: string; cfi?: string; linear?: string; size: number }>
  toc?: Array<{ label: string; href: string; subitems?: any[] }>
  landmarks?: Array<{ href: string; type?: string[] }>
  dir?: string
  rendition?: { layout?: string }
  getCover?: () => Promise<Blob | null>
  resolveCFI?: (cfi: string) => any
  resolveHref?: (href: string) => any
  splitTOCHref?: (href: string) => string[]
  getTOCFragment?: (doc: Document, id: string) => Node
}

/**
 * 用 foliate 的 zip 加载器打开 EPUB。
 * 与 vendor/view.js 内部逻辑一致，抽出来是为了导入阶段不必加载渲染器。
 */
export const openBook = async (file: Blob): Promise<FoliateBook> => {
  const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } = await import(
    '../vendor/foliate-js/vendor/zip.js'
  )
  configure({ useWebWorkers: false })
  const reader = new ZipReader(new BlobReader(file))
  const entries = await reader.getEntries()
  const map = new Map<string, any>(entries.map((e: any) => [e.filename, e]))
  const load =
    (f: (entry: any, ...args: any[]) => any) =>
    (name: string, ...args: any[]) =>
      map.has(name) ? f(map.get(name), ...args) : null
  const loadText = load((entry) => entry.getData(new TextWriter()))
  const loadBlob = load((entry, type: string) => entry.getData(new BlobWriter(type)))
  const getSize = (name: string) => map.get(name)?.uncompressedSize ?? 0
  // entries 传给 EPUB：OPF 丢失时靠它合成 package（见 epub.js #synthesizePackage）
  return (await new EPUB({ loadText, loadBlob, getSize, entries } as never).init()) as FoliateBook
}

/** metadata 字段可能是字符串或语言映射对象，统一取第一个值 */
export const langText = (x: unknown): string => {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (Array.isArray(x)) return x.map(langText).filter(Boolean).join('、')
  if (typeof x === 'object') {
    const obj = x as Record<string, unknown>
    if ('name' in obj) return langText(obj.name)
    const first = Object.values(obj)[0]
    return typeof first === 'string' ? first : ''
  }
  return ''
}
