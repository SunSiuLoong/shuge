import { patchTagsBulk } from '../db'
import type { Book } from '../types'
import { books, setShelfTab, shelfTab } from './store'
import { logError, logEvent, logWarn } from '../log'

/** 与 BookMetaSheet 保持一致：一本最多 6 个标签 */
export const MAX_TAGS = 6

const clean = (raw: string): string => raw.trim().replace(/^#/, '').slice(0, 12)

const unique = (list: string[]): string[] => [...new Set(list)]

/** 统一出口：一次事务写完，出错记日志（不要静默吞掉，删标签闪退就是查不到这层错误） */
const commit = async (
  rows: Array<{ id: number; tags: string[] }>,
  action: string,
): Promise<number> => {
  if (!rows.length) return 0
  try {
    const n = await patchTagsBulk(rows.map((r) => ({ id: r.id, tags: r.tags })))
    logEvent('tag', `${action}：${n} 本`)
    return n
  } catch (e) {
    logError('tag', `${action}失败：${e instanceof Error ? e.message : String(e)}`)
    throw e
  }
}

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
  const rows: Array<{ id: number; tags: string[] }> = []
  let skipped = 0
  for (const book of list) {
    if (book.id == null) continue
    const tags = book.tags ?? []
    if (tags.includes(tag)) continue
    if (tags.length >= MAX_TAGS) {
      skipped++
      continue
    }
    rows.push({ id: book.id, tags: [...tags, tag] })
  }
  const changed = await commit(rows, `加标签「${tag}」`)
  return { changed, skipped }
}

/** 从一批书里移除一个标签 */
export const removeTagFrom = (list: Book[], tag: string): Promise<number> =>
  removeTagsFrom(list, [tag])

/**
 * 一次移除多个标签（批量删标签页走这里）：
 * 每本书只写一次、全批一个事务，避免「一个标签一次全量重读」的连环重渲染。
 * 返回实际被改动的书本数。
 */
export const removeTagsFrom = async (list: Book[], tags: string[]): Promise<number> => {
  const drop = new Set(tags)
  if (!drop.size) return 0
  const rows: Array<{ id: number; tags: string[] }> = []
  for (const book of list) {
    if (book.id == null) continue
    const current = book.tags ?? []
    const next = current.filter((t) => !drop.has(t))
    if (next.length === current.length) continue
    rows.push({ id: book.id, tags: next })
  }
  return commit(rows, `删标签 ${tags.map((t) => `「${t}」`).join('')}`)
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
  const rows: Array<{ id: number; tags: string[] }> = []
  let conflict = 0
  for (const book of list) {
    if (book.id == null) continue
    const tags = book.tags ?? []
    if (!tags.includes(from)) continue
    if (tags.includes(to)) conflict++
    rows.push({ id: book.id, tags: unique(tags.map((t) => (t === from ? to : t))) })
  }
  const changed = await commit(rows, `标签改名为「${to}」`)
  return { changed, conflict }
}

/** 全库改名：书架标签页长按用的就是这个（标签代表全库，不分当前筛选） */
export const renameTagEverywhere = async (
  from: string,
  rawTo: string,
): Promise<{ changed: number; conflict: number }> => {
  const to = clean(rawTo)
  if (!to || to === from) return { changed: 0, conflict: 0 }
  if (books.value.some((b) => (b.tags ?? []).includes(to))) {
    logWarn('tag', `改名目标「${to}」已存在，同名标签会合并`)
  }
  const res = await renameTagIn(books.value, from, to)
  // 当前停在这个标签页上就跟着跳过去，别让用户按完发现回到了「全部」
  if (res.changed && shelfTab.value === from) setShelfTab(to)
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
