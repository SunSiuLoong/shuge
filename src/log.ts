/**
 * 运行日志：环形缓冲 + localStorage 落盘，闪退后下次启动还能回看。
 *
 * 为什么要自己写：
 * 1. 安卓 WebView 被系统杀掉（OOM）时 console 全部丢失，事后无从查；
 * 2. 现场只有用户的手机，出问题只能靠「把日志粘回来」；
 * 3. 只要 40 多 KB，不值得引入依赖。
 *
 * 落盘策略：每次写都同步 setItem（一条一条写，代价可接受），
 * 这样进程被强杀时最多丢最后一次写入之后的内容。
 * 环形只留最后 MAX 条，超配额时自动减半重试，绝不因为日志把 App 搞崩。
 */
import { APP_VERSION } from './version'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  /** 时间戳（毫秒） */
  t: number
  lvl: LogLevel
  /** 归类标签：db / tag / qm / boot / ui … */
  tag: string
  msg: string
}

const KEY = 'shuge.logs.v1'
/** 上次运行是否正常收尾：running → 崩溃；closed → 正常 */
const ALIVE_KEY = 'shuge.log.alive.v1'
const MAX = 400

let buf: LogEntry[] | null = null

const read = (): LogEntry[] => {
  if (buf) return buf
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as LogEntry[]) : []
    buf = Array.isArray(arr) ? arr : []
  } catch {
    buf = []
  }
  return buf
}

const persist = (list: LogEntry[]): void => {
  buf = list
  const text = JSON.stringify(list)
  try {
    localStorage.setItem(KEY, text)
  } catch {
    // 配额满：砍掉一半再试一次，还不行就只留内存
    try {
      const half = list.slice(-Math.floor(list.length / 2))
      buf = half
      localStorage.setItem(KEY, JSON.stringify(half))
    } catch {
      /* 只留内存 */
    }
  }
}

/** 概览信息塞进日志头，方便判断环境 */
const envLine = (): string => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  // 只取版本号关键片段，整条 UA 太长
  const wv = /; wv\)/.test(ua) ? 'WebView ' : ''
  const android = /Android ([\d.]+)/.exec(ua)?.[1] ?? '?'
  return `${wv}Android ${android} · ${window.innerWidth}x${window.innerHeight}`
}

const push = (lvl: LogLevel, tag: string, msg: string): void => {
  const list = read()
  list.push({ t: Date.now(), lvl, tag, msg: msg.slice(0, 600) })
  if (list.length > MAX) list.splice(0, list.length - MAX)
  persist(list)
}

/** 记一条事件。msg 里别塞大对象，需要上下文就先 JSON.stringify 小片段 */
export const logEvent = (tag: string, msg: string, lvl: LogLevel = 'info'): void => {
  try {
    push(lvl, tag, msg)
  } catch {
    /* 日志本身绝不能抛错 */
  }
}

export const logInfo = (tag: string, msg: string): void => logEvent(tag, msg, 'info')
export const logWarn = (tag: string, msg: string): void => logEvent(tag, msg, 'warn')
export const logError = (tag: string, msg: string): void => logEvent(tag, msg, 'error')

export const getLogs = (): LogEntry[] => [...read()]

export const clearLogs = (): void => {
  buf = []
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

const timeText = (t: number): string => {
  const d = new Date(t)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}:${pad2(d.getSeconds())}`
}

/** 导出成纯文本（复制 / 贴给开发者用） */
export const exportLogs = (): string => {
  const head = `# 书阁运行日志 · ${new Date().toISOString()} · ${envLine()}`
  const body = read().map((e) => `${timeText(e.t)} [${e.lvl}] ${e.tag}: ${e.msg}`)
  return [head, ...body].join('\n')
}

/**
 * 启动日志系统：接管 console + 全局错误，并检测上次是否是异常退出。
 * 必须在 createApp 之前调用，否则拿不到早期的启动错误。
 */
export const installLogging = (): void => {
  // 上次没收尾 → 不是正常关闭，记一笔，下次打开能看到
  try {
    if (localStorage.getItem(ALIVE_KEY) === 'running') {
      logEvent('boot', '上次没有正常收尾（闪退、被系统清理或强制停止都会这样）', 'warn')
    }
    localStorage.setItem(ALIVE_KEY, 'running')
  } catch {
    /* ignore */
  }

  logEvent('boot', `启动 · v${APP_VERSION} · ${envLine()}`)

  // console.warn / error 转存一份；原方法保留，调试时照样能看
  const wrap = (lvl: 'warn' | 'error'): void => {
    const orig = console[lvl].bind(console)
    console[lvl] = (...args: unknown[]): void => {
      orig(...args)
      try {
        const text = args
          .map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}`
            if (typeof a === 'string') return a
            try {
              return JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(' ')
        push(lvl, 'console', text)
      } catch {
        /* ignore */
      }
    }
  }
  wrap('warn')
  wrap('error')

  window.addEventListener('error', (e) => {
    const err = e.error instanceof Error ? e.error : null
    logEvent(
      'crash',
      `${e.message}${e.filename ? ` @${e.filename.split('/').pop()}:${e.lineno}` : ''}${
        err?.stack ? `\n${err.stack.split('\n').slice(0, 4).join('\n')}` : ''
      }`,
      'error',
    )
  })

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    const msg = r instanceof Error ? `${r.name}: ${r.message}` : String(r)
    logEvent('crash', `未处理的 Promise 拒绝: ${msg}`, 'error')
  })

  // 页面隐藏/退出时标记「正常收尾」，下次启动就不会误判成崩溃
  const markClosed = (): void => {
    try {
      localStorage.setItem(ALIVE_KEY, 'closed')
    } catch {
      /* ignore */
    }
  }
  window.addEventListener('pagehide', markClosed)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markClosed()
    else {
      try {
        localStorage.setItem(ALIVE_KEY, 'running')
      } catch {
        /* ignore */
      }
    }
  })
}
