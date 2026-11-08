/**
 * 运行时环境常量：**无依赖**的叶子模块。
 *
 * 为什么单独抽一个文件
 * --------------------
 * 原先 `IS_TAURI / TOKEN_KEY / USER_KEY` 定义在 `api/http.ts` 里，而
 * `api/session.ts` 又要用它们，同时 `http.ts` 又要用 `session.ts` 的
 * `getToken()` —— 两个模块互相 import，形成了环。
 *
 * ESM 的环不是「晚一点就有值」，而是**会在初始化阶段直接抛错**：
 * 入口先加载 `http.ts`，它第一步去加载 `session.ts`；`session.ts` 的模块体
 * 里有一句 `const KEY_EXPIRES = `${TOKEN_KEY}.expires_at``，而 `TOKEN_KEY`
 * 所在的 `http.ts` 模块体还没开始执行 —— 于是抛
 * `ReferenceError: Cannot access 'TOKEN_KEY' before initialization`。
 *
 * 这个错误发生在模块求值期，早于 `main.ts` 里的任何 try/catch 与 renderFatal，
 * 结果是整个应用根本没挂载，屏幕上只剩背景色 —— 也就是「进入客户端黑屏」。
 *
 * 修法就是把「谁都要用、且自己不需要别人」的常量下移到叶子模块：
 * 依赖方向变成 http → runtime、session → runtime，环被打断。
 */
export const TOKEN_KEY = 'stland.access_token'
export const USER_KEY = 'stland.user'

/** 是否运行在 Tauri 原生壳内（浏览器预览时为 false） */
export const IS_TAURI =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
