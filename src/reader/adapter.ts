import '../vendor/foliate-js/view.js'
import type { TocItem } from '../types'
import type { FoliateBook } from './book'

export interface RelocateInfo {
  fraction: number
  chapterIndex: number
  chapterLabel: string
  cfi: string
  sectionTotal: number
  pageCurrent?: number
  pageTotal?: number
}

export interface SearchHit {
  cfi: string
  label: string
  pre: string
  match: string
  post: string
}

/** foliate 的 excerpt 是 { pre, match, post } 结构，统一拆开好渲染高亮 */
const splitExcerpt = (ex: unknown): { pre: string; match: string; post: string } => {
  if (typeof ex === 'string') return { pre: '', match: '', post: ex }
  const obj = (ex ?? {}) as Record<string, unknown>
  return {
    pre: String(obj.pre ?? ''),
    match: String(obj.match ?? ''),
    post: String(obj.post ?? ''),
  }
}

export interface SearchProgress {
  processed: number
  total: number
}

type FoliateView = HTMLElement & Record<string, any>

/**
 * foliate-view 的一层薄封装。
 * 引擎相关的调用全部收敛在这里，将来换引擎只动本文件。
 */
export class FoliateAdapter {
  readonly el: FoliateView
  book: FoliateBook | null = null

  private disposed = false
  private linkFired = false
  private searchCancel = false

  onRelocate: ((info: RelocateInfo) => void) | null = null
  onContentLoad: ((doc: Document, index: number) => void) | null = null
  onLink: ((href: string) => void) | null = null
  onExternalLink: ((href: string) => void) | null = null

  constructor(host: HTMLElement) {
    this.el = document.createElement('foliate-view') as FoliateView
    this.el.style.cssText = 'display:block;width:100%;height:100%'
    host.append(this.el)

    this.el.addEventListener('relocate', (ev: Event) => {
      if (this.disposed) return
      const d = (ev as CustomEvent).detail ?? {}
      this.onRelocate?.({
        fraction: typeof d.fraction === 'number' ? d.fraction : 0,
        chapterIndex: d.section?.current ?? 0,
        chapterLabel: d.tocItem?.label ?? '',
        cfi: d.cfi ?? '',
        sectionTotal: d.section?.total ?? 1,
        pageCurrent: d.pageItem?.id,
        pageTotal: undefined,
      })
    })

    this.el.addEventListener('link', (ev: Event) => {
      // foliate 内部已 preventDefault 并自行跳转，这里只负责通知外部不要翻页
      this.linkFired = true
      setTimeout(() => (this.linkFired = false), 0)
      this.onLink?.((ev as CustomEvent).detail?.href ?? '')
    })

    this.el.addEventListener('load', (ev: Event) => {
      if (this.disposed) return
      const d = (ev as CustomEvent).detail ?? {}
      if (d.doc) this.onContentLoad?.(d.doc as Document, d.index ?? 0)
    })

    this.el.addEventListener('external-link', () => {
      this.linkFired = true
      setTimeout(() => (this.linkFired = false), 0)
    })
  }

  /** 刚刚是否因点击链接而触发了跳转（用于吞掉翻页手势） */
  get linkJustClicked(): boolean {
    return this.linkFired
  }

  async open(file: Blob, lastLocation?: unknown): Promise<void> {
    await this.el.open(file)
    this.book = this.el.book as FoliateBook
    if (lastLocation) await this.el.init({ lastLocation })
    else await this.el.init({ showTextStart: true })
  }

  async goTo(target: unknown): Promise<void> {
    await this.el.goTo(target)
  }

  async goToFraction(fraction: number): Promise<void> {
    await this.el.goToFraction(fraction)
  }

  async next(): Promise<void> {
    await this.el.next()
  }

  async prev(): Promise<void> {
    await this.el.prev()
  }

  setFlow(flow: 'paginated' | 'scrolled'): void {
    this.el.renderer?.setAttribute('flow', flow)
  }

  /** 让分页宽度贴合容器，否则默认 720px 上限会在手机上撑出两栏 */
  setViewport(width: number, height: number): void {
    const r = this.el.renderer
    if (!r) return
    r.setAttribute('max-inline-size', `${Math.round(width)}px`)
    r.setAttribute('max-block-size', `${Math.round(height)}px`)
    r.setAttribute('max-column-count', width > height ? '2' : '1')
  }

  setMargin(px: number): void {
    this.el.renderer?.setAttribute('margin', `${px}px`)
  }

  setGap(percent: number): void {
    this.el.renderer?.setAttribute('gap', `${percent}%`)
  }

  setStyles(css: string): void {
    this.el.renderer?.setStyles?.(css)
  }

  getToc(): TocItem[] {
    const out: TocItem[] = []
    const walk = (items: any[] | undefined, depth: number): void => {
      if (!items) return
      for (const item of items) {
        const label = String(item?.label ?? '').trim()
        if (label || item?.href) out.push({ label, href: item?.href ?? '', depth })
        if (item?.subitems?.length) walk(item.subitems, depth + 1)
      }
    }
    walk(this.book?.toc as any[], 0)
    return out
  }

  get chapterCount(): number {
    return this.book?.sections?.length ?? 0
  }

  /** 当前页附近的文本，用于书签摘录 */
  excerptAround(): string {
    try {
      const contents = this.el.renderer?.getContents?.() ?? []
      const cur = contents[0]
      if (!cur?.doc) return ''
      const sel = cur.doc.getSelection?.()
      const text = (sel?.toString() || cur.doc.body?.innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
      return text.slice(0, 48)
    } catch {
      return ''
    }
  }

  cancelSearch(): void {
    this.searchCancel = true
  }

  async search(
    query: string,
    onHit: (hit: SearchHit) => void,
    onProgress?: (p: SearchProgress) => void,
  ): Promise<void> {
    this.searchCancel = false
    let total = 0
    const iter = this.el.search({ query })
    for await (const result of iter) {
      if (this.searchCancel) break
      if (result === 'done') break
      if (typeof result?.progress === 'number') {
        total = Math.max(total, Math.round(1 / Math.max(result.progress, 0.0001)))
        onProgress?.({ processed: Math.round(result.progress * 100), total: 100 })
      }
      if (result?.subitems) {
        for (const item of result.subitems) {
          onHit({ cfi: item.cfi, ...splitExcerpt(item.excerpt), label: result.label ?? '' })
        }
      } else if (result?.cfi) {
        onHit({ cfi: result.cfi, ...splitExcerpt(result.excerpt), label: '' })
      }
    }
  }

  destroy(): void {
    this.disposed = true
    try {
      this.el.close?.()
    } catch {
      /* ignore */
    }
    this.el.remove()
    this.book = null
  }
}
