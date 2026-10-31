/**
 * 运行期配置的唯一出口。
 *
 * 为什么单独抽一个 config 层，而不是继续用 import.meta.env：
 *   VITE_* 是「构建期常量」，一旦打进 bundle 就再也改不了 —— 换个服务器地址
 *   就得重新出一版 APK。而「连哪台服务器」恰好是最常改的一项。
 *   于是把默认值放进 app.config.json（随源码可审计、可 diff），
 *   环境变量只作为临时覆盖（CI / 本地联调），优先级排在配置文件之后。
 *
 * 优先级：VITE_* 环境变量  >  app.config.json  >  内置兜底
 */
import raw from './app.config.json'

export interface ApiConfig {
  /** 服务端根地址，末尾不含斜杠 */
  baseUrl: string
  /** 单请求超时（毫秒） */
  timeoutMs: number
  /** 是否启用 HMAC 请求签名 */
  signEnabled: boolean
  /** 与服务端 STLAND_SIGN_SECRET 一致的共享密钥 */
  signSecret: string
  /** 轮询节奏 */
  polling: {
    marketMs: number
    accountMs: number
  }
  /** 实时推送（WebSocket）；服务端不支持时自动回退到轮询 */
  realtime: {
    wsEnabled: boolean
    wsPath: string
  }
}

const FALLBACK_BASE = 'http://127.0.0.1:8999'

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** 环境变量若存在且非空字符串则采用，否则用配置文件里的值 */
function envOr(name: string, fallback: string): string {
  const v = import.meta.env[name] as string | undefined
  return v !== undefined && v !== '' ? v : fallback
}

const fileApi = raw.api

/** 是否启用签名：环境变量给了就以它为准，否则看配置文件里的开关 */
function resolveSignEnabled(): boolean {
  const envFlag = import.meta.env.VITE_API_SIGNATURE as string | undefined
  if (envFlag !== undefined && envFlag !== '') return String(envFlag) !== 'false'
  return fileApi.signature.enabled === true
}

export const appConfig = {
  name: raw.app.name,
  version: raw.app.version,
}

export const apiConfig: ApiConfig = {
  baseUrl: stripTrailingSlash(envOr('VITE_API_BASE', fileApi.baseUrl) || FALLBACK_BASE),
  timeoutMs: Number(envOr('VITE_API_TIMEOUT', String(fileApi.timeoutMs))) || 25000,
  signEnabled: resolveSignEnabled(),
  signSecret: envOr('VITE_API_SIGN_SECRET', fileApi.signature.secret),
  polling: {
    marketMs: Number(envOr('VITE_POLL_MARKET_MS', String(fileApi.polling.marketMs))) || 1500,
    accountMs: Number(envOr('VITE_POLL_ACCOUNT_MS', String(fileApi.polling.accountMs))) || 5000,
  },
  realtime: {
    wsEnabled: (fileApi.realtime?.wsEnabled ?? false) === true,
    wsPath: fileApi.realtime?.wsPath ?? '/ws/market',
  },
}

/**
 * 给界面显示用的服务器标识（去掉协议头）。
 * 「我的」页展示它，用户能直接看出当前这个包连的是哪台机器，
 * 而不是遇到连不上时只能干猜。
 */
export const serverLabel = apiConfig.baseUrl.replace(/^https?:\/\//, '')

/** Android 明文 HTTP 放行的主机白名单（供补丁脚本与自检共用） */
export const androidCleartextHosts: string[] = raw.android?.cleartextHosts ?? []

/** 启动自检：地址必须带协议，否则请求层会在运行期抛出难以定位的错误 */
export function assertConfig(): void {
  if (!/^https?:\/\//.test(apiConfig.baseUrl)) {
    throw new Error(
      `服务端地址配置无效：${apiConfig.baseUrl}（需要在 app.config.json 的 api.baseUrl 中写成 http://host:port 形式）`,
    )
  }
}
