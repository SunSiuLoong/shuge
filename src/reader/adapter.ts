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
      // [shuge] 章节异常（空节/单页节）可能让 foliate 算出 NaN/Infinity，
      // 退化为按章节序号估算；再 clamp 到 0-1，保证书架进度有值
      const sec = (d.section ?? {}) as { current?: number; total?: number }
      const cur = typeof sec.current === 'number' ? sec.current : 0
      const total = typeof sec.total === 'number' && sec.total > 0 ? sec.total : 1
      let fraction = typeof d.fraction === 'number' && Number.isFinite(d.fraction) ? d.fraction : 0
      if (fraction <= 0 && cur > 0) {
        fraction = cur / Math.max(1, total - 1)
      }
      fraction = Math.min(1, Math.max(0, fraction))
      this.onRelocate?.({
        fraction,
        chapterIndex: cur,
        chapterLabel: d.tocItem?.label ?? '',
        cfi: d.cfi ?? '',
        sectionTotal: total,
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

  /**
   * 打开书籍、建好渲染器，但**不渲染正文**。
   * 与 init 拆开是为了让调用方能在两步之间注入排版/配色样式：
   * 若首章渲染时 foliate 里还没有样式（#styles 为空），iframe 会按 EPUB
   * 默认白底画出第一帧，暗色模式下就是一次白闪。
   */
  async openBook(file: Blob): Promise<void> {
    await this.el.open(file)
    this.book = this.el.book as FoliateBook
  }

  /** 渲染首章（跳到上次进度或正文开头）；在此之前应已 setStyles */
  async init(lastLocation?: unknown): Promise<void> {
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
    try {
      await this.el.next()
    } catch (e) {
      // [shuge] 章节加载失败等异常不应静默扩散，也不应吞掉翻页锁
      console.warn('[shuge] foliate next failed', e)
    }
  }

  async prev(): Promise<void> {
    try {
      await this.el.prev()
    } catch (e) {
      console.warn('[shuge] foliate prev failed', e)
    }
  }

  /** 跳到上一章/下一章（滚动模式下点按不翻页，菜单需要显式跳章入口） */
  async prevChapter(): Promise<void> {
    try {
      await this.el.renderer?.prevSection?.()
    } catch (e) {
      console.warn('[shuge] foliate prevSection failed', e)
    }
  }

  async nextChapter(): Promise<void> {
    try {
      await this.el.renderer?.nextSection?.()
    } catch (e) {
      console.warn('[shuge] foliate nextSection failed', e)
    }
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

  /** 目录树：保留层级，卷下面挂着章，抽屉里才能展开/收起 */
  getToc(): TocItem[] {
    const walk = (items: any[] | undefined, depth: number): TocItem[] => {
      if (!items) return []
      const out: TocItem[] = []
      for (const item of items) {
        const label = String(item?.label ?? '').trim()
        const href = item?.href ?? ''
        const children = walk(item?.subitems, depth + 1)
        if (!label && !href && !children.length) continue
        out.push({
          label,
          href,
          depth,
          ...(children.length ? { children } : {}),
        })
      }
      return out
    }
    return walk(this.book?.toc as any[], 0)
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
