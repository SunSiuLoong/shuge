import { resolveTheme, type FontKey, type ReaderSettings, type ResolvedTheme } from '../settings'

export interface ReaderPalette {
  bg: string
  surface: string
  surface2: string
  text: string
  text2: string
  text3: string
  accent: string
  accentSoft: string
  line: string
  scrim: string
}

/**
 * 阅读界面的四套配色。键是解析后的主题（follow 已在 settings 里消解）。
 * 除正文色外还带齐 surface/line，因为阅读页的顶栏、底栏、排版面板都用这套变量——
 * App 明暗与阅读配色分离以后，工具栏不能再去取 App 的 --bg，否则会跟正文底色脱节。
 */
export const READER_PALETTES: Record<ResolvedTheme, ReaderPalette> = {
  paper: {
    bg: '#fbf9f4',
    surface: '#ffffff',
    surface2: '#f6f3ec',
    text: '#23211e',
    text2: '#6b665c',
    text3: '#767065',
    accent: '#b4472f',
    accentSoft: 'rgba(180, 71, 47, 0.10)',
    line: 'rgba(0,0,0,0.07)',
    scrim: 'rgba(28,26,23,0.34)',
  },
  rice: {
    bg: '#f2ebdd',
    surface: '#faf5e9',
    surface2: '#ece3d1',
    text: '#3a3229',
    text2: '#746a5b',
    text3: '#6f6658',
    accent: '#9c4a2f',
    accentSoft: 'rgba(156, 74, 47, 0.10)',
    line: 'rgba(58,50,41,0.10)',
    scrim: 'rgba(46,39,30,0.34)',
  },
  green: {
    bg: '#e7efe4',
    surface: '#f2f7f0',
    surface2: '#e1ebdd',
    text: '#2a322a',
    text2: '#5f6b5e',
    text3: '#616e60',
    accent: '#4a7050',
    accentSoft: 'rgba(74, 112, 80, 0.12)',
    line: 'rgba(42,50,42,0.09)',
    scrim: 'rgba(30,40,30,0.34)',
  },
  night: {
    bg: '#16181a',
    surface: '#202326',
    surface2: '#282c30',
    text: '#c9c5bc',
    /* 夜读下 #8f8b83 压 surface-2 只有 4.14:1，排版面板的选项文字不够；提亮一档 */
    text2: '#9a958c',
    text3: '#928e85',
    /* accent 同时充当按钮底色与强调文字：底色上的字用 --on-accent（深色），
       所以这里可以亮一点，保证它作为文字压在深底上也有 4.5:1 */
    accent: '#dd7a60',
    accentSoft: 'rgba(221, 122, 96, 0.16)',
    line: 'rgba(255,255,255,0.08)',
    scrim: 'rgba(0,0,0,0.6)',
  },
}

/** 阅读页根节点要覆盖的 CSS 变量，让顶栏/底栏/浮层跟着阅读配色走 */
export const readerVars = (p: ReaderPalette): Record<string, string> => ({
  '--bg': p.bg,
  '--bg-alt': p.bg,
  '--surface': p.surface,
  '--surface-2': p.surface2,
  '--text': p.text,
  '--text-2': p.text2,
  '--text-3': p.text3,
  '--accent': p.accent,
  '--accent-soft': p.accentSoft,
  /* 夜读的 accent 偏亮，白字压上去只有 3.3:1，改用深字 */
  '--on-accent': p.bg === '#16181a' ? '#14161a' : '#ffffff',
  '--line': p.line,
  '--scrim': p.scrim,
})

/** 字体文件绝对地址：注入到 iframe 的 CSS 里必须用绝对 URL */
const fontUrl = (): string => {
  try {
    return new URL('fonts/serif.woff', document.baseURI).href
  } catch {
    return '/fonts/serif.woff'
  }
}

const serifStack =
  "'Shuge Serif', 'Songti SC', 'Source Han Serif SC', 'Noto Serif CJK SC', 'Noto Serif SC', serif"
const sansStack =
  "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif"

export interface CustomFontRef {
  /** @font-face 的 family 名，导入时按文件名清洗过，唯一 */
  family: string
  /** 可被 iframe 加载的地址（blob: 或 data:） */
  url: string
}

/** 当前设置对应的字体族；custom 字体未加载好时退回宋体 */
export const familyOf = (key: FontKey, custom?: CustomFontRef | null): string => {
  if (key.startsWith('custom:')) {
    return custom ? `'${custom.family}', ${serifStack}` : serifStack
  }
  return key === 'sans' ? sansStack : serifStack
}

/**
 * 注入到 foliate 渲染器 shadow DOM 内的样式。
 * 只做"阅读体验统一"该做的事，不改动书籍的结构与分页。
 */
export const buildReaderCSS = (s: ReaderSettings, custom?: CustomFontRef | null): string => {
  const theme = resolveTheme(s.theme)
  const p = READER_PALETTES[theme]
  const family = familyOf(s.fontFamily, custom)
  const indent = s.indent ? '2em' : '0'
  const align = s.justify ? 'justify' : 'start'
  const customFace =
    custom && s.fontFamily.startsWith('custom:')
      ? `@font-face {
      font-family: '${custom.family}';
      src: url('${custom.url}');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }`
      : ''

  return `
    @namespace epub "http://www.idpf.org/2007/ops";

    @font-face {
      font-family: 'Shuge Serif';
      src: url('${fontUrl()}') format('woff');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

    ${customFace}

    html {
      font-size: ${s.fontSize}px !important;
      background: ${p.bg} !important;
      color: ${p.text} !important;
      color-scheme: ${theme === 'night' ? 'dark' : 'light'};
    }

    /* 滚动模式底栏是浮层，压在正文上。html/body 的 padding 会被 foliate 的
       分栏样式表盖掉，改用尾部伪元素撑高文档，滚到底时最后两行才不会被永久遮住 */
    ${s.flow === 'scrolled' ? "body::after { content: ''; display: block; height: 132px; }" : ''}

    body {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      color: ${p.text} !important;
      font-family: ${family} !important;
      line-height: ${s.lineHeight} !important;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    p, li, dd, dt, blockquote, td, th {
      font-family: ${family} !important;
      line-height: ${s.lineHeight} !important;
      color: ${p.text} !important;
    }

    p {
      font-size: 1em !important;
      text-indent: ${indent} !important;
      margin: 0 0 0.35em !important;
      text-align: ${align} !important;
      text-justify: inter-ideograph;
      hanging-punctuation: allow-end last;
      widows: 2;
      orphans: 2;
      word-break: normal;
      overflow-wrap: break-word;
    }

    [align='left'] { text-align: left !important; }
    [align='right'] { text-align: right !important; }
    [align='center'] { text-align: center !important; text-indent: 0 !important; }
    [align='justify'] { text-align: justify !important; }

    h1, h2, h3, h4, h5, h6 {
      font-family: ${family} !important;
      line-height: 1.4 !important;
      text-indent: 0 !important;
      text-align: start !important;
    }

    /* 浅色主题不强制标题颜色：书里常把标题做成「白字压深色图/黑条」
       （多看模板的卷首页），强行改成主题色会让字和底同色、整块糊掉。
       没指定的标题自然继承 body 的主题色。 */
    ${theme === 'night' ? `h1, h2, h3, h4, h5, h6 { color: ${p.text} !important; }` : ''}

    /* 插图：约束进视口，避免分页时被切两半或撑破栏宽 */
    img, svg, video, image {
      max-width: 100% !important;
      max-height: 88vh !important;
      height: auto !important;
      object-fit: contain;
    }

    figure, .illus, .illustration, .image, p.image {
      margin: 1em 0 !important;
      text-align: center !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    figure img, .illus img, .illustration img { display: inline-block; }

    figcaption {
      margin-top: 0.5em !important;
      font-size: 0.85em !important;
      color: ${p.text2} !important;
      text-align: center !important;
      text-indent: 0 !important;
    }

    /* 竖排书（writing-mode: vertical-*）：别被横排的居中/缩进规则带偏 */
    body[style*='vertical'] p,
    html[style*='vertical'] p {
      text-indent: 0 !important;
      text-align: start !important;
    }

    a, a:link, a:visited {
      color: ${p.accent} !important;
      text-decoration: none !important;
    }

    hr {
      border: 0;
      border-top: 1px solid ${p.line};
      margin: 1.2em 0;
    }

    ::selection {
      background: ${p.accent}33;
    }

    pre {
      white-space: pre-wrap !important;
      font-family: ui-monospace, Menlo, Consolas, monospace !important;
    }

    ruby rt, sub, sup {
      font-size: 0.72em !important;
      line-height: 1 !important;
    }

    aside[epub|type~='footnote'],
    aside[epub|type~='endnote'],
    aside[epub|type~='rearnote'] {
      display: none;
    }
  `
}
