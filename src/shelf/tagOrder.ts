/**
 * 标签页排序的纯逻辑（不碰 Vue / DOM，方便在 Node 里单测）。
 *
 * 两块：
 * 1. sortByTagOrder —— 自定义顺序优先，没排过的按原顺序（本数降序）接在后面；
 * 2. shiftFor / moveItem —— 拖拽时「其它行让位多少像素」「松手后数组怎么挪」。
 */

/** localStorage 里读出来的东西不可信，先洗干净 */
export const normalizeOrder = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []

/**
 * 按自定义顺序重排。不在 order 里的保持原相对顺序（调用方传进来的通常
 * 已按本数降序排好），稳定排序保证不会被搅乱。
 */
export const sortByTagOrder = <T extends { name: string }>(list: T[], order: string[]): T[] => {
  const rank = new Map(order.map((name, i) => [name, i]))
  return [...list].sort((a, b) => {
    const ra = rank.get(a.name)
    const rb = rank.get(b.name)
    if (ra != null && rb != null) return ra - rb
    if (ra != null) return -1
    if (rb != null) return 1
    return 0
  })
}

/**
 * 拖拽时其它行的位移（像素）。
 * @param from 被拖行的原索引
 * @param to   当前目标索引
 * @param index 要算的这一行
 */
export const shiftFor = (from: number, to: number, index: number, rowH: number): number => {
  if (from === to || index === from) return 0
  if (to > from && index > from && index <= to) return -rowH
  if (to < from && index >= to && index < from) return rowH
  return 0
}

/** 把 from 位置的元素挪到 to 位置（返回新数组，不改原数组） */
export const moveItem = <T>(list: T[], from: number, to: number): T[] => {
  const out = [...list]
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}

/** 手指位移 → 目标索引（行高统一，除一下取整就够） */
export const indexAt = (from: number, dy: number, rowH: number, count: number): number => {
  const raw = from + Math.round(dy / rowH)
  return Math.min(count - 1, Math.max(0, raw))
}
