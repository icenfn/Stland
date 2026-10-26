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
 * 服务端地址与签名密钥统一来自 src/config（见 src/config/app.config.json），
 * 这样「这个包连的是哪台服务器」在代码里可追溯，而不是藏在构建命令行里。
 *
 * 安全设计（与服务端 app/security.py 逐字节对应，纯函数见 api/sign.ts）：
 *   签名原文 = METHOD \n PATH \n TS \n NONCE \n SHA256(BODY) \n USER_ID
 *   X-Stland-Sign = HMAC-SHA256(共享密钥, 签名原文) 十六进制
 *   1) 篡改防护：改动请求体或路径都会使签名失效；
 *   2) 重放防护：时间戳窗口 + nonce 去重由服务端保证；
 *   3) 会话绑定：user_id 参与签名，令牌与请求不可分离盗用。
 */
import { createAlova } from 'alova'
import VueHook from 'alova/vue'
import adapterFetch from 'alova/fetch'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { signRequest } from './sign'
import { apiConfig } from '@/config'

/**
 * 传输通道选择。
 *
 * 在 Tauri 里必须走原生 HTTP（Rust/reqwest），不能用 WebView 的 fetch：
 * 1) 混合内容 —— APK 内页面源是 http://tauri.localhost 或自定义 scheme，
 *    向 http://139.196.225.114:8999 发请求会被 Android WebView 拦截；
 * 2) CORS —— 服务端未对 WebView 源开放跨域头，预检直接失败；
 * 3) cookie/证书策略差异 —— 原生通道行为与服务端预期一致。
 *
 * 浏览器里（npm run dev 预览）没有 Tauri 运行时，退回全局 fetch。
 * 判定用 __TAURI_INTERNALS__：这是 Tauri 2 注入的稳定标记，
 * 比判断 userAgent 可靠（后者在有 WebView 调试代理时会误判）。
 */
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const transport = inTauri ? 'tauri' : 'browser'

export const BASE_URL = apiConfig.baseUrl
const SIGN_SECRET = apiConfig.signature.secret
export const SIGN_ENABLED = apiConfig.signature.enabled

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
  // customFetch 让 Alova 复用我们的通道选择，而不必 fork 整个适配器
  requestAdapter: adapterFetch(inTauri ? { customFetch: tauriFetch as unknown as typeof fetch } : {}),
  timeout: apiConfig.timeoutMs,
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
      // 网络层错误（断网 / 超时 / 明文 HTTP 被系统拦截）在这里补齐可读文案，
      // 并把当前服务器地址带进提示，避免用户面对一句没有上下文的「网络错误」。
      if (err?.code === 'NETWORK_ERROR' || err?.name === 'TypeError') {
        const e = new Error(
          `无法连接服务端（${BASE_URL}），请确认服务器已启动且网络可达`,
        ) as ApiError
        e.code = 'NETWORK_ERROR'
        throw e
      }
      throw err
    },
  },
})

export { signRequest }
