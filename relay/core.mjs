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
