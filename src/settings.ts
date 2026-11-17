import { computed, reactive, ref, watch } from 'vue'

/** 阅读配色。follow = 跟随 App 明暗（App 暗则夜读，亮则纸白） */
export type ThemeKey = 'follow' | 'paper' | 'rice' | 'green' | 'night'
/** 实际渲染用的配色（follow 解析后） */
export type ResolvedTheme = Exclude<ThemeKey, 'follow'>
/** App 界面的明暗 */
export type SchemeKey = 'auto' | 'light' | 'dark'
/** App 界面风格（只影响 UI，不影响阅读正文） */
export type UiStyleKey = 'classic' | 'monet' | 'glass'
/** serif/sans 是内置，custom:<id> 是用户导入的字体 */
export type FontKey = 'serif' | 'sans' | `custom:${string}`
export type FlowKey = 'paginated' | 'scrolled'
export type ShelfLayout = 'grid' | 'list'
/** 自动关联评分时优先信哪个站；auto = 谁评分人数多用谁 */
export type RatingSource = 'auto' | 'douban' | 'weread'
/**
 * 莫奈取色的颜色来源。
 * system = 手机系统壁纸的动态取色（Android 12+ Material You）
 * manual = 自选色板
 * image  = 从自己选的图片里取
 * 早期版本从「最近读的那本书的封面」取色，用户明确否掉了这条路，不再作为选项。
 */
export type MonetSource = 'system' | 'manual' | 'image'

export interface ReaderSettings {
  scheme: SchemeKey
  uiStyle: UiStyleKey
  theme: ThemeKey
  fontSize: number
  lineHeight: number
  /* [shuge] 字重：300 细 / 400 标准 / 500 中 / 700 粗（readest 的 fontWeight 对齐项） */
  fontWeight: number
  /* [shuge] 字间距，em（readest 的 letterSpacing 对齐项；0 为默认） */
  letterSpacing: number
  /* [shuge] 段间距，em（readest 的 paragraphMargin 对齐项；默认 0.35 与旧版视觉一致） */
  paragraphMargin: number
  /** 左右边距，px */
  margin: number
  fontFamily: FontKey
  justify: boolean
  indent: boolean
  flow: FlowKey
  /** 书架呈现方式 */
  shelfLayout: ShelfLayout
  /** 网格列数，2–4 */
  shelfColumns: number
  /** 卡片/列表上显示「全书百分比」 */
  showPercent: boolean
  /** 书架顶部的标签页（全部 / 未分类 / 各题材） */
  shelfTabs: boolean
  /** 莫奈主色的来源 */
  monetSource: MonetSource
  /** 自选/图片取色得到的颜色，system 模式下作为取不到系统色时的兜底 */
  monetHex: string
  ratingSource: RatingSource
}

const KEY = 'shuge.settings.v1'

const DEFAULTS: ReaderSettings = {
  scheme: 'auto',
  uiStyle: 'classic',
  theme: 'follow',
  fontSize: 18,
  lineHeight: 1.75,
  fontWeight: 400,
  letterSpacing: 0,
  paragraphMargin: 0.35,
  margin: 24,
  fontFamily: 'serif',
  justify: true,
  indent: true,
  flow: 'paginated',
  shelfLayout: 'grid',
  shelfColumns: 2,
  showPercent: false,
  shelfTabs: true,
  monetSource: 'system',
  monetHex: '#7c8f7a',
  ratingSource: 'auto',
}

const THEMES: ThemeKey[] = ['follow', 'paper', 'rice', 'green', 'night']
const SCHEMES: SchemeKey[] = ['auto', 'light', 'dark']
const STYLES: UiStyleKey[] = ['classic', 'monet', 'glass']
const LAYOUTS: ShelfLayout[] = ['grid', 'list']
const SOURCES: RatingSource[] = ['auto', 'douban', 'weread']
const MONET_SOURCES: MonetSource[] = ['system', 'manual', 'image']

const pick = <T extends string>(list: T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (list as string[]).includes(v) ? (v as T) : fallback

/**
 * 老版本把 UI 主题和阅读主题混在一个字段里（auto/paper/rice/green/night）。
 * 现在拆成 scheme（App 明暗）+ theme（阅读配色）：
 * - 旧的 auto → scheme=auto, theme=follow（语义等价）
 * - 旧的 paper/rice/green → 浅色 App + 对应阅读配色
 * - 旧的 night → 深色 App + 夜读
 */
const migrate = (raw: Record<string, unknown>): Partial<ReaderSettings> => {
  const out: Record<string, unknown> = { ...raw }
  const old = raw.theme
  if (!('scheme' in raw)) {
    if (old === 'night') out.scheme = 'dark'
    else if (old === 'auto') out.scheme = 'auto'
    else out.scheme = 'light'
  }
  out.theme = old === 'auto' ? 'follow' : pick(THEMES, old, 'follow')
  out.scheme = pick(SCHEMES, out.scheme, 'auto')
  out.uiStyle = pick(STYLES, out.uiStyle, 'classic')
  out.shelfLayout = pick(LAYOUTS, out.shelfLayout, 'grid')
  out.ratingSource = pick(SOURCES, out.ratingSource, 'auto')
  const cols = Number(out.shelfColumns)
  out.shelfColumns = Number.isFinite(cols) ? Math.min(4, Math.max(2, Math.round(cols))) : 2
  if (typeof out.showPercent !== 'boolean') out.showPercent = false
  if (typeof out.shelfTabs !== 'boolean') out.shelfTabs = true
  out.monetSource = pick(MONET_SOURCES, out.monetSource, 'system')
  if (typeof out.monetHex !== 'string' || !/^#[0-9a-f]{6}$/i.test(out.monetHex)) {
    out.monetHex = DEFAULTS.monetHex
  }
  /* [shuge] 排版三项兜底：老存档没有这些字段；数值被写坏时退默认，不让正文排版炸掉 */
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  out.fontWeight = num(out.fontWeight, 400, 300, 700)
  out.letterSpacing = num(out.letterSpacing, 0, 0, 0.2)
  out.paragraphMargin = num(out.paragraphMargin, 0.35, 0, 1.5)
  return out as Partial<ReaderSettings>
}

const load = (): ReaderSettings => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...migrate(JSON.parse(raw) as Record<string, unknown>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = reactive<ReaderSettings>(load())

watch(
  settings,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      /* 存储被禁用时静默降级 */
    }
  },
  { deep: true },
)

/** App 界面底色：跟着明暗走，与阅读配色无关 */
const SCHEME_COLORS: Record<'light' | 'dark', string> = {
  light: '#FBF9F4',
  dark: '#16181A',
}

const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** 系统暗色状态：做成响应式，阅读器要靠它重建 iframe 内的排版样式。 */
export const systemDark = ref(darkQuery?.matches ?? false)

/** App 当前实际明暗（scheme=auto 时取系统） */
export const appDark = computed(() =>
  settings.scheme === 'auto' ? systemDark.value : settings.scheme === 'dark',
)

/** follow → 按 App 明暗解析为 night/paper，其余原样返回 */
export const resolveTheme = (theme: ThemeKey): ResolvedTheme => {
  if (theme !== 'follow') return theme
  return appDark.value ? 'night' : 'paper'
}

/** 当前阅读界面的解析配色 */
export const readerTheme = computed<ResolvedTheme>(() => resolveTheme(settings.theme))

/**
 * 把明暗与 UI 风格写到 <html> 上，样式表靠 [data-scheme] / [data-style] 命中。
 * 不再写 data-theme：阅读配色只作用于阅读页，不参与 App 配色。
 */
export const applyTheme = (): void => {
  const root = document.documentElement
  const scheme = appDark.value ? 'dark' : 'light'
  root.dataset.scheme = scheme
  root.dataset.style = settings.uiStyle
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', SCHEME_COLORS[scheme])
}

applyTheme()

watch([() => settings.scheme, () => settings.uiStyle], applyTheme)

/** 跟随系统：暗色模式切换时若处于 auto，实时切换 */
if (darkQuery) {
  darkQuery.addEventListener('change', (e) => {
    systemDark.value = e.matches
    applyTheme()
  })
}

export const THEME_LABELS: Record<ThemeKey, string> = {
  follow: '跟随 App',
  paper: '纸白',
  rice: '宣纸',
  green: '护眼',
  night: '夜读',
}

export const SCHEME_LABELS: Record<SchemeKey, string> = {
  auto: '跟随系统',
  light: '浅色',
  dark: '深色',
}

export const UI_STYLE_LABELS: Record<UiStyleKey, string> = {
  classic: '经典',
  monet: '莫奈取色',
  glass: '液态玻璃',
}

export const UI_STYLE_NOTES: Record<UiStyleKey, string> = {
  classic: '文库纸面：淡紫底、衬线题字、细格纹',
  monet: '跟系统壁纸取色，整屏跟着变',
  glass: '半透明磨砂，浮层像一片玻璃',
}

export const MONET_SOURCE_LABELS: Record<MonetSource, string> = {
  system: '系统取色',
  manual: '自选配色',
  image: '图片取色',
}

export const MONET_SOURCE_NOTES: Record<MonetSource, string> = {
  system: '读手机壁纸的动态色，Android 12 以上有效',
  manual: '从下面的色板里挑一个主色',
  image: '用一张自己的图取主色',
}

export const RATING_SOURCE_LABELS: Record<RatingSource, string> = {
  auto: '评分人数最多',
  douban: '优先豆瓣',
  weread: '优先微信读书',
}

export const resetSettings = (): void => {
  Object.assign(settings, DEFAULTS)
}
