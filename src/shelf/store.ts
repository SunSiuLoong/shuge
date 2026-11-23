import { computed, ref, watch } from 'vue'
import { liveQuery } from 'dexie'
import { db } from '../db'
import type { Book, Progress } from '../types'
import { logError, logEvent } from '../log'
import { normalizeOrder, sortByTagOrder } from './tagOrder'

export type SortKey = 'recent' | 'added' | 'title' | 'author' | 'rating'
/** 书架顶部的标签页：__all__ = 全部，__untagged__ = 未分类，其余是题材名 */
export type ShelfTabKey = string

export const SORT_LABELS: Record<SortKey, string> = {
  recent: '最近阅读',
  added: '最近导入',
  title: '书名',
  author: '作者',
  rating: '评分高到低',
}

export const books = ref<Book[]>([])
export const progressMap = ref<Record<number, Progress>>({})
export const loading = ref(true)
export const sortKey = ref<SortKey>(
  (localStorage.getItem('shuge.sort') as SortKey) || 'recent',
)
/** 书架顶部的标签页选中项。'__all__' 表示不筛 */
export const shelfTab = ref<ShelfTabKey>(localStorage.getItem('shuge.tab') || '__all__')
/** 旧版的「按标签筛选」，标签页接管后只保留导出，避免别处引用编译不过 */
export const tagFilter = ref<string | null>(null)

export const setSort = (key: SortKey): void => {
  sortKey.value = key
  localStorage.setItem('shuge.sort', key)
}

export const setShelfTab = (key: ShelfTabKey): void => {
  shelfTab.value = key
  localStorage.setItem('shuge.tab', key)
}

export const setTagFilter = (tag: string | null): void => {
  tagFilter.value = tag
  if (tag) setShelfTab(tag)
}

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true })

export const sortedBooks = computed<Book[]>(() => {
  const list = [...books.value]
  switch (sortKey.value) {
    case 'added':
      return list.sort((a, b) => b.addedAt - a.addedAt)
    case 'title':
      return list.sort((a, b) => collator.compare(a.title, b.title))
    case 'author':
      return list.sort(
        (a, b) => collator.compare(a.author, b.author) || collator.compare(a.title, b.title),
      )
    case 'rating':
      // 没评分的垫底，不和 0 分混在一起
      return list.sort(
        (a, b) =>
          (b.rating ?? -1) - (a.rating ?? -1) || collator.compare(a.title, b.title),
      )
    default:
      return list.sort(
        (a, b) =>
          (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) ||
          b.addedAt - a.addedAt,
      )
  }
})

export interface TagStat {
  name: string
  count: number
}

/** 全部标签按书目数量降序，用于筛选条与分组顺序 */
export const allTags = computed<TagStat[]>(() => {
  const counter = new Map<string, number>()
  for (const b of books.value) {
    for (const t of b.tags ?? []) {
      const k = t.trim()
      if (k) counter.set(k, (counter.get(k) ?? 0) + 1)
    }
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))
})

export const untaggedCount = computed(
  () => books.value.filter((b) => !b.tags?.length).length,
)

/** 标签被删掉后筛选条件要失效，否则书架会空成一片而看不出原因 */
watch(allTags, (list) => {
  if (tagFilter.value && !list.some((t) => t.name === tagFilter.value)) {
    tagFilter.value = null
  }
})

export interface ShelfTab {
  key: ShelfTabKey
  label: string
  count: number
}

/**
 * 标签页自定义顺序（拖拽排序的结果），只存标签名数组。
 * 没排序过的标签按「本数降序」排在已排序的后面——新加标签不需要用户手动挪。
 */
const TAG_ORDER_KEY = 'shuge.tagOrder.v1'

const readTagOrder = (): string[] => {
  try {
    return normalizeOrder(JSON.parse(localStorage.getItem(TAG_ORDER_KEY) ?? '[]'))
  } catch {
    return []
  }
}

export const tagOrder = ref<string[]>(readTagOrder())

/** 保存顺序。传进来的名单以当前真实存在为准，删掉的标签不再占位 */
export const setTagOrder = (names: string[]): void => {
  const exist = new Set(allTags.value.map((t) => t.name))
  const next = names.filter((n) => exist.has(n))
  tagOrder.value = next
  try {
    localStorage.setItem(TAG_ORDER_KEY, JSON.stringify(next))
  } catch {
    /* 存不下就只在本次会话生效 */
  }
}

/**
 * 标签页列表：全部 → 未分类（有才算）→ 各题材（按自定义顺序，未排序的按书目数降序）。
 * 顺序刻意让「全部」永远在第一格，切回来不用找。
 */
export const shelfTabs = computed<ShelfTab[]>(() => {
  const out: ShelfTab[] = [{ key: '__all__', label: '全部', count: books.value.length }]
  const untagged = untaggedCount.value
  if (untagged > 0) out.push({ key: '__untagged__', label: '未分类', count: untagged })
  // 自定义顺序优先；没排过的按本数降序接在后面，新标签不用手动挪
  for (const t of sortByTagOrder(allTags.value, tagOrder.value)) {
    out.push({ key: t.name, label: t.name, count: t.count })
  }
  return out
})

/** 当前标签页里的书；排序仍走全局排序设置 */
export const tabBooks = computed<Book[]>(() => {
  const key = shelfTab.value
  if (key === '__all__') return sortedBooks.value
  if (key === '__untagged__') return sortedBooks.value.filter((b) => !b.tags?.length)
  return sortedBooks.value.filter((b) => (b.tags ?? []).includes(key))
})

/** 标签被删掉后当前页要失效，否则书架会空成一片而看不出原因 */
watch(shelfTabs, (list) => {
  if (!list.some((t) => t.key === shelfTab.value)) setShelfTab('__all__')
})

/** 选中页里一本书都没有时（比如刚清空标签），也要退回全部 */
watch(tabBooks, (list) => {
  if (!list.length && shelfTab.value !== '__all__' && books.value.length) setShelfTab('__all__')
})

/** [shuge] 统一归一化 percent/fraction 口径：历史或同步链路可能混入 0-100
 *  百分数，>1 一律除回去；非有限数（Infinity/NaN）归 0，clamp 到 0-1 */
const normalizeFraction = (raw: unknown): number => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  const v = raw > 1 ? raw / 100 : raw
  return Math.min(1, Math.max(0, v))
}

export const percentOf = (bookId?: number): number => {
  if (bookId == null) return 0
  return normalizeFraction(progressMap.value[bookId]?.percent)
}

let started = false

export const startShelf = (): void => {
  if (started) return
  started = true
  let firstLoad = true
  liveQuery(async () => {
    const [all, ps] = await Promise.all([db.books.toArray(), db.progress.toArray()])
    return { all, ps }
  }).subscribe({
    next: ({ all, ps }) => {
      books.value = all
      const map: Record<number, Progress> = {}
      for (const p of ps) map[p.bookId] = p
      progressMap.value = map
      loading.value = false
      // 首帧落一条基线：以后闪退，能看出当时书库多大规模
      if (firstLoad) {
        firstLoad = false
        const tagCount = new Set(all.flatMap((b) => b.tags ?? [])).size
        logEvent('shelf', `书架载入 ${all.length} 本 · ${tagCount} 个标签`)
      }
    },
    error: (e) => {
      logError('shelf', `书架载入失败：${e instanceof Error ? e.message : String(e)}`)
      console.error(e)
      loading.value = false
    },
  })
}
