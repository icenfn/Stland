/**
 * 令牌与用户快照的持久层（P0-8）。
 *
 * 为什么不再直接用 localStorage
 * ----------------------------
 * 旧实现把 `access_token` 落在 localStorage（`useStorage` 的默认后端）。
 * 在 Tauri 壳里这不成立：localStorage 是 WebView 的明文存储，Android 上就是
 * 应用私有目录里的一个 SQLite/LevelDB 文件 —— root 设备、备份导出、以及任何
 * 一次 XSS 都能把它读走；而壳子里页面源固定，XSS 面主要是 WebView 内的脚本，
 * 一旦发生就等于令牌直接外泄。
 *
 * 现在的分层：
 *   · Tauri 壳内 —— 走 `tauri-plugin-store`（Rust 侧落盘，页面脚本读不到文件），
 *     这是不引入额外原生依赖前提下最小代价的安全存储；
 *   · 浏览器预览 / 未装插件 —— 退回 localStorage，保证 `npm run dev` 可调试。
 *
 * 关键点：**读写在启动时静默异步完成**，调用方（http.ts 的 beforeRequest）
 * 是同步取令牌的，所以这里在模块内维护一份内存副本 `cache`，
 * 由 `hydrateToken()` 在挂载应用前填好。取用一律走同步的 `getToken()`。
 *
 * 令牌失效判定：`expiresAt` 一并持久化，过期即视为无令牌（不等到 401 才发现），
 * 这样冷启动就能直接进登录页，不会先闪一下首页再被踢回来。
 */
import { IS_TAURI, TOKEN_KEY, USER_KEY } from './runtime'

/** 内存副本：同步读的唯一来源 */
const cache = {
  token: '',
  expiresAt: 0,
  user: null as unknown,
}

/** 存储键（在 tauri-plugin-store 里也复用同一组键名，便于导出比对） */
const KEY_EXPIRES = `${TOKEN_KEY}.expires_at`

type StoreLike = {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  save(): Promise<void>
}

let storePromise: Promise<StoreLike | null> | null = null

/**
 * 惰性打开插件存储。插件未安装 / 不在壳内时返回 null，由调用方回退 localStorage。
 * 这里用动态 import：浏览器预览时不该因为缺少原生插件而抛错。
 */
function openStore(): Promise<StoreLike | null> {
  if (!IS_TAURI) return Promise.resolve(null)
  if (storePromise) return storePromise
  storePromise = (async () => {
    try {
      const { Store } = await import('@tauri-apps/plugin-store')
      // 文件名固定，便于排障时定位；autoSave 关闭，写操作自己 save()，
      // 避免高频 syncUser 触发大量落盘。
      const s = await Store.load('stland.session.json', { autoSave: false })
      return s as unknown as StoreLike
    } catch {
      // 插件缺失或 Rust 侧未注册：退回 localStorage，功能不受影响
      return null
    }
  })()
  return storePromise
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式 / 配额满：静默失败，本次会话仍可用内存副本 */
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/**
 * 启动时把持久化的会话装进内存副本。
 * 必须在 `app.mount()` 之前 await 完成，否则首屏的鉴权判断会读到空令牌。
 */
export async function hydrateSession(): Promise<void> {
  const store = await openStore()
  if (store) {
    try {
      cache.token = (await store.get<string>(TOKEN_KEY)) ?? ''
      cache.expiresAt = Number((await store.get<number>(KEY_EXPIRES)) ?? 0) || 0
      cache.user = (await store.get<unknown>(USER_KEY)) ?? null
      if (cache.token) return
    } catch {
      /* 落到下面的 localStorage 分支 */
    }
  }
  cache.token = readLocal(TOKEN_KEY) ?? ''
  cache.expiresAt = Number(readLocal(KEY_EXPIRES) ?? 0) || 0
  const rawUser = readLocal(USER_KEY)
  if (rawUser) {
    try {
      cache.user = JSON.parse(rawUser)
    } catch {
      cache.user = null
    }
  }
}

/** 同步取令牌；已过期则返回空串 */
export function getToken(): string {
  if (!cache.token) return ''
  if (cache.expiresAt > 0 && Date.now() / 1000 >= cache.expiresAt) return ''
  return cache.token
}

/** 同步判断是否有可用会话（供全局 401 处理区分「真失效」与「从未登录」） */
export function hasSession(): boolean {
  return Boolean(getToken())
}

/** 取用户快照（同步，来自内存副本） */
export function getStoredUser<T = unknown>(): T | null {
  return (cache.user as T) ?? null
}

/**
 * 写会话。`expiresIn` 是服务端给出的有效秒数，用于本地过期判定。
 * 写内存副本是同步的，落盘异步进行 —— 调用方不必 await。
 */
export function saveSession(token: string, user: unknown, expiresIn?: number): void {
  cache.token = token
  cache.user = user
  cache.expiresAt = expiresIn && expiresIn > 0 ? Math.floor(Date.now() / 1000) + expiresIn : 0
  void persist()
}

/** 只更新用户快照（syncUser 用），令牌不动 */
export function saveUser(user: unknown): void {
  cache.user = user
  void persist()
}

/** 清空会话：内存与两处存储同时清 */
export function clearSession(): void {
  cache.token = ''
  cache.user = null
  cache.expiresAt = 0
  removeLocal(TOKEN_KEY)
  removeLocal(USER_KEY)
  removeLocal(KEY_EXPIRES)
  void (async () => {
    const store = await openStore()
    if (!store) return
    try {
      await store.delete(TOKEN_KEY)
      await store.delete(USER_KEY)
      await store.delete(KEY_EXPIRES)
      await store.save()
    } catch {
      /* ignore */
    }
  })()
}

async function persist(): Promise<void> {
  const store = await openStore()
  if (!store) {
    // 浏览器预览 / 无插件：退回 localStorage
    writeLocal(TOKEN_KEY, cache.token)
    if (cache.expiresAt) writeLocal(KEY_EXPIRES, String(cache.expiresAt))
    else removeLocal(KEY_EXPIRES)
    if (cache.user != null) writeLocal(USER_KEY, JSON.stringify(cache.user))
    else removeLocal(USER_KEY)
    return
  }
  try {
    if (cache.token) await store.set(TOKEN_KEY, cache.token)
    if (cache.expiresAt) await store.set(KEY_EXPIRES, cache.expiresAt)
    if (cache.user != null) await store.set(USER_KEY, cache.user)
    await store.save()
  } catch {
    /* 落盘失败不影响本次会话 */
  }
}
