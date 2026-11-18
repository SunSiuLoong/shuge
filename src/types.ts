/**
 * 目录条目。
 * depth 是层级（0 起）；children 是下级的卷/章（有下级时目录可以展开收起）。
 * 书库里存的 toc 是扁平版（只看 depth），阅读页用 adapter.getToc() 的树版。
 */
export interface TocItem {
  label: string
  href: string
  depth: number
  children?: TocItem[]
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
  /** 书文件来源：'opfs' = 复制入库（默认），'ref' = 引用原文件（不复制，静读天下式） */
  source?: 'opfs' | 'ref'
  /**
   * 引用模式的寻址方式：
   * - 桌面（File System Access API）：refKey 是 IndexedDB handles 表的主键，值是 FileSystemFileHandle
   * - 安卓（SAF）：refKey 为空，refUri 是拿过持久授权的 content:// uri
   */
  refKey?: string
  refUri?: string
  /** 引用模式下的原文件名（删除/失效提示与同步显示用） */
  refName?: string
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
  /**
   * 仅本书生效的字体（值同 settings.FontKey，如 'serif' / 'custom:xxx'）。
   * 空 = 跟随全局设置。参考 Readest 的「Global Settings 关掉后只存到当前书」，
   * 以及 KOReader 把字体默认为 per-book 作用域的做法。
   */
  readerFont?: string
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

/** 用户导入的阅读字体。二进制直接进 IndexedDB，不联网、不上传 */
export interface StoredFont {
  id: string
  /** 界面显示名（默认取文件名去扩展名） */
  name: string
  /** @font-face 用的家族名，全局唯一 */
  family: string
  /** 字节数，用于列表展示 */
  size: number
  addedAt: number
  data: ArrayBuffer
}
