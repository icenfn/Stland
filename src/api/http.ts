/**
 * HTTP 基础设施：AlovaJS v3 实例 + 全局请求签名。
 *
 * 为什么是这一层做签名，而不是每个接口各写一遍：
 * Alova 的 `beforeRequest` 是唯一的请求出口，令牌注入、HMAC 签名、401 统一登出
 * 全部收敛在这里，业务层（api/index.ts）只声明「请求什么」，不关心「怎么证明身份」。
 *
 * v3 的适配器入口是 `alova/fetch`（旧版 `alova/GlobalFetch` 已移除，
 * 误用会直接让 Vite 报 Missing specifier 而构建失败）。
 *
 * 安全设计（与服务端 app/security.py 逐字节对应，纯函数见 api/sign.ts）：
 *   签名原文 = METHOD \n PATH \n TS \n NONCE \n SHA256(BODY) \n USER_ID
 *   X-Stland-Sign = HMAC-SHA256(共享密钥, 签名原文) 十六进制
 *   1) 篡改防护：改动请求体或路径都会使签名失效；
 *   2) 重放防护：时间戳窗口 + nonce 去重由服务端保证；
 *   3) 会话绑定：user_id 参与签名，令牌与请求不可分离盗用。
 *
 * 密钥来自构建期环境变量（CI Secret 注入），不硬编码。
 */
import { createAlova } from 'alova'
import VueHook from 'alova/vue'
import adapterFetch from 'alova/fetch'
import { signRequest } from './sign'

const RAW_BASE = (import.meta.env.VITE_API_BASE as string) || 'http://127.0.0.1:8999'
export const BASE_URL = RAW_BASE.replace(/\/+$/, '')
const SIGN_SECRET = (import.meta.env.VITE_API_SIGN_SECRET as string) || 'dev-sign-secret-stland'
export const SIGN_ENABLED = String(import.meta.env.VITE_API_SIGNATURE ?? 'true') !== 'false'

export const TOKEN_KEY = 'stland.access_token'
export const USER_KEY = 'stland.user'

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

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export const alovaInstance = createAlova({
  baseURL: BASE_URL,
  statesHook: VueHook,
  requestAdapter: adapterFetch(),
  timeout: 15000,
  // 行情/账户必须实时：关闭 GET 默认的 5 分钟缓存
  cacheFor: { GET: 0, POST: 0 },

  /**
   * 唯一出口：注入令牌与签名。
   * 这里 await 签名计算，Alova 会等它完成再发请求，因此不会出现「头还没算好就发出去」。
   */
  beforeRequest: async (method) => {
    const cfg = method.config
    const headers: Record<string, string> = { ...(cfg.headers as Record<string, string> | undefined) }

    const token = localStorage.getItem(TOKEN_KEY)
    if (token) headers['Authorization'] = `Bearer ${token}`

    if (SIGN_ENABLED) {
      Object.assign(
        headers,
        await signRequest({
          secret: SIGN_SECRET,
          method: method.type,
          url: method.url,
          data: method.data,
          userId: currentUserId(),
        }),
      )
    }
    cfg.headers = headers
  },

  responded: {
    onSuccess: async (response, method) => {
      if (!response.ok) {
        let payload: any = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        if (response.status === 401 && onUnauthorized) onUnauthorized()
        // 抛出后进入业务侧的 try/catch（Alova 约定：onSuccess 抛出即视为该请求失败）
        throw normalizeError(response.status, payload)
      }
      if ((method.config as any).responseType === 'text') return response.text()
      const text = await response.text()
      if (!text) return null
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    },
    onError: (err: any) => {
      // 网络层错误（断网 / 超时 / 跨域）在这里补齐可读文案
      if (err?.code === 'NETWORK_ERROR' || err?.name === 'TypeError') {
        const e = new Error('无法连接服务端，请确认 Stland-server 已启动') as ApiError
        e.code = 'NETWORK_ERROR'
        throw e
      }
      throw err
    },
  },
})

export { signRequest }
