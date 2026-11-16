import { ref } from 'vue'
import { db } from '../db'
import type { StoredFont } from '../types'
import type { FontKey } from '../settings'
import type { CustomFontRef } from './theme'

/**
 * 自定义阅读字体。
 *
 * 字体文件动辄几 MB，放 IndexedDB 而不是 localStorage（后者只有 5MB 且只能存字符串）。
 * 文件不进 OPFS：OPFS 里放的是书籍，字体需要在 UI 里直接当 @font-face 用，
 * 拿二进制当场做 Blob URL 更直接。
 *
 * 两处要用同一个字体：
 * - App 界面（排版面板里的预览）→ document.fonts.add(FontFace)
 * - 阅读 iframe（foliate 渲染的内容文档）→ CSS 里 url(blob:)，
 *   iframe 是 blob 源、与父页同源，能加载父页创建的 blob URL。
 */

export interface FontMeta {
  id: string
  name: string
  family: string
  size: number
  addedAt: number
}

export const customFonts = ref<FontMeta[]>([])
export const fontError = ref<string | null>(null)

const faces = new Map<string, FontFace>()
const urls = new Map<string, string>()

const metaOf = (f: StoredFont): FontMeta => ({
  id: f.id,
  name: f.name,
  family: f.family,
  size: f.size,
  addedAt: f.addedAt,
})

/** 家族名只用 ASCII：字体族名出现在 CSS 字符串里，中文名需要额外转义 */
const familyOfId = (id: string): string => `ShugeCustom-${id}`

export const listFonts = async (): Promise<FontMeta[]> => {
  const rows = await db.fonts.toArray()
  customFonts.value = rows.map(metaOf).sort((a, b) => a.addedAt - b.addedAt)
  return customFonts.value
}

export const importFont = async (file: File): Promise<FontMeta> => {
  if (file.size > 24 * 1024 * 1024) {
    throw new Error('字体超过 24MB，请换小一点的字重文件')
  }
  const data = await file.arrayBuffer()
  const id = `f${Date.now().toString(36)}`
  const family = familyOfId(id)
  // 先验证再落库：选错文件时 FontFace.load() 会 reject，不至于留下一条打不开的记录
  const face = new FontFace(family, data)
  await face.load()
  document.fonts.add(face)
  faces.set(id, face)
  const meta: FontMeta = {
    id,
    name: (file.name.replace(/\.[^.]+$/, '').trim() || '自定义字体').slice(0, 40),
    family,
    size: data.byteLength,
    addedAt: Date.now(),
  }
  await db.fonts.add({ ...meta, data })
  customFonts.value = [...customFonts.value, meta]
  return meta
}

export const removeFont = async (id: string): Promise<void> => {
  const face = faces.get(id)
  if (face) {
    document.fonts.delete(face)
    faces.delete(id)
  }
  const url = urls.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urls.delete(id)
  }
  await db.fonts.delete(id)
  customFonts.value = customFonts.value.filter((f) => f.id !== id)
}

/**
 * 按当前设置取字体引用（同步可用性靠 ensureFont 预热）。
 * 返回 null 表示没有可用自定义字体，调用方退回内置字体。
 */
export const fontRefOf = async (key: FontKey): Promise<CustomFontRef | null> => {
  const id = key.startsWith('custom:') ? key.slice('custom:'.length) : ''
  if (!id) return null
  const meta = customFonts.value.find((f) => f.id === id)
  if (!meta) return null
  if (!faces.has(id) || !urls.has(id)) {
    const row = await db.fonts.get(id)
    if (!row) return null
    if (!faces.has(id)) {
      const face = new FontFace(meta.family, row.data)
      await face.load()
      document.fonts.add(face)
      faces.set(id, face)
    }
    if (!urls.has(id)) {
      urls.set(id, URL.createObjectURL(new Blob([row.data])))
    }
  }
  return { family: meta.family, url: urls.get(id) ?? '' }
}

/** 供设置界面在字体列表里做样式预览 */
export const fontCssOf = (meta: FontMeta): string => `'${meta.family}'`

export const formatFontSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
