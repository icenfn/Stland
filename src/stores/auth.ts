/**
 * 认证状态（Pinia store，P1-34）。
 *
 * 从 `模块级 reactive + useStorage` 迁到 Pinia，理由是状态面已经不止认证：
 * 行情、风险偏好、交易面板都持有跨页面共享的会话相关状态，需要一个统一的
 * 容器来保证「同一份状态、同一套 devtools 时间线」，也不再靠模块副作用初始化
 * （旧写法在 HMR 时会重复创建 reactive，导致状态分裂）。
 *
 * 令牌不再存在 localStorage（P0-8）：全部读写走 `@/api/session`，
 * 壳内落 tauri-plugin-store，浏览器预览落 localStorage。
 * 本 store 只在内存里持有 `token` 的镜像，供模板做登录态判断。
 */
import { computed, ref, readonly } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '@/api'
import {
  clearSession,
  getStoredUser,
  getToken,
  saveSession,
  saveUser,
  hasSession,
} from '@/api/session'
import type { Role, UserProfile } from '@/api/types'

/**
 * 角色能力矩阵：交易账户只有零售与机构两种。
 *
 * 管理员已从交易账户体系迁到服务端独立的 `admin` 表（见服务端 models.py），
 * 后台面板是 `/admin/` 独立页面，不再由本客户端承载 —— 因此这里既没有
 * `admin` 角色，也没有 `admin.*` 能力项。客户端不再判断「是不是管理员」。
 */
const CAPABILITIES: Record<Role, string[]> = {
  retail: ['market.read', 'trade.own', 'account.own'],
  institution: ['market.read', 'trade.own', 'account.own', 'inst.desk', 'inst.credit'],
}

export const useAuthStore = defineStore('auth', () => {
  /** 令牌镜像：仅内存，持久化由 session 层负责 */
  const token = ref<string>(getToken())
  const user = ref<UserProfile | null>((getStoredUser<UserProfile>() as UserProfile) ?? null)
  const loading = ref(false)
  const error = ref('')

  const isLoggedIn = computed(() => Boolean(token.value && user.value))
  const role = computed<Role>(() => user.value?.role ?? 'retail')
  const isInstitution = computed(() => role.value === 'institution')

  /** 能力判定：路由守卫与按钮级权限都走这里，映射只在上面的表里维护 */
  function can(capability: string): boolean {
    return CAPABILITIES[role.value]?.includes(capability) ?? false
  }

  /** 写入会话：内存 + 持久层一次完成 */
  function adopt(res: { token: { access_token: string; expires_in?: number }; user: UserProfile }) {
    token.value = res.token.access_token
    user.value = res.user
    saveSession(res.token.access_token, res.user, res.token.expires_in)
  }

  async function login(username: string, password: string) {
    loading.value = true
    error.value = ''
    try {
      const res = await authApi.login(username.trim(), password)
      adopt(res)
      return res.user
    } catch (e: any) {
      error.value = e?.message ?? '登录失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function register(username: string, password: string, r: Role, display_name = '') {
    loading.value = true
    error.value = ''
    try {
      const res = await authApi.register(username, password, r, display_name)
      adopt(res)
      return res.user
    } catch (e: any) {
      error.value = e?.message ?? '注册失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  async function hydrate() {
    if (!token.value) return null
    try {
      const res = await authApi.me()
      user.value = res.user
      saveUser(res.user)
      return res.user
    } catch {
      forceLogout()
      return null
    }
  }

  async function logout() {
    try {
      if (token.value) await authApi.logout()
    } catch {
      /* 网络异常也要本地登出 */
    }
    forceLogout()
  }

  /** 本地强制登出（令牌过期或 401 时调用） */
  function forceLogout() {
    token.value = ''
    user.value = null
    clearSession()
  }

  function syncUser(patch: Partial<UserProfile>) {
    if (!user.value) return
    user.value = { ...user.value, ...patch }
    saveUser(user.value)
  }

  /**
   * 启动时用已恢复的持久会话填内存态。
   * 令牌由 `hydrateSession()`（main.ts 里 await）装好，这里只同步镜像。
   */
  function bootstrap() {
    token.value = getToken()
    if (!user.value) {
      const cached = getStoredUser<UserProfile>()
      if (cached) user.value = cached as UserProfile
    }
    // 令牌已过期但用户快照还在：清掉，避免「看起来已登录」
    if (!hasSession() && token.value) token.value = ''
  }

  return {
    token: readonly(token),
    state: readonly({ user, loading, error }),
    user,
    loading,
    error,
    isLoggedIn,
    role,
    isInstitution,
    can,
    login,
    register,
    hydrate,
    logout,
    forceLogout,
    syncUser,
    bootstrap,
  }
})

/**
 * 兼容层：保持旧调用签名 `useAuth()` 不变。
 *
 * 旧代码有几十处 `const auth = useAuth()`，其中相当一部分在 setup 之外
 * （composables、路由守卫）被调用。Pinia 的 store 必须在 pinia 安装后使用，
 * 而这些调用点全都在 `app.use(createPinia())` 之后执行，所以这里直接转发即可。
 */
export function useAuth() {
  return useAuthStore()
}
