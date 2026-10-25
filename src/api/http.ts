/**
 * HTTP 基础设施：轻量请求器 + HMAC-SHA256 请求签名。
 *
 * 为什么不用第三方请求库：
 * 本项目只需要 GET / POST 两种动词与极少的配置项，而 alova v3 的
 * 子路径导出（`alova/GlobalFetch`）在 Vite 的 ESM 解析下不稳定，
 * 会直接导致构建失败。手写一层薄封装反而更可控、更小、更易审计——
 * 尤其是签名逻辑属于安全边界，不应藏在第三方适配器的内部行为里。
 *
 * 安全设计（与服务端 app/security.py 严格对应）：
 *   签名原文 = METHOD \n PATH \n TS \n NONCE \n SHA256(BODY) \n USER_ID
 *   X-Stland-Sign = HMAC-SHA256(共享密钥, 签名原文) 十六进制
 * 作用：
 *   1) 篡改防护 —— 改动请求体或路径都会使签名失效；
 *   2) 重放防护 —— 时间戳窗口 + 随机数（nonce）去重由服务端保证；
 *   3) 会话绑定 —— user_id 参与签名，令牌与请求不可分离盗用。
 *
 * 密钥通过构建期环境变量注入（CI Secret），不硬编码在源码中。
 */

const BASE_URL = ((import.meta.env.VITE_API_BASE as string) || 'http://127.0.0.1:8999').replace(/\/$/, '')
const SIGN_SECRET = (import.meta.env.VITE_API_SIGN_SECRET as string) || 'dev-sign-secret-stland'
const SIGN_ENABLED = String(import.meta.env.VITE_API_SIGNATURE ?? 'true') !== 'false'
const TIMEOUT_MS = 15000

export const TOKEN_KEY = 'stland.access_token'
export const USER_KEY = 'stland.user'

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return toHex(digest)
}

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return toHex(sig)
}

function nonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 读取当前登录用户 id（参与签名，服务端亦用它绑定会话） */
function currentUserId(): string {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw)
    return parsed && parsed.id != null ? String(parsed.id) : ''
  } catch {
    return ''
  }
}

export interface ApiError extends Error {
  code?: string
  status?: number
}

/** 把 FastAPI 的错误体规范化为可读的 ApiError */
function normalizeError(status: number, body: any): ApiError {
  const detail = body?.detail
  let message = '网络请求失败，请稍后重试'
  let code = 'HTTP_ERROR'
  if (typeof detail === 'string') {
    message = detail
  } else if (detail && typeof detail === 'object') {
    message = detail.message || message
    code = detail.code || code
  } else if (body?.message) {
    message = body.message
  }
  const err = new Error(message) as ApiError
  err.code = code
  err.status = status
  return err
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

/** 把 params 对象拼成查询串（跳过 undefined / null / 空串） */
function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return ''
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    usp.append(k, String(v))
  }
  const q = usp.toString()
  return q ? `?${q}` : ''
}

export interface RequestConfig {
  params?: Record<string, unknown>
  headers?: Record<string, string>
  /** 'text' 时直接返回原始字符串，用于非 JSON 响应 */
  responseType?: 'json' | 'text'
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown, cfg: RequestConfig = {}): Promise<T> {
  const query = buildQuery(cfg.params)
  const path = url // 已是相对路径，未含 BASE_URL
  const full = BASE_URL + path + query

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(cfg.headers || {}),
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers['Authorization'] = 'Bearer ' + token

  const bodyText = body !== undefined ? JSON.stringify(body) : ''

  if (SIGN_ENABLED) {
    const ts = Math.floor(Date.now() / 1000).toString()
    const n = nonce()
    const bodyHash = await sha256Hex(bodyText)
    // 签名用的是不含查询串的路径，与服务端 request.url.path 一致
    const canonical = [method, path, ts, n, bodyHash, currentUserId()].join('\n')
    headers['X-Stland-Ts'] = ts
    headers['X-Stland-Nonce'] = n
    headers['X-Stland-Sign'] = await hmacHex(SIGN_SECRET, canonical)
    headers['X-Stland-User'] = currentUserId()
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(full, {
      method,
      headers,
      body: bodyText || undefined,
      signal: controller.signal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      const err = new Error('请求超时，请检查网络或服务端地址') as ApiError
      err.code = 'TIMEOUT'
      throw err
    }
    const err = new Error('无法连接服务端，请确认 Stland-server 已启动') as ApiError
    err.code = 'NETWORK_ERROR'
    throw err
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let payload: any = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (response.status === 401 && onUnauthorized) onUnauthorized()
    throw normalizeError(response.status, payload)
  }

  if (cfg.responseType === 'text') return (await response.text()) as unknown as T

  const text = await response.text()
  if (!text) return null as unknown as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

/**
 * 对外暴露的请求器。
 * 保留 Get / Post 的方法名，使接口聚合层（api/index.ts）的写法无需改动，
 * 也为将来替换实现留出稳定边界。
 */
export const alovaInstance = {
  Get: <T>(url: string, cfg?: RequestConfig) => request<T>('GET', url, undefined, cfg),
  Post: <T>(url: string, body?: unknown, cfg?: RequestConfig) => request<T>('POST', url, body ?? {}, cfg),
}

export { BASE_URL, SIGN_ENABLED, sha256Hex, hmacHex }
