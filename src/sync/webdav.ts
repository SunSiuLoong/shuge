import { reactive, watch } from 'vue'
import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * WebDAV 配置与传输层。
 *
 * 为什么不能前端直连：坚果云（以及多数 WebDAV 服务）不返回 CORS 头，
 * 浏览器里 fetch 会在预检阶段被拦，PROPFIND 更是连预检都过不去。
 * 所以只有两条路：
 *   1. 在 APK 里走 Capacitor 原生 HTTP（不受同源策略约束）；
 *   2. 浏览器里走 relay 反代（`npm run relay`，已在 CORS 白名单里放行 DAV 方法）。
 * 两条都不通时明确报错，不静默失败。
 */
export interface DavConfig {
  url: string
  username: string
  password: string
  dir: string
  /** 可选：PWA / 浏览器下的反代地址，例如 http://127.0.0.1:8787 */
  relay: string
  /** 启动时自动同步 */
  auto: boolean
  lastSyncAt: number
  lastResult: string
}

const KEY = 'shuge.webdav.v1'

const DEFAULTS: DavConfig = {
  url: 'https://dav.jianguoyun.com/dav/',
  username: '',
  password: '',
  dir: '书阁',
  relay: '',
  auto: false,
  lastSyncAt: 0,
  lastResult: '',
}

const load = (): DavConfig => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DavConfig>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const dav = reactive<DavConfig>(load())

watch(
  dav,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      /* 存储被禁用时静默降级 */
    }
  },
  { deep: true },
)

const trimSlash = (s: string): string => s.replace(/\/+$/, '')

export const davConfigured = (): boolean =>
  Boolean(dav.url.trim() && dav.username.trim() && dav.password.trim())

/** 远端目录的 URL（已逐段编码，中文目录名可用） */
const dirUrl = (): string =>
  `${trimSlash(dav.url)}/${dav.dir
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/')}`

export const dataUrl = (): string => `${dirUrl()}/shuge.json`

/** Basic 认证头，按 UTF-8 编码（btoa 只接受 latin1） */
const authHeader = (): string => {
  const raw = new TextEncoder().encode(`${dav.username}:${dav.password}`)
  let bin = ''
  raw.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return `Basic ${btoa(bin)}`
}

export interface DavResponse {
  status: number
  text: string
}

export class DavError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'DavError'
    this.status = status
  }
}

const explain = (status: number, target: string): string => {
  if (status === 401) return '认证失败：账号或应用密码不对（坚果云要用「应用密码」，不是登录密码）'
  if (status === 403) return '没有权限：检查目录是否可写'
  if (status === 404) return `远端不存在：${target}`
  if (status === 405) return '服务器不接受该方法'
  if (status === 507) return '云盘空间不足'
  if (status >= 500) return `服务器错误 ${status}`
  return `请求失败 ${status}`
}

const isNative = (): boolean => Capacitor.isNativePlatform()

/** 走原生 HTTP 或 relay 发一个 DAV 请求 */
export const davRequest = async (
  method: string,
  target: string,
  body?: string,
  depth?: string,
): Promise<DavResponse> => {
  const headers: Record<string, string> = { authorization: authHeader() }
  if (body !== undefined) headers['content-type'] = 'application/json; charset=utf-8'
  if (depth) headers.depth = depth

  if (isNative()) {
    const res = await CapacitorHttp.request({
      url: target,
      method,
      headers,
      data: body ?? undefined,
      responseType: 'text',
      connectTimeout: 15000,
      readTimeout: 20000,
    })
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
    return { status: res.status, text }
  }

  const relay = dav.relay.trim()
  if (!relay) {
    throw new DavError(
      '浏览器里直连 WebDAV 会被 CORS 拦。装成 App 用，或在本页填一个中继地址（本机跑 npm run relay 后填 http://127.0.0.1:8787）。',
    )
  }
  const res = await fetch(`${trimSlash(relay)}/api/dav/?to=${encodeURIComponent(target)}`, {
    method,
    headers,
    body,
  })
  return { status: res.status, text: await res.text() }
}

/** 确保远端目录存在（已存在时服务器返回 405/301，都算成功） */
export const ensureDir = async (): Promise<void> => {
  const res = await davRequest('MKCOL', dirUrl())
  if ([200, 201, 204, 301, 405, 409].includes(res.status)) return
  throw new DavError(explain(res.status, dirUrl()), res.status)
}

export const readRemote = async (): Promise<string | null> => {
  const res = await davRequest('GET', dataUrl())
  if (res.status === 404) return null
  if (res.status >= 200 && res.status < 300) return res.text
  throw new DavError(explain(res.status, dataUrl()), res.status)
}

export const writeRemote = async (content: string): Promise<void> => {
  const res = await davRequest('PUT', dataUrl(), content)
  if (res.status >= 200 && res.status < 300) return
  throw new DavError(explain(res.status, dataUrl()), res.status)
}

/** 测试连接：对目录做一次 PROPFIND，看清是「通」「没目录」还是「认证错」 */
export const testConnection = async (): Promise<string> => {
  if (!davConfigured()) throw new DavError('先把服务器地址、账号、应用密码填全')
  const res = await davRequest('PROPFIND', dirUrl(), undefined, '0')
  if (res.status === 207 || res.status === 200) return '连接正常，目录可访问'
  if (res.status === 404 || res.status === 409) return '连上了，但远端目录还不存在；首次同步会自动创建'
  throw new DavError(explain(res.status, dirUrl()), res.status)
}
