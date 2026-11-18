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
  }): Promise<{ status: number; url: string; body: string }>
  download(opts: { url: string; name?: string }): Promise<{ ok: boolean; id?: string }>
}

export const CommunityHttp = registerPlugin<CommunityHttpPlugin>('CommunityHttp')

export interface QmResponse {
  status: number
  url: string
  body: string
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

/** 顶部导航有 logout 链接 = 已登录（游客页只有 login/register） */
export const loggedInOf = (html: string): boolean => /action=logout/.test(html)

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
}

export const getSignState = async (): Promise<SignState> => {
  const r = await qmGet('/plugin.php?id=dsu_paulsign:sign')
  const loggedIn = loggedInOf(r.body)
  if (!loggedIn) {
    return { ok: false, loggedIn: false, signed: false, formhash: null, emotions: [], message: '还没登录，先在社区里登录一次' }
  }
  const signed = /已经签到|今日已签|已连续签到/.test(r.body)
  const formhash = formhashOf(r.body)
  const emotions: QmEmotion[] = []
  const re = /name="qdxq"[^>]*value="([a-z0-9_]+)"[^>]*>\s*(?:<[^>]*>)*<img[^>]*alt="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(r.body))) {
    if (!emotions.some((e) => e.key === m![1])) emotions.push({ key: m[1], label: m[2] || m[1] })
  }
  return { ok: true, loggedIn: true, signed, formhash, emotions, message: '' }
}

export interface SignOutcome {
  ok: boolean
  message: string
}

/**
 * 一键签到：随机表情 + 随机古诗词一句话。
 * 表情从签到页解析到的 qdxq 选项里随机挑；解析不到就退标准集。
 */
export const doSign = async (): Promise<SignOutcome> => {
  const state = await getSignState()
  if (!state.ok) return { ok: false, message: state.message }
  if (!state.formhash) return { ok: false, message: '拿不到表单令牌（formhash），站点结构可能变了' }
  if (state.signed) return { ok: true, message: '今天已经签过啦' }

  const pool = state.emotions.length
    ? state.emotions
    : FALLBACK_EMOTIONS.map((k) => ({ key: k, label: k }))
  const emotion = pool[Math.floor(Math.random() * pool.length)]
  const { randomPoem } = await import('./poems')
  const poem = randomPoem()

  const body = new URLSearchParams({
    formhash: state.formhash,
    qdxq: emotion.key,
    qdcontent: `${poem.text}`,
  }).toString()
  const r = await qmPost('/plugin.php?id=dsu_paulsign:sign&operation=qiandao', body)
  if (/签到成功|已签到|已选心情|您今日已签到|打卡成功/.test(r.body)) {
    return {
      ok: true,
      message: `签到成功 ${emotion.label}｜${poem.text}（${poem.author}）`,
    }
  }
  if (loggedInOf(r.body) && !/登录/.test(r.body.slice(0, 400))) {
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
 * 领取威望：正常流程是在社区「任务」页逐个点申请/领取。这里自动做一遍：
 * 先把可申请的任务都申请了，再把可领取的任务都领了。
 */
export const claimPrestigeTasks = async (): Promise<TaskClaimResult> => {
  const r = await qmGet('/home.php?mod=task')
  if (!loggedInOf(r.body)) {
    return { ok: false, applied: 0, drawn: 0, message: '还没登录，先在社区里登录一次' }
  }
  const applyIds = new Set<string>()
  const drawIds = new Set<string>()
  const reApply = /home\.php\?mod=task&do=apply&id=(\d+)/g
  const reDraw = /home\.php\?mod=task&do=draw&id=(\d+)/g
  let m: RegExpExecArray | null
  while ((m = reApply.exec(r.body))) applyIds.add(m[1])
  while ((m = reDraw.exec(r.body))) drawIds.add(m[1])

  let applied = 0
  let drawn = 0
  for (const id of applyIds) {
    try {
      const res = await qmGet(`/home.php?mod=task&do=apply&id=${id}`)
      if (!/失败|不能|已申请|积分不足|需要/.test(res.body) || /成功|领取/.test(res.body)) applied++
    } catch {
      /* 单个任务失败不影响其它 */
    }
  }
  for (const id of drawIds) {
    try {
      const res = await qmGet(`/home.php?mod=task&do=draw&id=${id}`)
      if (/成功|奖励|获得|威望/.test(res.body)) drawn++
    } catch {
      /* 忽略 */
    }
  }
  if (!applied && !drawn) {
    return { ok: false, applied, drawn, message: '现在没有可申请或可领取的任务' }
  }
  return { ok: true, applied, drawn, message: `申请 ${applied} 项、领取 ${drawn} 项任务奖励` }
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
