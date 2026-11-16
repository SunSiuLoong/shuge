/**
 * 莫奈取色：取一个主色，把整屏的强调色换掉。
 *
 * 颜色来源有三条路（见 settings.monetSource）：
 * - system：手机系统壁纸的动态取色（Android 12+ Material You），默认；
 * - manual：自选色板；
 * - image ：用户自己选的图片。
 *
 * 早期版本从「最近读的那本书的封面」取色——已废弃：用户要的是整机一致的观感，
 * 换本书就换一套颜色反而乱。
 *
 * 取不到色（非原生壳、系统低于 12、图片解码失败）时退回 settings.monetHex，
 * 不会让界面变成没有强调色的灰板。
 */

export interface MonetColor {
  h: number
  s: number
  l: number
}

const DEFAULT_COLOR: MonetColor = { h: 14, s: 58, l: 44 }

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else h = ((rr - gg) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

export const hslCss = (c: MonetColor, alpha?: number): string =>
  alpha == null
    ? `hsl(${Math.round(c.h)} ${Math.round(c.s)}% ${Math.round(c.l)}%)`
    : `hsl(${Math.round(c.h)} ${Math.round(c.s)}% ${Math.round(c.l)}% / ${alpha})`

/**
 * 抽主色：缩到 32×40 后按色相分 12 桶，取「饱和 × 中间亮度」权重最高的一桶。
 * 直接取平均色会得到一片灰——书封上大量留白和黑字会把均值拉平。
 */
export const extractAccent = async (blob: Blob): Promise<MonetColor | null> => {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(blob)
    const W = 32
    const H = 40
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, W, H)
    const { data } = ctx.getImageData(0, 0, W, H)
    const buckets = new Map<number, { w: number; h: number; s: number; l: number }>()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
      // 近黑、近白、纯灰不参与：它们做强调色要么看不见，要么像没上色
      if (l < 12 || l > 92 || s < 10) continue
      const key = Math.round(h / 30) % 12
      const weight = (s / 100) * (1 - Math.abs(l - 50) / 60)
      if (weight <= 0) continue
      const b = buckets.get(key)
      if (b) {
        b.w += weight
        b.h += h * weight
        b.s += s * weight
        b.l += l * weight
      } else {
        buckets.set(key, { w: weight, h: h * weight, s: s * weight, l: l * weight })
      }
    }
    let best: { w: number; h: number; s: number; l: number } | null = null
    for (const b of buckets.values()) {
      if (!best || b.w > best.w) best = b
    }
    if (!best || best.w <= 0) return null
    return { h: best.h / best.w, s: best.s / best.w, l: best.l / best.w }
  } catch {
    return null
  } finally {
    bitmap?.close?.()
  }
}

const hslToRgb = (c: MonetColor): [number, number, number] => {
  const h = ((c.h % 360) + 360) % 360 / 360
  const s = c.s / 100
  const l = c.l / 100
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ]
}

/** WCAG 相对亮度，用来判断「白字压这个底色」够不够 */
const relLum = (c: MonetColor): number => {
  const [r, g, b] = hslToRgb(c).map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * 把取到的色压进「能当强调色」的区间。
 *
 * 两种明暗里 accent 的用途不同，约束也不同：
 * - 浅色：accent 主要当底色，上面压白字（主按钮、徽标），所以亮度要够低
 * - 深色：accent 主要当文字/线条压在近黑底上，亮度要够高；
 *   这时按钮上的字改用 --on-accent（近黑），不再是白字
 * 两边都按 WCAG 的亮度反推，而不是凭 HSL 的 L 猜——绿色在同样 L 下亮度远高于蓝色。
 */
const usable = (c: MonetColor, dark: boolean): MonetColor => {
  const s = clamp(c.s, 34, 72)
  if (dark) {
    let l = clamp(c.l, 44, 56)
    let guard = 0
    // 按最浅的那层底来算：#282c30（浮层面板 surface）比页面底色 #16181a 亮，
    // 只按 #16181a 过关的话，弹层里的选中文字会掉到 4.38。
    // 对 #282c30 达到 4.5:1 需要 relLum ≥ 0.294。
    while (guard < 24 && relLum({ h: c.h, s, l }) < 0.294) {
      l += 2
      guard += 1
    }
    return { h: c.h, s, l: Math.min(80, l) }
  }
  let l = clamp(c.l, 34, 46)
  let guard = 0
  // 白字要 4.5:1，底色 relLum 必须 ≤ 0.183
  while (guard < 24 && 1.05 / (relLum({ h: c.h, s, l }) + 0.05) < 4.5) {
    l -= 2
    guard += 1
  }
  return { h: c.h, s, l: Math.max(18, l) }
}

/**
 * 生成莫奈式背景晕染：主色两侧各偏 45° 的两个低饱和色，
 * 三个大半径径向渐变叠在底色上。刻意压低不透明度，正文区域不抢字。
 */
const washOf = (c: MonetColor, dark: boolean): string => {
  const a = dark ? 0.26 : 0.3
  const c1 = hslCss({ h: c.h, s: clamp(c.s * 0.82, 26, 60), l: dark ? 34 : 74 }, a)
  const c2 = hslCss(
    { h: (c.h + 48) % 360, s: clamp(c.s * 0.7, 20, 52), l: dark ? 30 : 78 },
    a * 0.85,
  )
  const c3 = hslCss(
    { h: (c.h + 312) % 360, s: clamp(c.s * 0.66, 18, 48), l: dark ? 28 : 80 },
    a * 0.8,
  )
  return [
    `radial-gradient(120% 80% at 12% 0%, ${c1} 0%, transparent 62%)`,
    `radial-gradient(100% 70% at 92% 12%, ${c2} 0%, transparent 58%)`,
    `radial-gradient(120% 90% at 50% 100%, ${c3} 0%, transparent 60%)`,
  ].join(',')
}

let currentAccent: MonetColor | null = null

/** 把取色结果写到根节点；无封面时用默认色，保证风格不发灰 */
export const applyMonet = (color: MonetColor | null, dark: boolean): void => {
  const c = usable(color ?? DEFAULT_COLOR, dark)
  currentAccent = c
  const root = document.documentElement
  root.style.setProperty('--accent', hslCss(c))
  root.style.setProperty('--accent-soft', hslCss(c, dark ? 0.18 : 0.12))
  root.style.setProperty('--monet-wash', washOf(c, dark))
}

/** 切回经典/玻璃时把覆盖掉的变量清掉，否则会一直延续上一个封面的颜色 */
export const clearMonet = (): void => {
  currentAccent = null
  const root = document.documentElement
  root.style.removeProperty('--accent')
  root.style.removeProperty('--accent-soft')
  root.style.removeProperty('--monet-wash')
}

/** 明暗切换后按新底色重算一次亮度区间 */
export const refreshMonet = (dark: boolean): void => {
  if (currentAccent) applyMonet(currentAccent, dark)
}

/** 从一本书的封面 Blob 取色并应用；没有封面时用默认色 */
export const applyMonetFromCover = async (blob: Blob | undefined, dark: boolean): Promise<void> => {
  const color = blob && blob.size > 0 ? await extractAccent(blob) : null
  applyMonet(color, dark)
}

/* ---------- hex 往来：系统动态色 / 色板 / 图片取色最后都落到 hex ---------- */

export const hexToMonet = (hex: string): MonetColor | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  const [h, s, l] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255)
  return { h, s, l }
}

export const monetToHex = (c: MonetColor): string => {
  const [r, g, b] = hslToRgb(c)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 当前生效的强调色（hex）。设置页拿它显示「当前主色」 */
export const currentAccentHex = (): string | null =>
  currentAccent ? monetToHex(currentAccent) : null

/**
 * 按 hex 上色。会先压进「能当强调色」的亮度区间，
 * 所以设置页显示的颜色可能和用户选的略有出入——这是为了对比度，不是 bug。
 */
export const applyAccentHex = (hex: string, dark: boolean): string | null => {
  const c = hexToMonet(hex)
  if (!c) return null
  applyMonet(c, dark)
  return monetToHex(usable(c, dark))
}

/** 图片取色：和封面取色共用一套算法，只是入口不同 */
export const accentFromImage = async (blob: Blob): Promise<string | null> => {
  const c = await extractAccent(blob)
  return c ? monetToHex(c) : null
}

export interface MonetPreset {
  key: string
  name: string
  /** 主色（真正拿去当 accent 的那个） */
  accent: string
  /** 色板预览：主色 + 深浅搭配，和壁纸取色出来的是一套思路 */
  swatches: string[]
}

/** 自选配色的六个预设。名字走「物候」而不是「红黄蓝绿」，和书阁的纸感调子一致 */
export const MONET_PRESETS: MonetPreset[] = [
  { key: 'pine', name: '雾松', accent: '#4a6b5a', swatches: ['#2f5347', '#4a6b5a', '#7a9a86', '#cfdcd2', '#eef2ed'] },
  { key: 'sea', name: '浅海', accent: '#2f6f8f', swatches: ['#1f4f68', '#2f6f8f', '#7fadc4', '#cfe0e9', '#edf4f7'] },
  { key: 'iris', name: '鸢尾', accent: '#5b4a82', swatches: ['#3f3560', '#5b4a82', '#9a8fbd', '#ddd8ea', '#f2eff8'] },
  { key: 'rouge', name: '胭脂', accent: '#8c3b3b', swatches: ['#6b2b2b', '#8c3b3b', '#c08080', '#e8cfcf', '#f7eeee'] },
  { key: 'wheat', name: '麦穗', accent: '#7a6a2f', swatches: ['#5c4f22', '#7a6a2f', '#b0a269', '#e2dcc2', '#f5f2e6'] },
  { key: 'graphite', name: '石墨', accent: '#3b4a5a', swatches: ['#2a3644', '#3b4a5a', '#7d8b9a', '#d3d9df', '#eef1f4'] },
]
