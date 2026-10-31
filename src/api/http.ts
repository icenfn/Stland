/**
 * HTTP 基础设施：AlovaJS v3 实例 + 全局请求签名。
 *
 * 两处关键设计：
 *
 * 1) 地址与超时不再写死在代码里，统一来自 src/config（app.config.json）。
 *    这样「连哪台服务器」是可审计、可 diff 的一行配置，而不是散落在
 *    import.meta.env 里的构建期常量。
 *
 * 2) 在 Tauri 壳里走原生 HTTP 通道（tauri-plugin-http），而不是直接用
 *    WebView 的 fetch。原因是 Android WebView 的两个硬限制：
 *      · 页面源是 https://tauri.localhost，向 http:// 发请求属于混合内容，被拦；
 *      · 即使放行，跨源请求还要过 CORS，而服务端未开 CORS 头。
 *    原生通道由 Rust 侧发请求，绕开这两条浏览器策略；
 *    明文 HTTP 的放行则单独由 network_security_config.xml 按主机白名单管控。
 *
 * 签名（与服务端 app/security.py 逐字节对应，纯函数见 api/sign.ts）：
 *   签名原文 = METHOD \
 PATH \
 TS \
 NONCE \
 SHA256(BODY) \
 USER_ID
 *   X-Stland-Sign = HMAC-SHA256(共享密钥, 签名原文) 十六进制
 */
import { createAlova } from 'alova'
import VueHook from 'alova/vue'
import adapterFetch from 'alova/fetch'
import { signRequest } from './sign'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { apiConfig } from '@/config'

export const BASE_URL = apiConfig.baseUrl
export const SIGN_ENABLED = apiConfig.signEnabled
const SIGN_SECRET = apiConfig.signSecret
const TIMEOUT = apiConfig.timeoutMs

export const TOKEN_KEY = 'stland.access_token'
export const USER_KEY = 'stland.user'

/** 是否运行在 Tauri 原生壳内（浏览器预览时为 false） */
export const IS_TAURI =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)

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

/**
 * 选择传输适配器（同步构造）。
 *
 * 原生壳内用 tauri-plugin-http 的 fetch；浏览器里退回标准 fetch。
 * 这里刻意不做动态 import：Alova 的 requestAdapter 需要同步拿到适配器对象，
 * 若返回 Promise 会让后续 response 的类型推断全部退化成 unknown。
 * 而插件的顶层 import 只是绑定函数，不触发任何原生调用，在浏览器里也安全。
 */
const customFetch = IS_TAURI ? (tauriFetch as unknown as typeof fetch) : undefined

/**
 * 给传输层加一次失败重试。
 *
 * 线上最常见的报错是 fetchError: network timeout —— 移动网络切换基站、
 * 屏幕熄灭后唤醒、服务端正忙，都可能让单次请求刚好超时；而这类失败
 * 在手动重进页面后又立刻恢复正常。给 GET/HEAD 补一次重试，
 * 就能把这类偶发抖动挡在用户视野之外。
 * 写请求（下单等）不重试：重复提交的代价远大于省一次点击。
 *
 * 注意 Alova 的适配器返回的是 { response, headers, abort } 这组惰性取值函数，
 * 不是一个已经发出的 Promise，所以重试必须包在 response() 上，
 * 直接包外层对象只会拿到一个「还没发请求」的对象，重试也就无从谈起。
 */
const RETRYABLE = /^(GET|HEAD)$/i
const MAX_RETRY = 1

function withRetry<A extends (elements: any, method: any) => any>(adapter: A): A {
  return ((elements: any, method: any) => {
    const out = adapter(elements, method)
    const rawResponse = out.response
    let attempts = 0
    out.response = async () => {
      for (;;) {
        try {
          return await rawResponse()
        } catch (err: any) {
          const retryable =
            RETRYABLE.test(String(method?.type ?? 'GET')) &&
            (err?.code === 'NETWORK_ERROR' || err?.name === 'TypeError' || err?.name === 'AbortError')
          if (!retryable || attempts >= MAX_RETRY) throw err
          attempts += 1
        }
      }
    }
    return out
  }) as A
}

const baseAdapter = customFetch ? adapterFetch({ customFetch }) : adapterFetch()
const requestAdapter = withRetry(baseAdapter)

export const alovaInstance = createAlova({
  baseURL: BASE_URL,
  statesHook: VueHook,
  requestAdapter,
  timeout: TIMEOUT,
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
      // 网络层错误（断网 / 超时 / 跨域）在这里补齐可读文案，
      // 并把当前服务端地址带上 —— 否则用户只看到「连不上」，无从判断是网络还是地址配错。
      if (err?.code === 'NETWORK_ERROR' || err?.name === 'TypeError') {
        const e = new Error(
          `无法连接服务端（${BASE_URL}），请确认 Stland-server 已启动且手机与服务器网络可达`,
        ) as ApiError
        e.code = 'NETWORK_ERROR'
        throw e
      }
      throw err
    },
  },
})

export { signRequest }
