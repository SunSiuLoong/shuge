import { ref } from 'vue'
import { db } from '../db'
import { logError, logInfo } from '../log'
import type { StoredFont } from '../types'
import type { FontKey } from '../settings'
import { repairFontData } from './fontRepair'
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

/** 带明确中文原因的导入失败，UI 直接展示 message，不加「不能当字体用」前缀 */
export class FontImportError extends Error {}

const faces = new Map<string, FontFace>()
const urls = new Map<string, string>()

/**
 * 按文件头魔数识别真实格式，不看扩展名（用户经常改名/选错）。
 * 返回 null 表示不是任何已知字体格式。
 */
const sniffFontFormat = (data: ArrayBuffer): 'ttf' | 'otf' | 'ttc' | 'woff' | 'woff2' | null => {
  if (data.byteLength < 4) return null
  const v = new DataView(data, 0, 4)
  const tag = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))
  if (tag === 'ttcf') return 'ttc'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'OTTO') return 'otf'
  const version = v.getUint32(0, false)
  if (version === 0x00010000 || tag === 'true') return 'ttf'
  return null
}

/**
 * 从 TTC（TrueType Collection，Windows 系统字体几乎全是它）里抽出第一个字面。
 * 安卓 WebView 的 webfont 不支持 TTC 整包（Chromium 多年已知限制），
 * 但单个字面就是标准 sfnt，切出来 FontFace 能正常用。
 */
const extractFirstTtcFace = (data: ArrayBuffer): ArrayBuffer => {
  const v = new DataView(data)
  const numFonts = v.getUint32(8, false)
  if (numFonts < 1) throw new FontImportError('TTC 字体集里没有可用字面')
  const faceOffset = v.getUint32(12, false)
  const numTables = v.getUint16(faceOffset + 4, false)
  // 表目录里的 offset/length 以该字面起点为基准（相对），整段切片后就是独立 sfnt
  let maxEnd = 12 + numTables * 16
  for (let i = 0; i < numTables; i++) {
    const rec = faceOffset + 12 + i * 16
    const end = v.getUint32(rec + 8, false) + v.getUint32(rec + 12, false)
    if (end > maxEnd) maxEnd = end
  }
  const faceEnd = faceOffset + maxEnd
  if (faceEnd > data.byteLength) throw new FontImportError('TTC 字体集结构损坏')
  return data.slice(faceOffset, faceEnd)
}

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
  const data = await file.arrayBuffer()
  const id = `f${Date.now().toString(36)}`
  const family = familyOfId(id)

  // 先看魔数再谈别的：选错文件、扩展名乱改，都能给出准确原因
  const format = sniffFontFormat(data)
  logInfo('font', `导入 ${file.name} · ${data.byteLength} B · 识别为 ${format ?? '未知格式'}`)
  if (!format) {
    throw new FontImportError('不是字体文件（支持 ttf / otf / woff / woff2 / ttc）')
  }

  // 尺寸限制按「实际要注册的数据」算：TTC 抽出第一个字面后通常远小于整包
  let fontData = data
  if (format === 'ttc') fontData = extractFirstTtcFace(data)
  if (fontData.byteLength > 64 * 1024 * 1024) {
    throw new FontImportError('字体超过 64MB，太大了（中文字库建议单字重 30MB 以内的 ttf）')
  }

  // 先验证再落库：选错文件时 FontFace.load() 会 reject，不至于留下一条打不开的记录
  // 加载失败先试自动修复（OS/2 负值、vhea 版本等 OTS 常见抱怨），修好再试一次
  let face = new FontFace(family, fontData)
  try {
    await face.load()
  } catch (err0) {
    const repaired = repairFontData(fontData)
    if (!repaired) {
      const detail = err0 instanceof Error ? `${err0.name}: ${err0.message}` : String(err0)
      logError('font', `解析失败 · ${format} · ${data.byteLength} B · ${detail}`)
      throw new FontImportError(
        format === 'ttc'
          ? 'TTC 字面解析失败，请换 ttf / otf / woff / woff2 文件'
          : `设备不支持这种 ${format.toUpperCase()} 字体，解析失败（${detail}）`,
      )
    }
    face = new FontFace(family, repaired.data)
    try {
      await face.load()
    } catch (err1) {
      const detail = err1 instanceof Error ? `${err1.name}: ${err1.message}` : String(err1)
      logError('font', `自动修复后仍失败 · ${format} · 修复项 ${repaired.fixes.join(';')} · ${detail}`)
      throw new FontImportError(
        `字体结构损坏且自动修复无效（${detail}），请换一份正常字重的文件`,
      )
    }
    fontData = repaired.data
    logInfo('font', `自动修复成功 · ${repaired.fixes.join(';')}`)
  }
  logInfo('font', `导入成功 · ${format} · ${fontData.byteLength} B`)
  document.fonts.add(face)
  faces.set(id, face)
  const meta: FontMeta = {
    id,
    name: (file.name.replace(/\.[^.]+$/, '').trim() || '自定义字体').slice(0, 40),
    family,
    size: fontData.byteLength,
    addedAt: Date.now(),
  }
  await db.fonts.add({ ...meta, data: fontData })
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
      try {
        await face.load()
      } catch (err) {
        const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        logError('font', `重载失败 · ${meta.name} · ${row.data?.byteLength ?? '?'} B · ${detail}`)
        throw new FontImportError(`字体「${meta.name}」重载失败，请删除后重新导入（${detail}）`)
      }
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
