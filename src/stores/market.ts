/**
 * 行情状态层：推送（WebSocket）为唯一「快照源」，HTTP 只做兜底与按需取数。
 *
 * 职责怎么分（本轮重构的核心）
 * --------------------------
 * 上一版把两件事混在一起：既用 HTTP 轮询拉 overview/list，又用 WS 推送同一份数据，
 * 互相覆盖；筛选/排序一变就再打一次 /api/market/list —— 那是把「客户端已有的
 * 全量快照」又找服务端要了一遍，弱网下手感很差，还会出现「刚筛完列表闪回旧数据」。
 *
 * 现在按数据「新鲜度来源」划分：
 *  · 推送 / 轮询快照 → 写入 all（全量标的，含 industry/board），是列表与首页的唯一事实源；
 *  · 筛选（关键词/行业）与排序 → 纯本地计算，从 all 派生 view，不发请求；
 *  · HTTP 只在三种情况下出现：
 *      1) 首次进入、还没有任何快照（冷启动兜底）；
 *      2) WS 连不上（老服务端/被中间设备拦截）→ 轮询兜底，行为与旧版一致；
 *      3) 详情页、分时、K 线、盘口这类「按标的取历史/明细」的接口 ——
 *         推送里没有这些数据，只能走 HTTP。
 *
 * 这样一条连接就够：tick 一到，列表、榜单、指数、分布同时更新，天然同 tick。
 */
import { reactive, computed } from 'vue'
import { useIntervalFn, useDocumentVisibility } from '@vueuse/core'
import { marketApi } from '@/api'
import { apiConfig } from '@/config'
import type { Overview, Quote } from '@/api/types'

export type FeedMode = 'connecting' | 'socket' | 'polling' | 'offline'

type SortKey = 'change_pct' | 'amount' | 'turnover_rate' | 'price' | 'code'

const state = reactive({
  overview: null as Overview | null,
  /** 全量快照（推送优先），列表与首页的共同来源 */
  all: [] as Quote[],
  /** 按当前筛选/排序派生出的列表视图；面板直接渲染它 */
  quotes: [] as Quote[],
  loading: false,
  lastError: '',
  lastUpdated: 0,
  feed: 'connecting' as FeedMode,
  socketTicks: 0,
  keyword: '',
  sort: 'change_pct' as SortKey,
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

/**
 * 本地派生列表：筛选 + 排序都不出网。
 *
 * 为什么排序放本地：快照里就是全部标的最新价，按任意字段排一遍只是内存里的
 * O(n log n)；而每次筛选都打一次接口，既慢又会出现「先闪回旧顺序」的观感。
 */
function applyView(): void {
  const kw = state.keyword.trim()
  const ind = state.industry
  let rows = state.all
  if (ind) rows = rows.filter((q) => q.industry === ind)
  if (kw) rows = rows.filter((q) => q.name.includes(kw) || q.code.includes(kw))

  const key = state.sort
  const dir = state.order === 'asc' ? 1 : -1
  const sorted = [...rows].sort((a, b) => {
    if (key === 'code') return a.code.localeCompare(b.code) * dir
    const av = Number((a as any)[key] ?? 0)
    const bv = Number((b as any)[key] ?? 0)
    return (av - bv) * dir
  })
  state.quotes = sorted
}

/** 服务端推送与轮询响应的结构统一在这里归一，减少两套通道的差异 */
function applyPayload(payload: any): void {
  if (!payload || typeof payload !== 'object') return
  if (payload.index && payload.stats) {
    state.overview = payload as Overview
  }
  // items 是推送里的全量标的（含 industry / board），直接作为唯一事实源
  if (Array.isArray(payload.items)) {
    state.all = payload.items as Quote[]
    applyView()
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

  /**
   * 列表视图刷新。
   *
   * 有快照就纯本地重排一次（不发请求）；只有冷启动、快照还是空的，
   * 才真的去问一次 /api/market/list —— 这正是「合理使用 socket 与 http」的边界。
   */
  async function refreshList() {
    if (state.all.length) {
      applyView()
      return
    }
    try {
      const res = await marketApi.list({ sort: state.sort, order: state.order })
      state.all = res.items
      applyView()
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

  /** 筛选/排序变更入口：面板只改状态，重排在本地完成 */
  function setFilter(patch: { keyword?: string; industry?: string; sort?: SortKey; order?: 'desc' | 'asc' }): void {
    if (patch.keyword !== undefined) state.keyword = patch.keyword
    if (patch.industry !== undefined) state.industry = patch.industry
    if (patch.sort !== undefined) state.sort = patch.sort
    if (patch.order !== undefined) state.order = patch.order
    applyView()
  }

  function findByCode(code: string): Quote | undefined {
    return (
      state.all.find((q) => q.code === code) ??
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
    setFilter,
    findByCode,
  }
}
