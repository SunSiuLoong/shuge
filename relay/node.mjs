import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { handler } from './core.mjs'

const PORT = Number(process.env.PORT || 8787)

/** node:http <-> Web 标准 Request/Response 的最小适配，不引框架 */
const toRequest = async (req) => {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url}`
  const method = req.method ?? 'GET'
  const init = { method, headers: new Headers() }
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => init.headers.append(k, x))
    else if (v) init.headers.set(k, v)
  }
  if (!['GET', 'HEAD'].includes(method)) {
    init.body = Readable.toWeb(req)
    init.duplex = 'half'
  }
  return new Request(url, init)
}

createServer(async (req, res) => {
  try {
    const response = await handler(await toRequest(req))
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) {
      for await (const chunk of response.body) res.write(chunk)
    }
    res.end()
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(e))
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`relay listening on http://127.0.0.1:${PORT}`)
  console.log('  GET /api/health')
  console.log('  GET /api/source/<site>/search?title=')
  console.log('  ANY /api/dav/?to=<urlencoded 坚果云 dav 绝对地址>')
})
