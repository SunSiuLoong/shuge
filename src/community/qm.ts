/**
 * 阡陌居（https://www.1000qm.vip/）社区客户端。
 *
 * Discuz 论坛。签到走 dsu_paulsign 插件，威望走 Discuz 任务系统
 * （home.php?mod=task）。登录态在 WebView/CookieManager 里——用户先在
 * 内置浏览器里登录一次，之后原生请求会自动带上 Cookie。
 *
 * 请求走自定义原生插件 CommunityHttp：CookieManager 读 WebView Cookie +
 * HttpURLConnection，绕开 CORS（capacitor 源直接 fetch 论坛会被拦）。
 * 网页端没有这条桥，fetch 也会被 CORS 拦，所以只能提示去 App 里操作。
 */
import { registerPlugin } from '@capacitor/core'
import { Capacitor } from '@capacitor/core'

export const QM_BASE = 'https://www.1000qm.vip'
export const QM_NAME = '阡陌居'

interface CommunityHttpPlugin {
  request(opts: {
    url: string
    method?: string
    body?: string
    contentType?: string
  }): Promise<{ status: number; url: string; body: string; hasCookie?: boolean }>
  download(opts: { url: string; name?: string }): Promise<{ ok: boolean; id?: string }>
}

export const CommunityHttp = registerPlugin<CommunityHttpPlugin>('CommunityHttp')

export interface QmResponse {
  status: number
  url: string
  body: string
  hasCookie?: boolean
}

/** GET 论坛页面；非原生环境直接抛错（fetch 过不了 CORS，装样子没意义） */
export const qmGet = async (path: string): Promise<QmResponse> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('社区功能目前只在安卓 App 里可用（需要 WebView 的登录 Cookie）')
  }
  return CommunityHttp.request({ url: path.startsWith('http') ? path : QM_BASE + path, method: 'GET' })
}

export const qmPost = async (path: string, body: string): Promise<QmResponse> => {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('社区功能目前只在安卓 App 里可用（需要 WebView 的登录 Cookie）')
  }
  return CommunityHttp.request({
    url: path.startsWith('http') ? path : QM_BASE + path,
    method: 'POST',
    body,
    contentType: 'application/x-www-form-urlencoded',
  })
}

/* ---------------- 页面解析 ---------------- */

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, '')
    .trim()

const formhashOf = (html: string): string | null =>
  /name="formhash"[^>]*value="([0-9a-fA-F]+)"/.exec(html)?.[1] ?? null

/**
 * 已登录判定。桌面模板的页面导航带 action=logout 链接，但手机版模板没有——
 * 手机版对游客会直接显示「您还没有登录 / 请先登录」之类的提示页，
 * 所以补一条：页面里没有游客提示就视为已登录（配合 space-uid 正向标记）。
 */
export const loggedInOf = (html: string): boolean => {
  if (/action=logout/.test(html)) return true
  if (/space-uid-\d+/.test(html)) return true
  return !/您还没有登录|您尚未登录|请先登录|没有权限访问|登录后才能/.test(html)
}

/* ---------------- 签到 ---------------- */

/** dsu_paulsign 的表情键。页面解析失败时的兜底（标准插件的表情集） */
const FALLBACK_EMOTIONS = [
  'kx', 'ng', 'ym', 'wl', 'nu', 'fd', 'yl', 'shuai',
  'ka', 'px', 'jy', 'wh', 'aim', 'pq', 'lh', 'dk',
  'fan', 'xy', 'yd', 'zq',
]

export interface QmEmotion {
  key: string
  label: string
}

export interface SignState {
  ok: boolean
  loggedIn: boolean
  signed: boolean
  formhash: string | null
  emotions: QmEmotion[]
  message: string
  /** 临时诊断用：原始页面 */
  rawBody?: string
}

export const getSignState = async (): Promise<SignState> => {
  const r = await qmGet('/plugin.php?id=dsu_paulsign:sign')
  const loggedIn = loggedInOf(r.body)
  if (!loggedIn) {
    return { ok: false, loggedIn: false, signed: false, formhash: null, emotions: [], message: '还没登录，先在社区里登录一次' }
  }
  const signed = /已经签到|今日已签|签到时间还未开始|签到过了/.test(r.body)
  const formhash = formhashOf(r.body)
  const emotions: QmEmotion[] = []
  // dsu_paulsign 的选项是 <input type="radio" name="qdxq" value="kx" ...> <img alt="开心">，
  // input 和 img 之间隔几个标签、顺序也可能反过来，所以按位置往后找最近的 alt
  const re = /name="qdxq"[^>]*value="([a-z0-9_]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(r.body))) {
    if (emotions.some((e) => e.key === m![1])) continue
    const after = r.body.slice(re.lastIndex, re.lastIndex + 400)
    const alt = /alt="([^"]+)"/.exec(after)?.[1]
    emotions.push({ key: m[1], label: alt || m[1] })
  }
  return { ok: true, loggedIn: true, signed, formhash, emotions, message: '', rawBody: r.body }
}

export interface SignOutcome {
  ok: boolean
  message: string
}

/**
 * 一键签到：随机表情 + 随机古诗词一句话。
 * 表情从签到页解析到的 qdxq 选项里随机挑；解析不到就退标准集。
 *
 * 提交字段按 dsu_paulsign 的表单来（对照插件源码与真站签到页）：
 * qdmode=1（说一句话模式）、qdxq=心情、todaysay=想说的话、fastreply=0。
 * 站点限制 todaysay 最少 2 个、最多 30 个中文字符——诗词原句超长就截断，
 * 短于 2 就垫两个字。
 */
export const doSign = async (): Promise<SignOutcome> => {
  const state = await getSignState()
  if (!state.ok) return { ok: false, message: state.message }
  // 先判「已签」再判 formhash：已签结果页没有表单，拿不到令牌是正常的
  if (state.signed) return { ok: true, message: '今天已经签过啦' }
  if (!state.formhash) {
    // 临时诊断：手机版签到页结构待核对，带上页面片段定位
    const snippet = stripTags(state.rawBody ?? '').replace(/\s+/g, ' ').slice(0, 100)
    return { ok: false, message: `拿不到表单令牌（formhash）(${snippet})` }
  }

  const pool = state.emotions.length
    ? state.emotions
    : FALLBACK_EMOTIONS.map((k) => ({ key: k, label: k }))
  const emotion = pool[Math.floor(Math.random() * pool.length)]
  const { randomPoem } = await import('./poems')
  const poem = randomPoem()
  let mood = poem.text.slice(0, 30)
  while ([...mood].length < 2) mood += '…'

  const body = new URLSearchParams({
    formhash: state.formhash,
    qdmode: '1',
    qdxq: emotion.key,
    fastreply: '0',
    todaysay: mood,
  }).toString()
  const r = await qmPost(
    '/plugin.php?id=dsu_paulsign:sign&operation=qiandao&infloat=0&inajax=0',
    body,
  )
  if (/签到成功|打卡成功/.test(r.body)) {
    return {
      ok: true,
      message: `签到成功 ${emotion.label}｜${mood}（${poem.author}）`,
    }
  }
  if (/已经签到|今日已签|签到时间还未开始/.test(r.body)) {
    return { ok: true, message: '今天已经签过啦' }
  }
  if (loggedInOf(r.body)) {
    return { ok: false, message: '提交了，但没看到成功标记，去社区页面确认一下' }
  }
  return { ok: false, message: '签到失败：可能需要先在社区里重新登录' }
}

/* ---------------- 领取威望（Discuz 任务） ---------------- */

export interface TaskClaimResult {
  ok: boolean
  applied: number
  drawn: number
  message: string
}

/**
 * 阡陌居的规则（用户确认）：每日威望红包是「申请即完成」——
 * 新任务列表里点「立即申请」（home.php?mod=task&do=apply&id=N，纯 GET），
 * 奖励直接到账，不需要再点领取奖励。
 *
 * 流程（对照 Discuz touch 模板 space_task_list.htm 与 lang_message 文案）：
 *  1. 新任务 tab：把所有「立即申请」点一遍；
 *     「任务申请成功」= 申请到账；「您已申请过此任务/本期您已申请过」= 今天已领过；
 *  2. 进行中 tab：个别任务要手动领奖（do=draw），顺手领一遍；
 *  3. 一无所获时查「已完成的任务」tab——有红包/威望任务说明今天已领过，
 *     区别于「站点今天真没有任务」。
 *
 * 拉成纯函数是为了能在 Node 里用假页面单测（qmGet 只在原生环境可用）。
 */
export interface TaskFlowResult {
  applied: number
  already: number
  drawn: number
  /** 任务今天已存在于已完成列表（兜底判定「已领过」） */
  doneToday: boolean
  /** 申请没成功时截一句站点原话，方便定位 */
  fails: string[]
}

type Fetcher = (path: string) => Promise<{ body: string }>

/**
 * 任务链接正则坑：页面里 href 的 & 是转义成 &amp; 的（搜索接口的正则
 * 也是按 &amp; 写的），字面 & 永远匹配不到——所以先把实体归一成 & 再找。
 */
const normalizeAmp = (html: string): string => html.replace(/&amp;/g, '&')

const taskIdsOf = (html: string, kind: 'apply' | 'draw'): string[] => {
  const ids = new Set<string>()
  const re = new RegExp(`home\\.php\\?mod=task&do=${kind}&id=(\\d+)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(normalizeAmp(html)))) ids.add(m[1])
  return [...ids]
}

const FAIL_HINTS: Array<[RegExp, string]> = [
  [/您已申请过此任务|本期您已申请过/, '已申请过'],
  [/需要先完成另一个任务/, '有前置任务未完成'],
  [/用户组不允许申请/, '用户组不允许'],
  [/申请人数已满|先到先得/, '名额已满'],
]

export const runTaskClaim = async (fetch: Fetcher): Promise<TaskFlowResult> => {
  const applied: string[] = []
  const already: string[] = []
  const drawn: string[] = []
  const fails: string[] = []

  // 1) 新任务：立即申请（每日威望红包在这里，申请即到账）
  const newHtml = (await fetch('/home.php?mod=task&item=new')).body
  if (loggedInOf(newHtml)) {
    for (const id of taskIdsOf(newHtml, 'apply')) {
      try {
        const res = await fetch(`/home.php?mod=task&do=apply&id=${id}`)
        if (/任务申请成功/.test(res.body)) {
          applied.push(id)
        } else if (/您已申请过此任务|本期您已申请过/.test(res.body)) {
          already.push(id)
        } else {
          fails.push(stripTags(res.body).replace(/\s+/g, ' ').slice(0, 80))
        }
      } catch {
        /* 单个任务失败不影响其它 */
      }
    }

    // 2) 进行中：个别任务要手动「领取奖励」，顺手点一遍
    const doingHtml = (await fetch('/home.php?mod=task&item=doing')).body
    if (loggedInOf(doingHtml)) {
      for (const id of taskIdsOf(doingHtml, 'draw')) {
        try {
          const res = await fetch(`/home.php?mod=task&do=draw&id=${id}`)
          if (/任务已成功完成|恭喜您/.test(res.body)) drawn.push(id)
        } catch {
          /* 同上 */
        }
      }
    }
  }

  // 3) 兜底：啥都没捞到时，看「已完成的任务」里有没有「红包 + 今天的日期」——
  //    已完成列表是历史累积的，昨天的红包条目也会躺在里面，只看名字会误判
  let doneToday = false
  if (!applied.length && !already.length && !drawn.length) {
    try {
      const doneHtml = normalizeAmp((await fetch('/home.php?mod=task&item=done')).body)
      if (loggedInOf(doneHtml)) {
        const d = new Date()
        const pad = (n: number): string => String(n).padStart(2, '0')
        const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        // 按条目切块，红包条目里还得有今天的日期才算今天领过
        const blocks = doneHtml.split(/<li[\s>]/i).filter((b) => /红包/.test(b))
        doneToday = blocks.some((b) => b.includes(todayStr))
      }
    } catch {
      /* 查不了就不猜 */
    }
  }

  return {
    applied: applied.length,
    already: already.length,
    drawn: drawn.length,
    doneToday,
    fails,
  }
}

export const claimPrestigeTasks = async (): Promise<TaskClaimResult> => {
  // 先探登录态——没登录别把页面当「无任务」误报
  const probe = await qmGet('/home.php?mod=task')
  if (!loggedInOf(probe.body)) {
    return { ok: false, applied: 0, drawn: 0, message: '还没登录，先在社区里登录一次' }
  }

  const r = await runTaskClaim(async (path) => qmGet(path))

  if (r.applied || r.already || r.drawn) {
    const parts: string[] = []
    if (r.applied) parts.push(`申请了 ${r.applied} 项任务，威望红包已到账`)
    if (r.already && !r.applied) parts.push('今天已经领过了')
    if (r.drawn) parts.push(`领取了 ${r.drawn} 项奖励`)
    return { ok: true, applied: r.applied, drawn: r.drawn, message: parts.join('；') }
  }
  if (r.doneToday) {
    return { ok: true, applied: 0, drawn: 0, message: '今天已经领过了（已完成列表里有红包任务）' }
  }
  return {
    ok: false,
    applied: 0,
    drawn: 0,
    message: r.fails.length
      ? `任务没申请成：${
          FAIL_HINTS.find(([re]) => re.test(r.fails[0]))?.[1] ?? r.fails[0]
        }`
      : '任务页今天没有可申请的项目',
  }
}

/* ---------------- 社区搜索 ---------------- */

export interface QmSearchItem {
  title: string
  url: string
  forum: string
  time: string
}

export interface QmSearchResult {
  ok: boolean
  items: QmSearchItem[]
  message: string
}

/** 社区搜索（search.php?mod=forum）。游客会被拦，返回 needLogin 语义的 message */
export const searchForum = async (q: string): Promise<QmSearchResult> => {
  if (!q.trim()) return { ok: false, items: [], message: '' }
  const r = await qmGet(
    `/search.php?mod=forum&srchtxt=${encodeURIComponent(q.trim())}&searchsubmit=yes`,
  )
  if (!loggedInOf(r.body)) {
    return { ok: false, items: [], message: '社区搜索要先在社区里登录' }
  }
  const items: QmSearchItem[] = []
  const seen = new Set<string>()
  const re = /<a href="(forum\.php\?mod=viewthread&amp;tid=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(r.body))) {
    const url = QM_BASE + '/' + m[1].replace(/&amp;/g, '&')
    if (seen.has(url)) continue
    const title = stripTags(m[2])
    if (!title || title.length < 2) continue
    seen.add(url)
    items.push({ title, url, forum: '', time: '' })
    if (items.length >= 30) break
  }
  return { ok: items.length > 0, items, message: items.length ? '' : '没搜到相关帖子' }
}
