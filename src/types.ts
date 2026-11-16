/** 目录条目：扁平存储，depth 表示层级（0 起），避免递归类型带来的工具链问题 */
export interface TocItem {
  label: string
  href: string
  depth: number
}

/** 能给出评分的站点。加新源时这里的联合类型与 meta/sources.ts 的注册表要一起改 */
export type LinkSite = 'douban' | 'weread'

/**
 * 关联到某个评分站上的那条书目记录。
 *
 * 存整条而不是只存站名，因为用户重新关联时选的是「哪一条」——
 * 同一本书在豆瓣可能是分卷（《剑来1》7.0），在微信读书是全集（《剑来》8.6），
 * 界面要把当时选中的书名、作者、封面、类型、评分原样展示出来。
 */
export interface BookLink {
  site: LinkSite
  siteName: string
  bookId?: string
  title: string
  author: string
  coverUrl?: string
  /** 站点的类型/分类。豆瓣与微信读书都不提供，留空时界面回退到本地标签 */
  categories?: string[]
  rating: number
  ratingCount?: number
  url?: string
  linkedAt: number
  /** true = 导入时自动挑的「评分人数最多」那条，false = 用户自己选的 */
  auto?: boolean
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
  /** 题材标签：导入时从文件名/EPUB 元数据生成，可手动增删 */
  tags?: string[]
  /** 评分，0–10（与豆瓣同口径）；手动打星写入 2/4/6/8/10 */
  rating?: number
  /** 豆瓣评价人数，只用于展示「8.6 · 1.2万人评」 */
  ratingCount?: number
  /** 评分来源，用来区分抓的和自己打的 */
  metaSource?: LinkSite | 'manual' | 'epub' | 'filename'
  /** 关联的评分站书目；有它时评分/人数/来源都以它为准 */
  link?: BookLink
  /** 元数据最近补全时间 */
  metaUpdatedAt?: number
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
