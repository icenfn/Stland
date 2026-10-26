/**
 * 运行时配置的唯一入口。
 *
 * 为什么单独抽一个配置文件，而不是继续散落在 import.meta.env 里：
 * 1) 「客户端连哪台服务端」是最常被改动的一项，它应当是一个显式、可审阅的文件，
 *    而不是隐藏在构建命令行的一个环境变量里；
 * 2) 移动端 APK 是构建期注入的产物，改地址必须重新打包 —— 把它写进仓库里的
 *    JSON，让「这个包连的是哪台服务器」在代码里可追溯；
 * 3) 环境变量仍然优先（便于 CI / 临时连本地调试），但不再是唯一来源。
 *
 * 优先级：VITE_API_BASE 环境变量 > app.config.json 的 api.baseUrl
 */
import raw from './app.config.json'

export interface SignatureConfig {
  /** 是否发送 X-Stland-* 签名头。服务端 STLAND_SIGNATURE_REQUIRED=false 时可关闭 */
  enabled: boolean
  /** 与服务端 STLAND_SIGN_SECRET 必须一致，否则所有写接口返回 400 */
  secret: string
}

export interface ApiConfig {
  baseUrl: string
  timeoutMs: number
  signature: SignatureConfig
  polling: {
    /** 行情轮询间隔（毫秒） */
    marketMs: number
    /** 账户轮询间隔（毫秒） */
    accountMs: number
  }
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

function bool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback
  return String(v).toLowerCase() !== 'false'
}

const envBase = import.meta.env.VITE_API_BASE as string | undefined
const envSecret = import.meta.env.VITE_API_SIGN_SECRET as string | undefined
const envSignEnabled = import.meta.env.VITE_API_SIGNATURE as string | undefined

export const apiConfig: ApiConfig = {
  // 环境变量优先，便于 CI 或多环境构建覆盖；缺省回落到配置文件里的固定地址
  baseUrl: trimSlash(envBase || raw.api.baseUrl),
  timeoutMs: Number(raw.api.timeoutMs) || 15000,
  signature: {
    enabled: bool(envSignEnabled, raw.api.signature.enabled),
    secret: envSecret || raw.api.signature.secret,
  },
  polling: {
    marketMs: Number(raw.api.polling?.marketMs) || 1500,
    accountMs: Number(raw.api.polling?.accountMs) || 5000,
  },
}

export const appMeta = {
  name: raw.app?.name ?? 'Stland',
  version: raw.app?.version ?? '1.0.0',
}

/** 「我的」页与登录页展示用：让用户能确认当前连的是哪台服务器 */
export const serverLabel = apiConfig.baseUrl.replace(/^https?:\/\//, '')

export default { api: apiConfig, app: appMeta }
