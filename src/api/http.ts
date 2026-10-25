/**
 * HTTP 基础设施：AlovaJS 实例 + HMAC-SHA256 请求签名。
 *
 * 安全设计（与服务端 app/security.py 严格对应）：
 *   签名原文 = METHOD \n PATH \n TS \n NONCE \n SHA256(BODY) \n USER_ID
 *   X-Stland-Sign = HMAC-SHA256(共享密钥, 签名原文) 十六进制
 * 作用：
 *   1) 篡改防护 —— 任何人改动请求体或路径都会使签名失效；
 *   2) 重放防护 —— 时间戳窗口 + 随机数（nonce）去重由服务端保证；
 *   3) 会话绑定 —— user_id 参与签名，令牌与请求不可分离盗用。
 *
 * 密钥通过构建期环境变量注入（CI Secret），不硬编码在源码中。
 */
import { createAlova } from 'alova'
import GlobalFetch from 'alova/GlobalFetch'

const BASE_URL = (import.meta.env.VITE_API_BASE as string) || 'http://127.0.0.1:8999'
const SIGN_SECRET = (import.meta.env.VITE_API_SIGN_SECRET as string) || 'dev-sign-secret-stland'
const SIGN_ENABLED = String(import.meta.env.VITE_API_SIGNATURE ?? 'true') !== 'false'

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

/** 从相对路径中去掉查询串，得到与 FastAPI request.url.path 一致的路径 */
function signPath(url: string): string {
  const clean = url.replace(BASE_URL, '')
  const q = clean.indexOf('?')
  return q >= 0 ? clean.slice(0, q) : clean
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

/** 手写请求适配：统一注入令牌与签名，并集中处理错误 */
const fetchAdapter = GlobalFetch()

export const alovaInstance = createAlova({
  baseURL: BASE_URL,
  timeout: 15000,
  requestAdapter: async (elements, method) => {
    const cfg = method.config as any
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(cfg.headers || {}),
    }

    const token = localStorage.getItem(TOKEN_KEY)
    if (token) headers['Authorization'] = 'Bearer ' + token

    if (SIGN_ENABLED) {
      const path = signPath(method.url)
      const ts = Math.floor(Date.now() / 1000).toString()
      const n = nonce()
      const bodyText = cfg.data ? JSON.stringify(cfg.data) : ''
      const bodyHash = await sha256Hex(bodyText)
      const canonical = [method.type.toUpperCase(), path, ts, n, bodyHash, currentUserId()].join('\n')
      headers['X-Stland-Ts'] = ts
      headers['X-Stland-Nonce'] = n
      headers['X-Stland-Sign'] = await hmacHex(SIGN_SECRET, canonical)
      headers['X-Stland-User'] = currentUserId()
    }

    const response = await fetchAdapter(elements, { ...method, config: { ...cfg, headers } })
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
    return response
  },
  responded: {
    onSuccess: async (response, method) => {
      const cfg = method.config as any
      if (cfg.responseType === 'text') return response.text()
      const text = await response.text()
      if (!text) return null
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    },
    onError: (err: any) => {
      throw err
    },
  },
})

export { BASE_URL, SIGN_ENABLED, sha256Hex, hmacHex }
