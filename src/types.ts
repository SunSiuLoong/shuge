/** 目录条目：扁平存储，depth 表示层级（0 起），避免递归类型带来的工具链问题 */
export interface TocItem {
  label: string
  href: string
  depth: number
}

export type SourceSite = 'qidian' | 'fanqie' | 'yousuu' | 'lkong' | 'other'

/** 预留：网文站关联引用 */
export interface SourceRef {
  site: SourceSite
  bookId?: string
  url?: string
  fetched?: {
    rating?: number
    tags?: string[]
    commentCount?: number
    fetchedAt?: number
  }
}

export interface Book {
  id?: number
  title: string
  author: string
  publisher?: string
  language?: string
  description?: string
  fileSize: number
  /** 采样指纹，用于导入去重 */
  fingerprint: string
  cover?: Blob
  toc?: TocItem[]
  chapterCount: number
  opfsPath: string
  addedAt: number
  lastOpenedAt?: number
  /** 文件丢失标记（启动对账时置位） */
  missing?: boolean
  // ---- 预留，首版不参与逻辑 ----
  tags?: string[]
  rating?: number
  sourceRefs?: SourceRef[]
  groups?: number[]
}

export interface Progress {
  id?: number
  bookId: number
  cfi?: string
  fraction: number
  chapterIndex: number
  percent: number
  chapterLabel?: string
  updatedAt: number
}

export interface Bookmark {
  id?: number
  bookId: number
  cfi: string
  excerpt: string
  chapterIndex: number
  percent: number
  note?: string
  createdAt: number
}

export interface Group {
  id?: number
  name: string
  color?: string
  order: number
}
