import type { Book } from '../types'

const cache = new Map<string, string>()

/** 封面 Blob → objectURL。以封面 Blob 本身为键，书删了也不会有陈旧映射 */
export const coverUrlOf = (book: Book): string | undefined => {
  const blob = book.cover
  if (!blob || blob.size === 0) return undefined
  const key = `${book.id}-${blob.size}`
  const hit = cache.get(key)
  if (hit) return hit
  const url = URL.createObjectURL(blob)
  cache.set(key, url)
  return url
}

export const releaseCover = (book: Book): void => {
  const blob = book.cover
  if (!blob) return
  const key = `${book.id}-${blob.size}`
  const hit = cache.get(key)
  if (hit) {
    URL.revokeObjectURL(hit)
    cache.delete(key)
  }
}
