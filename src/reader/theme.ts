import { resolveTheme, type ReaderSettings, type ResolvedTheme } from '../settings'

export interface ReaderPalette {
  bg: string
  text: string
  text2: string
  accent: string
  line: string
}

/** 与 styles/base.css 的主题令牌保持一致（键为解析后的主题） */
export const READER_PALETTES: Record<ResolvedTheme, ReaderPalette> = {
  paper: { bg: '#fbf9f4', text: '#23211e', text2: '#6b665c', accent: '#b4472f', line: 'rgba(0,0,0,0.08)' },
  rice: { bg: '#f2ebdd', text: '#3a3229', text2: '#746a5b', accent: '#9c4a2f', line: 'rgba(58,50,41,0.12)' },
  green: { bg: '#e7efe4', text: '#2a322a', text2: '#5f6b5e', accent: '#4a7050', line: 'rgba(42,50,42,0.1)' },
  night: { bg: '#16181a', text: '#c9c5bc', text2: '#8f8b83', accent: '#d2654a', line: 'rgba(255,255,255,0.1)' },
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

/**
 * 注入到 foliate 渲染器 shadow DOM 内的样式。
 * 只做"阅读体验统一"该做的事，不改动书籍的结构与分页。
 */
export const buildReaderCSS = (s: ReaderSettings): string => {
  const theme = resolveTheme(s.theme)
  const p = READER_PALETTES[theme]
  const family = s.fontFamily === 'serif' ? serifStack : sansStack
  const indent = s.indent ? '2em' : '0'
  const align = s.justify ? 'justify' : 'start'

  return `
    @namespace epub "http://www.idpf.org/2007/ops";

    @font-face {
      font-family: 'Shuge Serif';
      src: url('${fontUrl()}') format('woff');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

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
