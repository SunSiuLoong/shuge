import { resolveTheme, settings, type FontKey, type ReaderSettings, type ResolvedTheme } from '../settings'

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
export const readerVars = (p: ReaderPalette): Record<string, string> => {
  const vars: Record<string, string> = {
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
  }
  /* [shuge] 液态玻璃外观下，阅读页的 --glass-* 必须跟着阅读配色走：
     底色取 p.bg（同顶栏/正文同源，避免白玻璃压暖纸显成白带）；
     alpha 参考 Lumi_Books 的对比遮罩（neutral veil 0.60）——透一点点，
     靠 blur 保住文字可读性 */
  if (settings.uiStyle === 'glass') {
    const night = p.bg === '#16181a'
    /* 实底占比 = 100 - 设置里的「玻璃透明度」。这里原先写死 60/62，
       导致阅读页顶底栏和目录抽屉不跟滑条走。夜读 +2 个百分点：
       深底上的模糊更容易透出正文笔画。
       [shuge] 基底必须用 surface 而不是 bg：玻璃盖在同色正文底上，
       alpha 再怎么调视觉上也零变化（面板和页面融成一块）。
       surface 与 bg 有一档明暗差，玻璃才「浮」得起来 */
    const solid = Math.min(92, Math.max(8, 100 - settings.glassOpacity))
    const alpha = night ? Math.min(92, solid + 2) : solid
    vars['--glass-bg'] = `color-mix(in srgb, ${p.surface} ${alpha}%, transparent)`
    vars['--glass-line'] = night ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)'
    vars['--glass-highlight'] = night
      ? 'inset 0 1px 0 rgba(255,255,255,0.08)'
      : 'inset 0 1px 0 rgba(255,255,255,0.35)'
    vars['--glass-shadow'] = night
      ? '0 12px 40px -16px rgba(0,0,0,0.72)'
      : '0 12px 40px -16px rgba(40,32,24,0.32)'
    vars['--glass-blur-bar'] = '22px'
    vars['--glass-blur-sheet'] = '30px'
    vars['--glass-saturate'] = '180%'
  }
  return vars
}

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
      /* [shuge] 字重/字间距（readest fontWeight / letterSpacing 对齐项）。
         内置宋体只有 400 一档，其他档位交给浏览器合成加粗/减淡 */
      font-weight: ${s.fontWeight} !important;
      letter-spacing: ${s.letterSpacing}em !important;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }

    p, li, dd, dt, blockquote, td, th {
      font-family: ${family} !important;
      line-height: ${s.lineHeight} !important;
      font-weight: ${s.fontWeight} !important;
      letter-spacing: ${s.letterSpacing}em !important;
      color: ${p.text} !important;
    }

    p {
      font-size: 1em !important;
      text-indent: ${indent} !important;
      /* [shuge] 段间距（readest paragraphMargin 对齐项），旧版固定 0.35em */
      margin: 0 0 ${s.paragraphMargin}em !important;
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

    /* 插图：约束进视口，避免分页时被切两半或撑破栏宽。
       [shuge] audio 也一并约束：EPUB 3.3 核心媒体类型含 MP3/M4A/OPUS，
       有些书的 <audio controls> 原生宽 300px，窄屏分栏下会溢出栏宽。 */
    img, svg, video, audio, image {
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
