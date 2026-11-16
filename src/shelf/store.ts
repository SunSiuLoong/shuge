import { computed, ref, watch } from 'vue'
import { liveQuery } from 'dexie'
import { db } from '../db'
import type { Book, Progress } from '../types'

export type SortKey = 'recent' | 'added' | 'title' | 'author' | 'rating'
export type GroupMode = 'none' | 'tag'

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
/** 书架是否按标签分组浏览 */
export const groupMode = ref<GroupMode>(
  (localStorage.getItem('shuge.group') as GroupMode) || 'none',
)
/** 当前选中的标签筛选，null 表示全部 */
export const tagFilter = ref<string | null>(null)

export const setSort = (key: SortKey): void => {
  sortKey.value = key
  localStorage.setItem('shuge.sort', key)
}

export const setGroupMode = (mode: GroupMode): void => {
  groupMode.value = mode
  localStorage.setItem('shuge.group', mode)
}

export const setTagFilter = (tag: string | null): void => {
  tagFilter.value = tag
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

export const visibleBooks = computed<Book[]>(() => {
  const key = tagFilter.value
  if (!key) return sortedBooks.value
  return sortedBooks.value.filter((b) => (b.tags ?? []).includes(key))
})

export interface BookGroup {
  key: string
  label: string
  count: number
  books: Book[]
}

/** 按主标签（tags[0]）分组；组顺序沿用标签热度，未分类排最后 */
export const groupedBooks = computed<BookGroup[]>(() => {
  const list = visibleBooks.value
  if (groupMode.value === 'none') {
    return [{ key: '__all__', label: '', count: list.length, books: list }]
  }
  const map = new Map<string, Book[]>()
  for (const b of list) {
    const key = b.tags?.[0]?.trim() || ''
    const arr = map.get(key)
    if (arr) arr.push(b)
    else map.set(key, [b])
  }
  const hot = new Map(allTags.value.map((t, i) => [t.name, i]))
  const groups: BookGroup[] = [...map.entries()].map(([key, arr]) => ({
    key: key || '__untagged__',
    label: key || '未分类',
    count: arr.length,
    books: arr,
  }))
  return groups.sort((a, b) => {
    if (a.key === '__untagged__') return 1
    if (b.key === '__untagged__') return -1
    return (hot.get(a.label) ?? 999) - (hot.get(b.label) ?? 999)
  })
})

export const percentOf = (bookId?: number): number => {
  if (bookId == null) return 0
  return progressMap.value[bookId]?.percent ?? 0
}

let started = false

export const startShelf = (): void => {
  if (started) return
  started = true
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
    },
    error: (e) => {
      console.error(e)
      loading.value = false
    },
  })
}
