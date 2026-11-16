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
  else if (a.startsWith(b)) s = 85
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

/**
 * 豆瓣主路径：搜索结果页里 `window.__DATA__` 已带 rating，一次请求就够。
 * 返回 undefined 表示「这个页面结构没解析出来」，交给调用方回退到老的两步接口。
 * 返回 null 表示页面正常但确实没有评分数（比如总条目「评价人数不足」，只有分卷有分）。
 */
const doubanBySearchPage = async (title, author) => {
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
  if (at < 0) return undefined
  const data = sliceJsonObject(html, at)
  if (!data || !Array.isArray(data.items)) return undefined

  const items = data.items.filter(
    (x) => x?.tpl_name === 'search_subject' && x.rating && Number(x.rating.value) > 0,
  )
  let best = null
  let bestScore = 0
  let bestCount = -1
  for (const it of items) {
    const s = scoreOf(it.title, '', title, author)
    const cnt = Number(it.rating.count ?? 0)
    // 同分取评价人数多的：豆瓣会把同一本书的不同版本、不同分册都列出来
    if (s > bestScore || (s === bestScore && cnt > bestCount)) {
      bestScore = s
      bestCount = cnt
      best = it
    }
  }
  if (!best || bestScore < 60) return null
  return {
    source: 'douban',
    rating: Number(best.rating.value),
    count: best.rating.count ?? undefined,
    matchedTitle: best.title ?? title,
    url: best.url || (best.id ? `https://book.douban.com/subject/${best.id}/` : undefined),
  }
}

/** 豆瓣老路径：subject_suggest 找 id → rexxar 取 rating（搜索结果页结构变了时兜底） */
const doubanBySuggest = async (title, author) => {
  const sRes = await fetch(
    `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`,
    {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    },
  )
  if (!sRes.ok) throw new Error(`suggest ${sRes.status}`)
  const items = await sRes.json()
  if (!Array.isArray(items)) return null

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
  if (!best || bestScore < 60) return null

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
  if (!value || value <= 0) return null
  return {
    source: 'douban',
    rating: Number(value),
    count: detail?.rating?.count,
    doubanId: String(best.id),
    matchedTitle: best.title ?? title,
    url: `https://book.douban.com/subject/${best.id}/`,
  }
}

/** 豆瓣：先搜索页，结构对不上才回退老接口 */
const doubanRating = async (title, author) => {
  try {
    const hit = await doubanBySearchPage(title, author)
    if (hit !== undefined) return hit
  } catch {
    /* 落到老路径 */
  }
  return doubanBySuggest(title, author)
}

/**
 * 微信读书：搜索接口直接返回 `newRating`（推荐值，0–1000 即 0–100%）和评价人数。
 * 实测 12/12 命中，包括豆瓣查不到的连载网文（剑来 86.1%、秘术纪元 71.7%）。
 * 接口不需要登录、不需要 Cookie，只按书名搜；返回带 author，可交叉核对防串书。
 */
const wereadRating = async (title, author) => {
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

  let best = null
  let bestScore = 0
  let bestCount = -1
  for (const b of list) {
    const s = scoreOf(b.title, b.author, title, author)
    const cnt = Number(b.newRatingCount ?? 0)
    if (s > bestScore || (s === bestScore && cnt > bestCount)) {
      bestScore = s
      bestCount = cnt
      best = b
    }
  }
  if (!best || bestScore < 60) return null
  // 5 人以下的推荐值没有参考意义，宁可留空
  if (Number(best.newRatingCount ?? 0) < 5) return null

  const percent = Math.round(Number(best.newRating)) / 10
  return {
    source: 'weread',
    // 推荐值本质是百分比，除以 100 落到和豆瓣一样的十分制，两种分数才能同屏排序
    rating: Math.round(Number(best.newRating) / 10) / 10,
    count: best.newRatingCount ?? undefined,
    percent,
    matchedTitle: best.title ?? title,
    url: best.bookId ? `https://weread.qq.com/web/bookDetail/${best.bookId}` : undefined,
  }
}


export const handler = async (request) => {
  const url = new URL(request.url)
  const { pathname } = url

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (pathname === '/api/health') {
    return json({
      ok: true,
      sources: [...SOURCES].map((s) => ({ site: s, ready: registry.has(s) })),
    })
  }

  // 评分查询：
  //   /api/meta/rating?title=&author=   双源（豆瓣优先，查不到再问微信读书）——前端默认用这个
  //   /api/meta/douban?title=&author=   只查豆瓣
  //   /api/meta/weread?title=&author=   只查微信读书
  const metaPath = pathname.match(/^\/api\/meta\/(rating|douban|weread)$/)
  if (metaPath) {
    const title = url.searchParams.get('title') ?? ''
    const author = url.searchParams.get('author') ?? ''
    if (!title.trim()) return json({ ok: false, reason: 'title required' }, 400)
    const which = metaPath[1]
    const notes = []
    try {
      let dbHit = null
      if (which !== 'weread') {
        try {
          dbHit = await doubanRating(title, author)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // 单源查询时，豆瓣出错要如实回报，不要伪装成「没收录」
          if (which === 'douban') return json({ ok: false, reason: `豆瓣：${msg}` }, 502)
          notes.push(`豆瓣：${msg}`)
        }
        if (dbHit && (which === 'douban' || normTitle(dbHit.matchedTitle) === normTitle(title))) {
          // 豆瓣精确命中同名书，直接用——出版物的豆瓣评分区分度比推荐值好
          return json({ ok: true, ...dbHit })
        }
        if (!dbHit) notes.push('豆瓣没收录这本')
        if (which === 'douban') return json({ ok: false, reason: notes[0] || '豆瓣没收录这本' })
      }

      const wrHit = await wereadRating(title, author)
      if (wrHit) {
        // 豆瓣只搜到某个分卷（《雪中悍刀行 1 : 西北有雏凤》7.5）时不能用它代表全书，
        // 微信读书的《雪中悍刀行（全20册）》9.1 才是读者对这套书的整体评价
        return json({ ok: true, ...wrHit })
      }
      // 微信读书也没有，退而用豆瓣的分卷/近似条目，但要标明是近似匹配
      if (dbHit) return json({ ok: true, ...dbHit, partial: true })
      notes.push('微信读书也没查到')
      return json({ ok: false, reason: notes.join('；') })
    } catch (e) {
      return json(
        { ok: false, reason: e instanceof Error ? e.message : String(e) },
        502,
      )
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
