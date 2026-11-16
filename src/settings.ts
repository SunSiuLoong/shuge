import { reactive, ref, watch } from 'vue'

export type ThemeKey = 'auto' | 'paper' | 'rice' | 'green' | 'night'
/** 实际渲染用的主题（auto 解析后） */
export type ResolvedTheme = Exclude<ThemeKey, 'auto'>
export type FontKey = 'serif' | 'sans'
export type FlowKey = 'paginated' | 'scrolled'

export interface ReaderSettings {
  theme: ThemeKey
  fontSize: number
  lineHeight: number
  /** 左右边距，px */
  margin: number
  fontFamily: FontKey
  justify: boolean
  indent: boolean
  flow: FlowKey
}

const KEY = 'shuge.settings.v1'

const DEFAULTS: ReaderSettings = {
  theme: 'auto',
  fontSize: 18,
  lineHeight: 1.75,
  margin: 24,
  fontFamily: 'serif',
  justify: true,
  indent: true,
  flow: 'paginated',
}

const load = (): ReaderSettings => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReaderSettings>) }
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

const THEME_COLORS: Record<ResolvedTheme, string> = {
  paper: '#FBF9F4',
  rice: '#F2EBDD',
  green: '#E7EFE4',
  night: '#16181A',
}

const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

/** 系统暗色状态：做成响应式，阅读器要靠它重建 iframe 内的排版样式。
 *  只监听 darkQuery.change 而不给阅读器信号的话，书架会变深、正文不会。 */
export const systemDark = ref(darkQuery?.matches ?? false)

/** auto → 按系统暗色解析为 night/paper，其余原样返回 */
export const resolveTheme = (theme: ThemeKey): ResolvedTheme => {
  if (theme !== 'auto') return theme
  return systemDark.value ? 'night' : 'paper'
}

export const applyTheme = (theme: ThemeKey): void => {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[resolved])
}

applyTheme(settings.theme)
watch(() => settings.theme, applyTheme)

/** 跟随系统：暗色模式切换时若处于 auto，实时切换主题 */
if (darkQuery) {
  darkQuery.addEventListener('change', (e) => {
    systemDark.value = e.matches
    if (settings.theme === 'auto') applyTheme('auto')
  })
}

export const THEME_LABELS: Record<ThemeKey, string> = {
  auto: '跟随系统',
  paper: '纸白',
  rice: '宣纸',
  green: '护眼',
  night: '夜读',
}

export const resetSettings = (): void => {
  Object.assign(settings, DEFAULTS)
}
