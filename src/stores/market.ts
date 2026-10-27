/**
 * 行情状态层：WebSocket 推送优先 + 轮询兜底。
 *
 * 为什么要两套通道
 * ---------------
 * 上一版只有 1.5s 轮询，用户会觉得「数据不刷新」，实际原因是请求全被服务端
 * 的签名校验挡掉（已在本轮修复签名开关）。但即使签名正常，轮询仍有两个硬伤：
 *   1) 每次都是完整 HTTP 往返，移动端弱网下延迟抖动大；
 *   2) 一次 overview + 一次 list 是两个请求，客户端拿到的指数与列表可能不同 tick。
 *
 * 因此本轮改为：连上 /ws/market 后由服务端按 tick 主动推送（一次消息内含
 * 指数、涨跌分布、榜单，天然同 tick）；连不上（老服务端 / 中间设备拦截 WS）
 * 就自动退回轮询，行为与旧版一致，不会白屏。连接状态对外暴露，
 * 首页右上角据此显示「实时」或「轮询」，用户能看出当前是哪条通道在工作。
 */
import { reactive, computed } from 'vue'
import { useIntervalFn, useDocumentVisibility } from '@vueuse/core'
import { marketApi } from '@/api'
import { apiConfig } from '@/config'
import type { Overview, Quote } from '@/api/types'

export type FeedMode = 'connecting' | 'socket' | 'polling' | 'offline'

const state = reactive({
  overview: null as Overview | null,
  quotes: [] as Quote[],
  loading: false,
  lastError: '',
  lastUpdated: 0,
  feed: 'connecting' as FeedMode,
  socketTicks: 0,
  keyword: '',
  sort: 'change_pct' as string,
  order: 'desc' as 'desc' | 'asc',
  industry: '',
})

let timer: { pause: () => void; resume: () => void } | null = null
let polling = false
let socket: WebSocket | null = null
let socketRetry = 0
let socketRetryTimer: number | null = null
/** 建连后需要立刻补一次快照，但 refreshAll 定义在组合式函数内部，这里用回调桥接 */
let onSocketReady: (() => Promise<void>) | null = null
let visibilityTimer: number | null = null

/** http(s):// → ws(s)://，再拼上配置里的推送路径 */
function socketUrl(): string {
  const base = apiConfig.baseUrl.replace(/^http/i, 'ws')
  return `${base}${apiConfig.realtime.wsPath}`
}

/** 服务端推送与轮询响应的结构统一在这里归一，减少两套通道的差异 */
function applyPayload(payload: any): void {
  if (!payload || typeof payload !== 'object') return
  if (payload.index && payload.stats) {
    state.overview = payload as Overview
  }
  if (Array.isArray(payload.items)) {
    state.quotes = payload.items as Quote[]
  }
  state.lastUpdated = Date.now()
  state.lastError = ''
}

function closeSocket(): void {
  if (socketRetryTimer !== null) {
    window.clearTimeout(socketRetryTimer)
    socketRetryTimer = null
  }
  if (socket) {
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    try {
      socket.close()
    } catch {
      /* 忽略 */
    }
    socket = null
  }
}

/**
 * 建立推送连接。失败不抛错：退回轮询并记录原因，
 * 首页会把 feed 显示成「轮询」，便于区分「服务端没开 WS」和「真的断网」。
 */
function openSocket(): void {
  if (!apiConfig.realtime.wsEnabled || typeof WebSocket === 'undefined') {
    state.feed = 'polling'
    return
  }
  closeSocket()
  try {
    socket = new WebSocket(socketUrl())
  } catch {
    state.feed = 'polling'
    return
  }

  socket.onopen = () => {
    state.feed = 'socket'
    socketRetry = 0
    // 建连后立即补一次完整快照，避免等到下一个 tick 才有数据
    if (onSocketReady) void onSocketReady()
  }

  socket.onmessage = (ev) => {
    try {
      const payload = JSON.parse(String(ev.data))
      if (payload?.type === 'pong') return
      state.socketTicks += 1
      applyPayload(payload?.data ?? payload)
    } catch {
      /* 单条消息解析失败不应影响后续 */
    }
  }

  socket.onerror = () => {
    if (state.feed !== 'socket') state.feed = 'polling'
  }

  socket.onclose = () => {
    socket = null
    if (state.feed === 'socket') state.feed = 'offline'
    // 指数退避重连：2s → 4s → 8s，上限 30s；期间轮询继续兜底
    socketRetry = Math.min(socketRetry + 1, 5)
    const delay = Math.min(30000, 1000 * 2 ** socketRetry)
    socketRetryTimer = window.setTimeout(() => {
      if (polling) openSocket()
    }, delay)
  }
}

export function useMarket() {
  const session = computed(() => state.overview?.session ?? null)
  const index = computed(() => state.overview?.index ?? null)
  const upCount = computed(() => state.overview?.stats.up ?? 0)
  const downCount = computed(() => state.overview?.stats.down ?? 0)
  const ready = computed(() => Boolean(state.overview))

  async function refreshOverview() {
    try {
      const data = await marketApi.overview()
      applyPayload(data)
    } catch (e: any) {
      state.lastError = e?.message ?? '行情获取失败'
      throw e
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
      throw e
    }
  }

  async function refreshAll() {
    if (state.loading) return
    state.loading = true
    try {
      // 两路并行且互不牵连：一路失败不影响另一路渲染
      await Promise.allSettled([refreshOverview(), refreshList()])
    } finally {
      state.loading = false
    }
  }

  /** 轮询节奏：有推送时降到 10s 做一次对账，没推送时保持配置节奏 */
  function pollInterval(): number {
    const base = apiConfig.polling.marketMs
    return state.feed === 'socket' ? Math.max(10000, base) : base
  }

  function start(interval?: number) {
    if (polling) return
    polling = true
    onSocketReady = refreshAll
    state.feed = 'connecting'
    void refreshAll()
    openSocket()

    const ctrl = useIntervalFn(() => {
      // 推送正常且刚刚收到数据 → 本轮跳过，避免重复请求
      if (state.feed === 'socket' && Date.now() - state.lastUpdated < 5000) return
      void refreshAll()
      if (timer && typeof (timer as any).setInterval === 'function') {
        ;(timer as any).setInterval(interval ?? pollInterval())
      }
    }, interval ?? pollInterval(), { immediate: false })
    ctrl.resume()
    timer = ctrl

    // 页面切到后台时暂停，回到前台立即补一次（移动端省电、切回即新鲜）
    const visibility = useDocumentVisibility()
    if (visibilityTimer === null) {
      visibilityTimer = window.setInterval(() => {
        if (visibility.value === 'visible') {
          if (timer) timer.resume()
          if (!socket && polling) openSocket()
          if (Date.now() - state.lastUpdated > 3000) void refreshAll()
        } else if (timer) {
          timer.pause()
        }
      }, 1000)
    }
  }

  function stop() {
    polling = false
    onSocketReady = null
    if (timer) timer.pause()
    timer = null
    if (visibilityTimer !== null) {
      window.clearInterval(visibilityTimer)
      visibilityTimer = null
    }
    closeSocket()
  }

  function findByCode(code: string): Quote | undefined {
    return (
      state.quotes.find((q) => q.code === code) ??
      state.overview?.rank.gainers.find((q) => q.code === code) ??
      state.overview?.rank.losers.find((q) => q.code === code)
    )
  }

  return {
    state,
    session,
    index,
    upCount,
    downCount,
    ready,
    refreshOverview,
    refreshList,
    refreshAll,
    start,
    stop,
    findByCode,
  }
}
