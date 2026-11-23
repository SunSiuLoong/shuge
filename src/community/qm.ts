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
import { logEvent, logWarn } from '../log'

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

/**
 * dsu_paulsign 的表情键（插件 img/emot 目录全集，站点默认装这 9 个）。
 * 页面解析失败时的兜底——千万别往里加别的键，站点会回
 * 「你选择的心情不正确」。
 */
const FALLBACK_EMOTIONS: QmEmotion[] = [
  { key: 'kx', label: '开心' },
  { key: 'ng', label: '难过' },
  { key: 'ym', label: '郁闷' },
  { key: 'wl', label: '无聊' },
  { key: 'nu', label: '怒' },
  { key: 'ch', label: '擦汗' },
  { key: 'fd', label: '奋斗' },
  { key: 'yl', label: '慵懒' },
  { key: 'shuai', label: '衰' },
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

/**
 * 表情选项有两种渲染：桌面版是 radio input，手机版（touch 模板）是
 * <select name="qdxq"> 里的 option——两种都要解析。
 * 拉成纯函数方便单测（真站页面结构见 _tmp/sign_touch.htm 快照）。
 */
export const emotionsOf = (html: string): QmEmotion[] => {
  const out: QmEmotion[] = []
  const re = /name="qdxq"[^>]*value="([a-z0-9_]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (out.some((e) => e.key === m![1])) continue
    const after = html.slice(re.lastIndex, re.lastIndex + 400)
    const alt = /alt="([^"]+)"/.exec(after)?.[1]
    out.push({ key: m[1], label: alt || m[1] })
  }
  if (!out.length) {
    const sel = /<select[^>]*name="qdxq"[^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1]
    const reOpt = /<option[^>]*value="([^"]+)"[^>]*>\s*([^<]*?)\s*</g
    let o: RegExpExecArray | null
    while (sel && (o = reOpt.exec(sel))) {
      if (!out.some((e) => e.key === o![1])) out.push({ key: o[1], label: o[2] || o[1] })
    }
  }
  return out
}

export const getSignState = async (): Promise<SignState> => {
  const r = await qmGet('/plugin.php?id=dsu_paulsign:sign')
  const loggedIn = loggedInOf(r.body)
  if (!loggedIn) {
    return { ok: false, loggedIn: false, signed: false, formhash: null, emotions: [], message: '还没登录，先在社区里登录一次' }
  }
  const signed = /已经签到|今日已签|签到时间还未开始|签到过了/.test(r.body)
  const formhash = formhashOf(r.body)
  const emotions = emotionsOf(r.body)
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
 * 站点限制 todaysay 最少 3 个、最多 50 个中文字符——诗词原句超长就截断，
 * 短于 3 就垫足。
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

  const pool = state.emotions.length ? state.emotions : FALLBACK_EMOTIONS
  const emotion = pool[Math.floor(Math.random() * pool.length)]
  const { randomPoem } = await import('./poems')
  const poem = randomPoem()
  let mood = poem.text.slice(0, 30)
  // 站点限制 todaysay 最少 3 个中文字符（手机版页面明写「最少3个,最多50个」）
  while ([...mood].length < 3) mood += '…'

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

/**
 * Discuz 提示文案的容器（alert / showmessage / msgbox …）。
 *
 * 为什么要分容器：申请成功后站点基本都会 302 回任务列表页，那一页里
 * 别的任务还挂着「您已申请过此任务」的灰字状态。以前拿整页去匹配，
 * 就会出现「刚领到却提示今天已经领过了」的误判。
 */
const messageZoneOf = (html: string): string =>
  /<div[^>]*class="[^"]*(?:alert|showmessage|msgbox|tip)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ??
  ''

/** 还带「立即申请」链接 → 这一页是任务列表，不是结果提示页 */
const looksLikeTaskList = (html: string): boolean => /do=apply&id=\d+/.test(normalizeAmp(html))

/**
 * 单次申请的判定：成功优先 → 提示区里认「已申请过」→ 其余交回调用方报未知。
 * 提示区缺失且这页像列表页时，不猜「已申请过」（宁可报未知，也别把成功说成已领过）。
 */
const applyOutcome = (body: string): 'applied' | 'already' | 'unknown' => {
  if (/申请成功|申请的任务已完成|任务已成功完成/.test(body)) return 'applied'
  const zone = messageZoneOf(body)
  const scope = zone || (looksLikeTaskList(body) ? '' : body)
  if (/您已申请过此任务|本期您已申请过/.test(scope)) return 'already'
  return 'unknown'
}

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
    const applyIds = taskIdsOf(newHtml, 'apply')
    logEvent('qm', `新任务页：${applyIds.length} 个可申请（${applyIds.join(',') || '无'}）`)
    for (const id of applyIds) {
      try {
        const res = await fetch(`/home.php?mod=task&do=apply&id=${id}`)
        const outcome = applyOutcome(res.body)
        // 提示区文字才是站点给的正式回执（拒绝理由也在这里）
        const zoneText = stripTags(messageZoneOf(res.body)).replace(/\s+/g, ' ').trim().slice(0, 80)
        // 把判定结果落进日志：下次再出现「明明领到却说已领过」，直接看这行
        const snippet = stripTags(messageZoneOf(res.body) || res.body).replace(/\s+/g, ' ').slice(0, 60)
        logEvent(
          'qm',
          `申请任务 ${id} → ${outcome}（${res.body.length}B）「${snippet}」`,
          outcome === 'unknown' ? 'warn' : 'info',
        )
        if (outcome === 'applied') {
          applied.push(id)
        } else if (outcome === 'already') {
          already.push(id)
        } else {
          // 有提示区 → 站点自己的拒绝理由（用户组/名额/前置任务）；
          // 没提示区 → 这页不是结果页（多半直接跳回了列表），别把列表灰字当失败原因
          fails.push(zoneText || '站点没有返回明确结果，稍后再试一次')
        }
      } catch (e) {
        logWarn('qm', `申请任务 ${id} 异常：${e instanceof Error ? e.message : String(e)}`)
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
    if (r.applied) parts.push(`威望红包已到账（本次申请 ${r.applied} 项）`)
    if (r.already && !r.applied) parts.push('今日威望此前已领过，今天不必再领')
    if (r.drawn) parts.push(`另有 ${r.drawn} 项奖励已领取`)
    logEvent('qm', `领威望结果：${parts.join('；')}`)
    return { ok: true, applied: r.applied, drawn: r.drawn, message: parts.join('；') }
  }
  if (r.doneToday) {
    logEvent('qm', '领威望结果：已完成列表里有今天的红包任务')
    return {
      ok: true,
      applied: 0,
      drawn: 0,
      message: '今日威望已领过（已完成任务里能看到今天的红包记录）',
    }
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
