/**
 * 中继核心：Web 标准 Request/Response，零依赖。
 * - Node：由 ./node.mjs 适配到 node:http
 * - Cloudflare Workers：以后直接 export default { fetch: handler } 即可复用
 *
 * 现在只有骨架与约定，具体抓取逻辑待第二版接入。
 * 前期实测：优书网/番茄 DNS 不通、龙空被劫持到 127.0.0.1、起点有 JS 探测墙，
 * 所以每个数据源都必须允许「失败降级」，前端要能在拿不到数据时退回本地手填。
 */

/** 数据源适配器契约 */
export class SourceAdapter {
  /** @type {string} */
  site = 'unknown'
  /** 仅支持搜索书名 @param {string} _title @returns {Promise<Array<object>>} */
  async search(_title) {
    throw new Error('not implemented')
  }
  /** @param {string} _bookId @returns {Promise<object|null>} */
  async detail(_bookId) {
    throw new Error('not implemented')
  }
  /** @param {string} _bookId @param {number} _page @returns {Promise<Array<object>>} */
  async reviews(_bookId, _page = 1) {
    throw new Error('not implemented')
  }
}

/** @type {Map<string, SourceAdapter>} */
const registry = new Map()

/** @param {SourceAdapter} adapter */
export const registerSource = (adapter) => {
  registry.set(adapter.site, adapter)
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  })

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,PROPFIND,PROPPATCH,MKCOL,COPY,MOVE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,depth,destination,overwrite',
  'access-control-expose-headers': 'dav,content-length',
}

const SOURCES = new Set(['qidian', 'fanqie', 'yousuu', 'lkong'])

/* ---------------- 评分源：豆瓣 + 微信读书（都只取分数，不取评论） ---------------- */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const normTitle = (s) =>
  String(s ?? '')
    .replace(/[《》「」『』]/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\u3000·・\-—_、,，。.!！?？:：'"“”]/g, '')
    .toLowerCase()

/** 「同人」「外传」「第X部」这类是衍生作，名字里包含原名也不能当同一本 */
const DERIVED = /同人|外传|续作|后传|前传|番外|山寨|改写|番外篇|第[一二三四五六七八九十\d]+部/

/** 书名后面跟的是分卷/副标题（剑来1：xxx、全20册、全集），不是另一本书 */
const isVolumeLike = (rest) => {
  const t = String(rest ?? '').trim()
  if (!t) return true
  if (t.length > 18) return false
  return /^[0-9０-９一二三四五六七八九十百千]|^第|^[上中下]|^全|^[（(]|^[:：]/.test(t)
}

/**
 * 候选书与目标书的相似度。0 表示不是同一本。
 * 分三档而不是只判「包含」：同名分卷（剑来1：少年起微末）要打折但不丢弃，
 * 精确同名要赢过所有分卷，衍生作直接判死。
 */
const scoreOf = (candTitle, candAuthor, title, author) => {
  const a = normTitle(candTitle)
  const b = normTitle(title)
  if (!a || !b) return 0
  let s = 0
  if (a === b) s = 100
  else if (a.startsWith(b)) s = isVolumeLike(a.slice(b.length)) ? 85 : 65
  else if (a.includes(b)) s = DERIVED.test(String(candTitle)) ? 25 : 65
  else if (b.includes(a)) s = 50
  else return 0
  if (author && author !== '佚名' && candAuthor) {
    const na = normTitle(author)
    const ca = normTitle(candAuthor)
    if (ca && (ca.includes(na) || na.includes(ca))) s += 25
  }
  return s
}

/** 从 HTML 里抠出 `window.__DATA__ = {...}` 的那个对象（字符串里的大括号不能算） */
const sliceJsonObject = (text, from) => {
  const start = text.indexOf('{', from)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 豆瓣搜索页：返回候选数组；页面结构认不出来时返回 null，交给老接口兜底 */
const PUBLISHER_RE = /出版社|出版公司|出版集团|出版|书局|书店|^\d{4}(-\d{1,2})?$|^¥|^\d+(\.\d+)?元$|ISBN/i

/** 从豆瓣的 abstract 斜杠串里挑作者：第一段通常就是，但不是每个版本都这样 */
const authorFromAbstract = (abstract) => {
  const parts = String(abstract ?? '').split('/').map((x) => x.trim()).filter(Boolean)
  const hit = parts.find((x) => !PUBLISHER_RE.test(x))
  // 豆瓣常写成「原著 国王陛下」「[美] 某某 著」，前缀对读者没意义
  return (hit ?? '')
    .replace(/^\[[^\]]{1,6}\]\s*/, '')
    .replace(/^(原著|著者|作者|编著|主编|译者|著|等)[\s:：]*/, '')
    .trim()
}

const doubanFromSearchPage = async (title, author) => {
  const res = await fetch(
    `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(title)}`,
    {
      headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!res.ok) throw new Error(`search ${res.status}`)
  const html = await res.text()
  const at = html.indexOf('window.__DATA__')
  if (at < 0) return null
  const data = sliceJsonObject(html, at)
  if (!data || !Array.isArray(data.items)) return null

  const items = data.items.filter(
    (x) => x?.tpl_name === 'search_subject' && x.rating && Number(x.rating.value) > 0,
  )
  const out = []
  for (const it of items) {
    const s = scoreOf(it.title, '', title, author)
    if (s < 60) continue
    // abstract 是「作者 / 出版社 / 出版年 / 价格」这种斜杠串。有的版本把出版社排第一，
    // 所以跳过像出版社/年份/价格/ISBN 的段落，取第一个像人名的
    const authorName = authorFromAbstract(it.abstract)
    out.push({
      site: 'douban',
      siteName: '豆瓣',
      bookId: it.id != null ? String(it.id) : undefined,
      title: it.title ?? title,
      author: authorName,
      coverUrl: it.cover_url || undefined,
      rating: Number(it.rating.value),
      ratingCount: it.rating.count ?? undefined,
      url: it.url || (it.id ? `https://book.douban.com/subject/${it.id}/` : undefined),
      score: s,
      partial: s < 100,
    })
  }
  // 同一本书的不同版本会重复出现，按评分人数留前 4 条
  out.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
  const seen = new Set()
  return out.filter((x) => {
    const key = normTitle(x.title)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 4)
}

/** 豆瓣老路径：subject_suggest 找 id → rexxar 取 rating（搜索结果页结构变了时兜底） */
const doubanFromSuggest = async (title, author) => {
  const sRes = await fetch(
    `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`,
    {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    },
  )
  if (!sRes.ok) throw new Error(`suggest ${sRes.status}`)
  const items = await sRes.json()
  if (!Array.isArray(items)) return []

  let best = null
  let bestScore = 0
  for (const it of items) {
    if (!it?.id || (it.type && it.type !== 'b')) continue
    const s = scoreOf(it.title, it.author_name, title, author)
    if (s > bestScore) {
      bestScore = s
      best = it
    }
  }
  if (!best || bestScore < 60) return []

  const dRes = await fetch(
    `https://m.douban.com/rexxar/api/v2/book/${best.id}?ck=&for_mobile=1`,
    {
      headers: { 'user-agent': UA, referer: 'https://m.douban.com/' },
      signal: AbortSignal.timeout(9000),
    },
  )
  if (!dRes.ok) throw new Error(`detail ${dRes.status}`)
  const detail = await dRes.json()
  const value = detail?.rating?.value
  if (!value || value <= 0) return []
  return [
    {
      site: 'douban',
      siteName: '豆瓣',
      bookId: String(best.id),
      title: best.title ?? title,
      author: best.author_name ?? '',
      coverUrl: best.pic || undefined,
      rating: Number(value),
      ratingCount: detail?.rating?.count,
      url: `https://book.douban.com/subject/${best.id}/`,
      score: bestScore,
      partial: bestScore < 100,
    },
  ]
}

const doubanCandidates = async (title, author) => {
  try {
    const list = await doubanFromSearchPage(title, author)
    if (list && list.length) return list
    if (list && list.length === 0) return []
  } catch {
    /* 落到老路径 */
  }
  return doubanFromSuggest(title, author)
}

/**
 * 微信读书：搜索接口直接返回 `newRating`（推荐值 0–1000）和评分人数。
 * 实测 12/12 命中，包括豆瓣查不到的连载网文（剑来 86.1%、秘术纪元 71.7%）。
 * 不需要登录、不需要 Cookie；返回带 author，可交叉核对防串书。
 */
const wereadCandidates = async (title, author) => {
  const res = await fetch(
    `https://weread.qq.com/web/search/global?keyword=${encodeURIComponent(title)}`,
    {
      headers: { 'user-agent': UA, accept: 'application/json', referer: 'https://weread.qq.com/' },
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!res.ok) throw new Error(`weread ${res.status}`)
  const data = await res.json()
  const list = (data?.books ?? []).map((b) => b?.bookInfo).filter((b) => b && b.newRating > 0)

  const out = []
  for (const b of list) {
    const s = scoreOf(b.title, b.author, title, author)
    if (s < 60) continue
    // 5 人以下的推荐值没有参考意义，宁可留空
    if (Number(b.newRatingCount ?? 0) < 5) continue
    const raw = Number(b.newRating)
    out.push({
      site: 'weread',
      siteName: '微信读书',
      bookId: b.bookId ? String(b.bookId) : undefined,
      title: b.title ?? title,
      author: b.author ?? '',
      coverUrl: b.cover || undefined,
      rating: Math.round(raw / 10) / 10,
      ratingCount: b.newRatingCount ?? undefined,
      percent: Math.round(raw) / 10,
      url: b.bookId ? `https://weread.qq.com/web/bookDetail/${b.bookId}` : undefined,
      score: s,
      partial: s < 100,
    })
  }
  out.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
  const seen = new Set()
  return out.filter((x) => {
    const key = normTitle(x.title)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 4)
}

/** 同一个书名在不同源之间可能有大小写/标点差异，去重按归一化书名 */
const dedupeAcross = (items) => {
  const seen = new Set()
  return items.filter((x) => {
    const key = `${x.site}:${normTitle(x.title)}:${x.rating}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 多源候选列表：按评分人数从多到少。
 *
 * 这是「关联」面板的数据源，也是导入后自动关联的依据。
 * 用户定的规则是「评分人数最多的站」——人数多代表样本大、更接近大众判断，
 * 比按站点固定优先级更合理（《活着》豆瓣 93 万 > 微信读书 21 万，用豆瓣；
 * 《剑来》微信读书 15.5 万 > 豆瓣分卷 2463，用微信读书）。
 */
const sourceCandidates = async (title, author) => {
  const notes = []
  const [db, wr] = await Promise.allSettled([
    doubanCandidates(title, author),
    wereadCandidates(title, author),
  ])
  const items = []
  if (db.status === 'fulfilled') items.push(...db.value)
  else notes.push(`豆瓣：${db.reason instanceof Error ? db.reason.message : String(db.reason)}`)
  if (wr.status === 'fulfilled') items.push(...wr.value)
  else notes.push(`微信读书：${wr.reason instanceof Error ? wr.reason.message : String(wr.reason)}`)
  items.sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
  // 有两条以上「同书/分卷」时，把只是名字相近的（《活着为了讲述》）挤掉，
  // 否则候选面板里会混进完全无关的书；只有弱匹配时才退回去用它们
  const strong = items.filter((x) => x.score >= 85)
  const pool = strong.length >= 2 ? strong : items
  return { items: dedupeAcross(pool).slice(0, 6), notes }
}

/** 兼容旧的单值接口：从候选里挑评分人数最多的那条 */
const bestOf = async (title, author, only) => {
  const { items, notes } = await sourceCandidates(title, author)
  const pool = only ? items.filter((x) => x.site === only) : items
  return { hit: pool[0] ?? null, notes }
}


export const handler = async (request) => {
  const url = new URL(request.url)
  const { pathname } = url

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  // 豆瓣封面有防盗链：不带 `Referer: book.douban.com` 直接 418。
  // 浏览器里 img 标签改不了 Referer，所以统一走中继取图。
  if (pathname === '/api/meta/cover') {
    const target = url.searchParams.get('url') ?? ''
    if (!/^https:\/\/([a-z0-9-]+\.)*(doubanio\.com|douban\.com)\//i.test(target)) {
      return json({ error: 'host not allowed' }, 400)
    }
    try {
      const r = await fetch(target, {
        headers: { 'user-agent': UA, referer: 'https://book.douban.com/' },
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) return json({ error: `image ${r.status}` }, 502)
      return new Response(await r.arrayBuffer(), {
        headers: {
          'content-type': r.headers.get('content-type') ?? 'image/jpeg',
          'cache-control': 'public, max-age=604800',
          'access-control-allow-origin': '*',
        },
      })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  if (pathname === '/api/health') {
    return json({
      ok: true,
      sources: [...SOURCES].map((s) => ({ site: s, ready: registry.has(s) })),
    })
  }

  // 评分查询：
  //   /api/meta/sources?title=&author=  多源候选（关联面板用，按评分人数降序）
  //   /api/meta/rating?title=&author=   单条最佳（兼容旧版前端）
  //   /api/meta/douban?title=&author=   只查豆瓣
  //   /api/meta/weread?title=&author=   只查微信读书
  const metaPath = pathname.match(/^\/api\/meta\/(sources|rating|douban|weread)$/)
  if (metaPath) {
    const title = url.searchParams.get('title') ?? ''
    const author = url.searchParams.get('author') ?? ''
    if (!title.trim()) return json({ ok: false, reason: 'title required' }, 400)
    const which = metaPath[1]
    try {
      if (which === 'sources') {
        const { items, notes } = await sourceCandidates(title, author)
        return json({ ok: true, items, notes })
      }
      const only = which === 'douban' || which === 'weread' ? which : undefined
      const { hit, notes } = await bestOf(title, author, only)
      if (hit) return json({ ok: true, ...hit })
      return json(
        { ok: false, reason: notes.join('；') || `${only === 'douban' ? '豆瓣' : only === 'weread' ? '微信读书' : '两个源'}都没收录这本` },
        only ? 200 : 200,
      )
    } catch (e) {
      return json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // 网文站搜索：/api/source/:site/search?title=xxx
  const m = pathname.match(/^\/api\/source\/([a-z]+)\/(search|detail|reviews)$/)
  if (m) {
    const [, site, action] = m
    if (!SOURCES.has(site)) return json({ error: 'unknown site' }, 404)
    const adapter = registry.get(site)
    if (!adapter) return json({ error: 'source not available', site }, 503)
    try {
      if (action === 'search') {
        const title = url.searchParams.get('title') ?? ''
        if (!title) return json({ error: 'title required' }, 400)
        return json({ site, items: await adapter.search(title) })
      }
      const bookId = url.searchParams.get('id') ?? ''
      if (!bookId) return json({ error: 'id required' }, 400)
      if (action === 'detail') return json({ site, item: await adapter.detail(bookId) })
      const page = Number(url.searchParams.get('page') ?? '1')
      return json({ site, items: await adapter.reviews(bookId, page) })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // WebDAV 反代：/api/dav/<base64 目标路径>，需要前端带 Authorization 透传
  // 说明：坚果云 WebDAV 没有 CORS 头，浏览器无法直连，只能由中继转发。
  if (pathname.startsWith('/api/dav/')) {
    const target = url.searchParams.get('to')
    if (!target) return json({ error: 'missing ?to=' }, 400)
    // 只放通白名单里的主机，避免变成任何人可用的开放代理。
    // 默认只允许坚果云；要接别的 WebDAV（Nextcloud、群晖等）用环境变量扩：
    //   DAV_ALLOW=dav.jianguoyun.com,cloud.example.com
    const allow = new Set(
      (process.env.DAV_ALLOW ?? 'dav.jianguoyun.com')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    let host = ''
    try {
      host = new URL(target).hostname
    } catch {
      return json({ error: 'bad target' }, 400)
    }
    if (!target.startsWith('https://') || !allow.has(host)) {
      return json({ error: 'target not allowed', host }, 403)
    }
    const headers = new Headers()
    for (const k of ['authorization', 'depth', 'destination', 'overwrite', 'content-type']) {
      const v = request.headers.get(k)
      if (v) headers.set(k, v)
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.body
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      duplex: 'half',
    })
    const out = new Headers(CORS)
    const ct = upstream.headers.get('content-type')
    if (ct) out.set('content-type', ct)
    const len = upstream.headers.get('content-length')
    if (len) out.set('content-length', len)
    return new Response(upstream.body, { status: upstream.status, headers: out })
  }

  return json({ error: 'not found' }, 404)
}
