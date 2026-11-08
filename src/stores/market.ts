/**
 * 行情状态层（Pinia store）。
 *
 * 职责怎么分
 * ----------
 * 上一版把「推送」与「轮询」混在一起用：既用 HTTP 轮询拉 overview/list，
 * 又用 WS 推送同一份数据互相覆盖。本版按数据「新鲜度来源」严格分层：
 *  · 推送 / 轮询快照 → 写入 all（全量标的，含 industry/board），是列表与首页的唯一事实源；
 *  · 筛选（关键词/行业）与排序 → 纯本地计算，从 all 派生 view，不发请求；
 *  · HTTP 只出现在三种情况：冷启动没快照、WS 不可用时的轮询兜底、
 *    以及详情页/分时/K线这类推送里本来就没有的按标的取数。
 *
 * 实时策略（P1-35）：单一真相源 + 明确的降级次序
 * ----------------------------------------------
 * 旧版同时开着 WS 和 `polling.marketMs=1500` 的轮询，还把 alova 的缓存全关了：
 * 三条通道都在打服务端，既浪费流量，又让「现在这份数据是哪来的」变得不可知。
 * 现在的规则只有一条 —— **WS 是主通道，轮询是降级通道**：
 *   1. 连上 WS：停止轮询，只在收到 tick 时更新；
 *   2. WS 断开 / 被中间设备拦截 / 服务端未开启：进入轮询模式，按配置节奏拉取；
 *   3. 轮询模式下同时按指数退避（2s→4s→8s…上限 30s）重连 WS，连上即停轮询。
 * 连接状态通过 `feed` 暴露给 UI（connecting / socket / polling / offline），
 * 叠加 `retryAttempt` 与 `nextRetryAt`，界面上可以显示「正在重连，5 秒后重试」，
 * 而不是干等一个不知所以的灰点。
 *
 * 页面不可见时全部暂停（省电、省流量），回到前台立即补一次并对齐通道。
 */
import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { marketApi } from '@/api'
import { apiConfig } from '@/config'
import type { Overview, Quote } from '@/api/types'

export type FeedMode = 'connecting' | 'socket' | 'polling' | 'offline'

type SortKey = 'change_pct' | 'amount' | 'turnover_rate' | 'price' | 'code'

/** 重连退避参数：基数 2s，倍数 2，上限 30s */
const RETRY_BASE = 2000
const RETRY_MAX = 30000

/** http(s):// → ws(s)://，再拼上配置里的推送路径 */
function socketUrl(): string {
  const base = apiConfig.baseUrl.replace(/^http/i, 'ws')
  return `${base}${apiConfig.realtime.wsPath}`
}

export const useMarketStore = defineStore('market', () => {
  /**
   * 数据状态仍是同一个 reactive 对象，模板里的 `market.state.keyword`
   * （含 v-model 双向绑定）因此完全不用改；只是它现在由 Pinia 托管，
   * 有了统一的实例、devtools 时间线与跨组件共享。
   */
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

  /** 重连进度：供 UI 显示「第 n 次重试 / 下次重试时间」 */
  const retryAttempt = ref(0)
  const nextRetryAt = ref(0)

  // ---- 内部计时器（不进响应式）----
  let pollTimer: number | null = null
  let retryTimer: number | null = null
  let running = false
  let socket: WebSocket | null = null
  /** 建连后需要立刻补一次快照，避免等到下一个 tick 才有数据 */
  let onSocketReady: (() => Promise<void>) | null = null

  /**
   * 本地派生列表：筛选 + 排序都不出网。
   *
   * 排序放本地是因为快照里就是全部标的最新价，按任意字段排一遍只是内存 O(n log n)；
   * 而每次筛选都打一次接口，既慢又会出现「先闪回旧顺序」的观感。
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
    if (Array.isArray(payload.items)) {
      state.all = payload.items as Quote[]
      applyView()
    }
    state.lastUpdated = Date.now()
    state.lastError = ''
  }

  // ---------------- 通道：轮询（降级） ----------------
  function stopPolling(): void {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return
    pollTimer = window.setInterval(() => {
      // 通道已升级到 WS 且数据新鲜 → 本轮不该再打接口
      if (state.feed === 'socket' && Date.now() - state.lastUpdated < 5000) return
      void refreshAll()
    }, apiConfig.polling.marketMs)
  }

  // ---------------- 通道：推送（主） ----------------
  function closeSocket(): void {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
    nextRetryAt.value = 0
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      try {
        socket.close()
      } catch {
        /* 忽略 */
      }
      socket = null
    }
  }

  /** 安排一次重连（指数退避 + 抖动），并把下次时间暴露给 UI */
  function scheduleReconnect(): void {
    if (!running || retryTimer !== null) return
    retryAttempt.value = Math.min(retryAttempt.value + 1, 6)
    const backoff = Math.min(RETRY_MAX, RETRY_BASE * 2 ** (retryAttempt.value - 1))
    // ±20% 抖动：避免多端同时重连把服务端打成尖峰
    const jitter = backoff * (0.8 + Math.random() * 0.4)
    const delay = Math.round(jitter)
    nextRetryAt.value = Date.now() + delay
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      nextRetryAt.value = 0
      if (running) openSocket()
    }, delay)
  }

  /**
   * 建立推送连接。失败不抛错：退回轮询并记录原因，
   * 界面据此把 feed 显示成「轮询」，便于区分「服务端没开 WS」和「真的断网」。
   */
  function openSocket(): void {
    if (!apiConfig.realtime.wsEnabled || typeof WebSocket === 'undefined') {
      state.feed = 'polling'
      startPolling()
      return
    }
    closeSocket()
    try {
      socket = new WebSocket(socketUrl())
    } catch {
      state.feed = 'polling'
      startPolling()
      scheduleReconnect()
      return
    }
    if (state.feed !== 'socket') state.feed = 'connecting'

    socket.onopen = () => {
      // 通道升级：立刻停掉降级轮询，并把重连计数归零
      state.feed = 'socket'
      retryAttempt.value = 0
      nextRetryAt.value = 0
      stopPolling()
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
      // onerror 之后通常会紧跟 onclose；这里只标记，重连统一由 onclose 负责
      if (state.feed === 'socket') state.feed = 'offline'
    }

    socket.onclose = () => {
      socket = null
      if (!running) return
      // 掉线即降级到轮询，保证数据仍在走；同时后台继续尝试升级回 WS
      if (state.feed === 'socket') state.feed = 'offline'
      if (state.feed !== 'polling') state.feed = 'polling'
      startPolling()
      scheduleReconnect()
    }
  }

  // ---------------- 数据刷新 ----------------
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
   * 才真的去问一次 /api/market/list。
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

  /**
   * 页面可见性：不可见时全部暂停，可见时立即补一次并对齐通道。
   *
   * 旧实现用一个 1s 的 setInterval 轮询 document.visibilityState —— 为了知道
   * 页面是否可见，每秒醒一次，本身就是一笔无谓开销。改用事件监听。
   */
  function onVisibilityChange(): void {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'hidden') {
      stopPolling()
      return
    }
    if (!running) return
    // 回到前台：数据大概率已经旧了，补一次；WS 若已断开则重建
    if (Date.now() - state.lastUpdated > 3000) void refreshAll()
    if (!socket && apiConfig.realtime.wsEnabled) openSocket()
    else if (!socket) startPolling()
  }

  /** 读当前通道状态（避免 TS 对 state.feed 赋值做字面量收窄） */
  const currentFeed = (): FeedMode => state.feed

  function start(_interval?: number) {
    if (running) return
    running = true
    onSocketReady = refreshAll
    state.feed = 'connecting'
    void refreshAll()
    // 先建 WS；连不上会自动降级到轮询（见 onclose / catch 分支）
    openSocket()
    // 极端情况下（构造 WebSocket 抛错且未进入降级）兜底开轮询。
    // 用取值函数读 feed：上面刚赋过字面量，直接比较会被收窄成 'connecting' 恒真。
    if (currentFeed() !== 'socket') startPolling()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
  }

  function stop() {
    running = false
    onSocketReady = null
    stopPolling()
    closeSocket()
    retryAttempt.value = 0
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  /** 筛选/排序变更入口：面板只改状态，重排在本地完成 */
  function setFilter(patch: {
    keyword?: string
    industry?: string
    sort?: SortKey
    order?: 'desc' | 'asc'
  }): void {
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

  const session = computed(() => state.overview?.session ?? null)
  const index = computed(() => state.overview?.index ?? null)
  const upCount = computed(() => state.overview?.stats.up ?? 0)
  const downCount = computed(() => state.overview?.stats.down ?? 0)
  const ready = computed(() => Boolean(state.overview))

  /** 连接可读描述：UI 直接用它渲染状态点与文案 */
  const connection = computed(() => {
    const retryIn = Math.max(0, Math.ceil((nextRetryAt.value - Date.now()) / 1000))
    return {
      feed: state.feed,
      healthy: state.feed === 'socket',
      attempt: retryAttempt.value,
      retryInSec: retryIn,
      lastUpdated: state.lastUpdated,
      label:
        state.feed === 'socket'
          ? '实时推送'
          : state.feed === 'connecting'
            ? '连接中'
            : state.feed === 'polling'
              ? retryIn > 0
                ? `轮询兜底 · ${retryIn}s 后重连`
                : '轮询兜底'
              : '已断开',
    }
  })

  return {
    state,
    session,
    index,
    upCount,
    downCount,
    ready,
    connection,
    retryAttempt,
    nextRetryAt,
    refreshOverview,
    refreshList,
    refreshAll,
    start,
    stop,
    setFilter,
    findByCode,
  }
})

/**
 * 兼容层：保持旧调用签名 `useMarket()` 不变。
 * 所有调用点都在 `app.use(createPinia())` 之后执行，因此直接转发即可。
 */
export function useMarket() {
  return useMarketStore()
}
