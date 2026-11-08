/**
 * HTTP 基础设施：AlovaJS v3 实例。
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
 * 关于请求签名（已移除）
 * --------------------
 * 旧实现给每个请求加 `X-Stland-Sign = HMAC(共享密钥, canonical)`，而密钥
 * `dev-sign-secret-stland` 就写在 app.config.json 里并打进安装包 —— 攻击者从
 * APK 解出密钥即可伪造任意签名，这层防护只增加复杂度、不提供任何安全增益；
 * 更糟的是它依赖 `crypto.subtle`，在明文 HTTP 的 Android WebView 里不是安全上下文，
 * 直接抛错导致全部请求失败。因此签名层连服务端一起整体删除（P0-7 选项 A），
 * 传输安全改由 HTTPS + Bearer 令牌承担。
 */
import { createAlova } from 'alova'
import VueHook from 'alova/vue'
import adapterFetch from 'alova/fetch'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { apiConfig } from '@/config'
import { getToken, getStoredUser } from './session'

export const BASE_URL = apiConfig.baseUrl
const TIMEOUT = apiConfig.timeoutMs

/**
 * 持久化键名。这里保留导出只是为了兼容旧引用（迁移脚本、排障脚本），
 * 真正的读写已收敛到 api/session.ts —— 不要在别处直接碰 localStorage。
 */
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

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

/** 读取当前登录用户 id（业务侧偶尔需要，例如埋点区分身份） */
export function currentUserId(): string {
  const u = getStoredUser<{ id?: number | string }>()
  return u && u.id != null ? String(u.id) : ''
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
const requestAdapter = customFetch ? adapterFetch({ customFetch }) : adapterFetch()

export const alovaInstance = createAlova({
  baseURL: BASE_URL,
  statesHook: VueHook,
  requestAdapter,
  timeout: TIMEOUT,
  // 行情/账户必须实时：关闭 GET 默认的 5 分钟缓存
  cacheFor: { GET: 0, POST: 0 },

  /**
   * 唯一出口：注入令牌。
   * 令牌来自 api/session 的内存副本（同步），因此这里不需要 await。
   */
  beforeRequest: (method) => {
    const cfg = method.config
    const headers: Record<string, string> = { ...(cfg.headers as Record<string, string> | undefined) }
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
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
