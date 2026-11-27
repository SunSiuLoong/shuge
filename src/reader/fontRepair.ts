/**
 * 字体二进制自动修复。
 *
 * 背景：安卓 WebView 里所有 webfont 都要过 Chromium 的 OTS 安全校验，
 * 部分真实世界的字体（如 Amazon 的 Kindle Kai）带着不合规的表值，
 * FontFace.load() 只会丢一句空泛的 SyntaxError: Invalid font data。
 * 实测 Kindle Kai 的两处问题及修法（2026-11-26，headless Chrome 验证）：
 * 1. OS/2 表 sxHeight / sCapHeight 为负 → 按字面 em 比例补正；
 * 2. vhea 表版本号不合规（0x00010001）→ 原地改回 1.0。
 *
 * 修复策略刻意保持「原地改字节」：不动表目录、不改偏移，
 * 避免重建目录引入新问题；OTS 不校验表 checksum，无需重算。
 * 修复失败或不需要修复返回 null，调用方自行决定下一步。
 */

export interface FontRepairResult {
  data: ArrayBuffer
  fixes: string[]
}

const tagOf = (v: DataView, off: number): string =>
  String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3))

/** 遍历表目录，返回 tag → { offset, length } */
const tableDirectory = (v: DataView): Map<string, { offset: number; length: number }> => {
  const numTables = v.getUint16(4, false)
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    tables.set(tagOf(v, rec), { offset: v.getUint32(rec + 8, false), length: v.getUint32(rec + 12, false) })
  }
  return tables
}

export const repairFontData = (data: ArrayBuffer): FontRepairResult | null => {
  if (data.byteLength < 16) return null
  // 修复会原地改字节，先复制一份，绝不动调用方手里那份数据
  const buf = data.slice(0)
  const v = new DataView(buf)
  const fixes: string[] = []
  const tables = tableDirectory(v)

  // OS/2：version >= 2 才有 sxHeight(@86) / sCapHeight(@88)，必须是 0 ~ 32767
  const os2 = tables.get('OS/2')
  if (os2 && os2.length >= 90) {
    const version = v.getUint16(os2.offset, false)
    if (version >= 2) {
      // head.unitsPerEm 在 head+18，用来按比例给合理值而不是拍脑袋 500/700
      const head = tables.get('head')
      const upem = head && head.length >= 20 ? v.getUint16(head.offset + 18, false) : 1000
      const xDefault = Math.round(upem * 0.5)
      const capDefault = Math.round(upem * 0.7)
      for (const [at, def, name] of [
        [86, xDefault, 'sxHeight'],
        [88, capDefault, 'sCapHeight'],
      ] as const) {
        const val = v.getInt16(os2.offset + at, false)
        if (val < 0 || val > upem * 4) {
          v.setInt16(os2.offset + at, def, false)
          fixes.push(`${name} ${val}→${def}`)
        }
      }
    }
  }

  // vhea：版本必须 0x00010000；不合规就原地改成 1.0（vmtx 内容本身有效）
  const vhea = tables.get('vhea')
  if (vhea && vhea.length >= 4) {
    const ver = v.getUint32(vhea.offset, false)
    if (ver !== 0x00010000) {
      v.setUint32(vhea.offset, 0x00010000, false)
      fixes.push(`vhea 版本 ${ver.toString(16)}→10000`)
    }
  }

  return fixes.length ? { data: buf, fixes } : null
}
