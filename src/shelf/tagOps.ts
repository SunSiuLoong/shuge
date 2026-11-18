import { patchBook } from '../db'
import type { Book } from '../types'
import { books, setShelfTab, shelfTab } from './store'

/** 与 BookMetaSheet 保持一致：一本最多 6 个标签 */
export const MAX_TAGS = 6

const clean = (raw: string): string => raw.trim().replace(/^#/, '').slice(0, 12)

/** 写回标签数组；空数组要写 undefined（Dexie 存 null），否则会留下 [] 这种半空状态 */
const writeTags = async (book: Book, tags: string[]): Promise<void> => {
  if (book.id == null) return
  await patchBook(book.id, { tags: tags.length ? tags : undefined })
}

const unique = (list: string[]): string[] => [...new Set(list)]

/**
 * 给一批书加同一个标签。已经有该标签的跳过，满 6 个的也跳过。
 * 返回实际改动的本数与被上限挡掉的本数。
 */
export const addTagTo = async (
  list: Book[],
  raw: string,
): Promise<{ changed: number; skipped: number }> => {
  const tag = clean(raw)
  if (!tag) return { changed: 0, skipped: 0 }
  let changed = 0
  let skipped = 0
  for (const book of list) {
    const tags = book.tags ?? []
    if (tags.includes(tag)) continue
    if (tags.length >= MAX_TAGS) {
      skipped++
      continue
    }
    await writeTags(book, [...tags, tag])
    changed++
  }
  return { changed, skipped }
}

/** 从一批书里移除某个标签 */
export const removeTagFrom = async (list: Book[], tag: string): Promise<number> => {
  let changed = 0
  for (const book of list) {
    const tags = book.tags ?? []
    if (!tags.includes(tag)) continue
    await writeTags(book, tags.filter((t) => t !== tag))
    changed++
  }
  return changed
}

/**
 * 改名：把 from 换成 to，范围限定在传入的书里。
 * 目标名已存在时只做去重合并，不会出现同一本书两个同名标签。
 */
export const renameTagIn = async (
  list: Book[],
  from: string,
  rawTo: string,
): Promise<{ changed: number; conflict: number }> => {
  const to = clean(rawTo)
  if (!to || to === from) return { changed: 0, conflict: 0 }
  let changed = 0
  let conflict = 0
  for (const book of list) {
    const tags = book.tags ?? []
    if (!tags.includes(from)) continue
    if (tags.includes(to)) conflict++
    const next = unique(tags.map((t) => (t === from ? to : t)))
    await writeTags(book, next)
    changed++
  }
  return { changed, conflict }
}

/** 全库改名：书架标签页长按用的就是这个（标签代表全库，不分当前筛选） */
export const renameTagEverywhere = async (
  from: string,
  rawTo: string,
): Promise<{ changed: number; conflict: number }> => {
  const res = await renameTagIn(books.value, from, rawTo)
  // 当前停在这个标签页上就跟着跳过去，别让用户按完发现回到了「全部」
  if (res.changed && shelfTab.value === from) setShelfTab(clean(rawTo))
  return res
}

/** 这批书里出现过的标签，按出现本数从多到少 */
export const tagsOf = (list: Book[]): { name: string; count: number }[] => {
  const counter = new Map<string, number>()
  for (const b of list) {
    for (const t of b.tags ?? []) counter.set(t, (counter.get(t) ?? 0) + 1)
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}
