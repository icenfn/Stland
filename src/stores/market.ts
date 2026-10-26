/** 行情状态：轮询 + 全局共享，避免每个页面各自拉取造成请求风暴。
 *
 * 说明：行情用 1.5s 轮询而非 WebSocket，原因是本项目面向移动端弱网环境，
 * 轮询可断线自愈、无需心跳保活；服务端 tick 频率可配，两者解耦。
 */
import { reactive, computed } from 'vue'
import { useIntervalFn, useDocumentVisibility } from '@vueuse/core'
import { marketApi } from '@/api'
import type { Overview, Quote } from '@/api/types'
import { apiConfig } from '@/config'

const state = reactive({
  overview: null as Overview | null,
  quotes: [] as Quote[],
  loading: false,
  lastError: '',
  lastUpdated: 0,
  keyword: '',
  sort: 'change_pct' as string,
  order: 'desc' as 'desc' | 'asc',
  industry: '',
})

let timer: { pause: () => void; resume: () => void } | null = null
let polling = false

export function useMarket() {
  const session = computed(() => state.overview?.session ?? null)
  const index = computed(() => state.overview?.index ?? null)
  const upCount = computed(() => state.overview?.stats.up ?? 0)
  const downCount = computed(() => state.overview?.stats.down ?? 0)

  async function refreshOverview() {
    try {
      state.overview = await marketApi.overview()
      state.lastUpdated = Date.now()
      state.lastError = ''
    } catch (e: any) {
      state.lastError = e?.message ?? '行情获取失败'
    }
  }

  async function refreshList() {
    try {
      const res = await marketApi.list({
        sort: state.sort,
        order: state.order,
        keyword: state.keyword,
        industry: state.industry,
      })
      state.quotes = res.items
    } catch (e: any) {
      state.lastError = e?.message ?? '行情列表获取失败'
    }
  }

  async function refreshAll() {
    if (state.loading) return
    state.loading = true
    try {
      await Promise.all([refreshOverview(), refreshList()])
    } finally {
      state.loading = false
    }
  }

  /** 启动轮询（幂等）。页面不可见时自动暂停，回到前台立即刷新。 */
  function start(interval = apiConfig.polling.marketMs) {
    if (polling) return
    polling = true
    void refreshAll()
    const ctrl = useIntervalFn(() => {
      void refreshAll()
    }, interval, { immediate: false })
    ctrl.resume()
    timer = ctrl
    const visibility = useDocumentVisibility()
    const unwatch = setInterval(() => {
      if (visibility.value === 'visible' && timer) timer.resume()
      else if (timer) timer.pause()
    }, 1000)
    // 组件卸载时清理
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        clearInterval(unwatch)
        stop()
      })
    }
  }

  function stop() {
    if (timer) timer.pause()
    timer = null
    polling = false
  }

  function findByCode(code: string): Quote | undefined {
    return state.quotes.find((q) => q.code === code) ?? state.overview?.rank.gainers.find((q) => q.code === code)
  }

  return {
    state,
    session,
    index,
    upCount,
    downCount,
    refreshOverview,
    refreshList,
    refreshAll,
    start,
    stop,
    findByCode,
  }
}
