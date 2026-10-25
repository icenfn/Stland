/** 认证状态：令牌、用户、角色能力判定。
 *
 * 为什么不用 Pinia：本项目状态面很小（认证 + 行情轮询），
 * 用 VueUse 的 useStorage + 模块级 reactive 即可，减少一层依赖与心智负担。
 */
import { computed, reactive, readonly } from 'vue'
import { useStorage } from '@vueuse/core'
import { authApi } from '@/api'
import { TOKEN_KEY, USER_KEY } from '@/api/http'
import type { Role, UserProfile } from '@/api/types'

const state = reactive({
  user: null as UserProfile | null,
  loading: false,
  error: '',
})

export const tokenStore = useStorage<string>(TOKEN_KEY, '')
export const userStore = useStorage<UserProfile | null>(USER_KEY, null)

/** 角色能力矩阵：同一客户端内三种形态共用一套路由，按权限显隐入口 */
const CAPABILITIES: Record<Role, string[]> = {
  retail: ['market.read', 'trade.own', 'account.own'],
  institution: ['market.read', 'trade.own', 'account.own', 'inst.desk', 'inst.credit'],
  admin: ['market.read', 'admin.all', 'admin.users', 'admin.audit', 'admin.settle'],
}

export function useAuth() {
  const isLoggedIn = computed(() => Boolean(tokenStore.value && state.user))
  const role = computed<Role>(() => state.user?.role ?? 'retail')
  const isAdmin = computed(() => role.value === 'admin')
  const isInstitution = computed(() => role.value === 'institution')

  function can(capability: string): boolean {
    return CAPABILITIES[role.value]?.includes(capability) ?? false
  }

  async function login(username: string, password: string) {
    state.loading = true
    state.error = ''
    try {
      const res = await authApi.login(username.trim(), password)
      tokenStore.value = res.token.access_token
      state.user = res.user
      userStore.value = res.user
      return res.user
    } catch (e: any) {
      state.error = e?.message ?? '登录失败'
      throw e
    } finally {
      state.loading = false
    }
  }

  async function register(username: string, password: string, role: Role, display_name = '') {
    state.loading = true
    state.error = ''
    try {
      const res = await authApi.register(username, password, role, display_name)
      tokenStore.value = res.token.access_token
      state.user = res.user
      userStore.value = res.user
      return res.user
    } catch (e: any) {
      state.error = e?.message ?? '注册失败'
      throw e
    } finally {
      state.loading = false
    }
  }

  async function hydrate() {
    if (!tokenStore.value) return null
    try {
      const res = await authApi.me()
      state.user = res.user
      userStore.value = res.user
      return res.user
    } catch {
      tokenStore.value = ''
      userStore.value = null
      state.user = null
      return null
    }
  }

  async function logout() {
    try {
      if (tokenStore.value) await authApi.logout()
    } catch {
      /* 网络异常也要本地登出 */
    }
    tokenStore.value = ''
    userStore.value = null
    state.user = null
  }

  /** 本地强制登出（令牌过期或 401 时调用） */
  function forceLogout() {
    tokenStore.value = ''
    userStore.value = null
    state.user = null
  }

  function syncUser(patch: Partial<UserProfile>) {
    if (!state.user) return
    state.user = { ...state.user, ...patch }
    userStore.value = state.user
  }

  return {
    state: readonly(state),
    isLoggedIn,
    role,
    isAdmin,
    isInstitution,
    can,
    login,
    register,
    hydrate,
    logout,
    forceLogout,
    syncUser,
    /** 启动时用本地缓存恢复，避免闪屏 */
    bootstrap() {
      if (userStore.value && !state.user) state.user = userStore.value
    },
  }
}
