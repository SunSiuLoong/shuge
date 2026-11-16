import { computed, ref } from 'vue'
import { liveQuery } from 'dexie'
import { db } from '../db'
import type { Book, Progress } from '../types'

export type SortKey = 'recent' | 'added' | 'title' | 'author'

export const SORT_LABELS: Record<SortKey, string> = {
  recent: '最近阅读',
  added: '最近导入',
  title: '书名',
  author: '作者',
}

export const books = ref<Book[]>([])
export const progressMap = ref<Record<number, Progress>>({})
export const loading = ref(true)
export const sortKey = ref<SortKey>(
  (localStorage.getItem('shuge.sort') as SortKey) || 'recent',
)

export const setSort = (key: SortKey): void => {
  sortKey.value = key
  localStorage.setItem('shuge.sort', key)
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
    default:
      return list.sort(
        (a, b) =>
          (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) ||
          b.addedAt - a.addedAt,
      )
  }
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
