import { reactive, ref, watch } from 'vue'
import { db } from '../db'
import type { Book } from '../types'
import { applyLink, pickBest, searchSources } from './index'

/**
 * 导入后自动关联评分站。
 *
 * 用户的要求：导入完在后台自己去匹配「评分人数最多」的那条，不用一本本点。
 * 三条硬约束：
 * 1. **串行 + 间隔**：500 本同时发请求必被豆瓣 403，队列一次只跑一本，间隔 500ms；
 * 2. **不阻塞导入**：enqueue 只把任务丢进链里，解析/落盘照常往下走；
 * 3. **不覆盖已有选择**：已经有 link 的书（手动选过）直接跳过。
 *
 * 设置页可以关掉（离线导入、流量敏感时），关掉后仍可手动「关联」。
 */

const KEY = 'shuge.autolink.v1'

const loadFlag = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export const autoLinkEnabled = ref(loadFlag())

watch(autoLinkEnabled, (v) => {
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    /* 存储被禁用时静默降级 */
  }
})

export const setAutoLink = (v: boolean): void => {
  autoLinkEnabled.value = v
}

/** 设置页展示用：队列里还有几本、这一轮成了几本 */
export const autoLinkState = reactive({
  queued: 0,
  running: false,
  linked: 0,
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let chain: Promise<void> = Promise.resolve()

/** 给一本书做自动关联；已有 link 或查不到就返回 false */
export const autoLinkBook = async (book: Book): Promise<boolean> => {
  if (book.id == null || book.link) return false
  const list = await searchSources(book.title, book.author)
  const best = pickBest(list)
  if (!best) return false
  await applyLink(book.id, best, true)
  return true
}

/**
 * 把一本刚导入的书排进自动关联队列。
 * 不用 await——导入流程不该等网络；书架靠 liveQuery 自己会刷新。
 */
export const enqueueAutoLink = (bookId: number): void => {
  if (!autoLinkEnabled.value) return
  autoLinkState.queued += 1
  chain = chain
    .then(async () => {
      const book = await db.books.get(bookId)
      if (!book) return
      autoLinkState.running = true
      const ok = await autoLinkBook(book)
      if (ok) autoLinkState.linked += 1
    })
    .catch(() => {
      /* 单本失败不影响后面的书 */
    })
    .finally(async () => {
      autoLinkState.queued = Math.max(0, autoLinkState.queued - 1)
      if (autoLinkState.queued === 0) autoLinkState.running = false
      // 队列里还有别的书时才等，最后一本不用白等 500ms
      if (autoLinkState.queued > 0) await sleep(500)
    })
}
