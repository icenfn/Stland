/** 接口聚合层：所有请求集中在此，便于统一签名、错误处理与类型约束 */
import { alovaInstance } from './http'
import type {
  AccountSummary,
  BarItem,
  Depth,
  IndexMember,
  IndexQuote,
  MinutePoint,
  OrderItem,
  Overview,
  PositionItem,
  Quote,
  RiskProfile,
  SessionState,
  StockMeta,
  TradeItem,
  TradePreview,
  UserProfile,
  WatchGroup,
  WatchItem,
} from './types'

export interface LoginResult {
  user: UserProfile
  token: { access_token: string; token_type: string; expires_in: number }
  refresh_token?: string
}

export const authApi = {
  handshake: () => alovaInstance.Get<{ app: string; version: string; session: SessionState }>('/api/auth/handshake'),

  login: (username: string, password: string) =>
    alovaInstance.Post<LoginResult>('/api/auth/login', { username, password }),

  register: (username: string, password: string, role: string, display_name = '') =>
    alovaInstance.Post<LoginResult>('/api/auth/register', { username, password, role, display_name }),

  me: () => alovaInstance.Get<{ user: UserProfile }>('/api/auth/me'),

  logout: () => alovaInstance.Post<{ ok: boolean }>('/api/auth/logout', {}),
}

export const marketApi = {
  overview: () => alovaInstance.Get<Overview>('/api/market/overview'),

  list: (params: { sort?: string; order?: string; keyword?: string; industry?: string } = {}) =>
    alovaInstance.Get<{ total: number; items: Quote[] }>('/api/market/list', { params }),

  industries: () => alovaInstance.Get<{ items: Array<{ industry: string; count: number; change_pct: number }> }>(
    '/api/market/industries',
  ),

  detail: (code: string) => alovaInstance.Get<{ quote: Quote; meta: StockMeta }>(`/api/market/stock/${code}`),

  depth: (code: string) => alovaInstance.Get<Depth>(`/api/market/depth/${code}`),

  minutes: (code: string, limit = 240) =>
    alovaInstance.Get<{ code: string; items: MinutePoint[] }>(`/api/market/minutes/${code}`, { params: { limit } }),

  kline: (code: string, period = '1min', limit = 120) =>
    alovaInstance.Get<{ code: string; period: string; items: BarItem[] }>(`/api/market/kline/${code}`, {
      params: { period, limit },
    }),

  // ---- 指数：与个股同构，有代码、能看详情 ----
  indexList: () => alovaInstance.Get<{ items: IndexQuote[]; quote: IndexQuote }>('/api/market/index'),

  indexDetail: (code: string) =>
    alovaInstance.Get<{
      quote: IndexQuote
      meta: StockMeta
      members: IndexMember[]
    }>(`/api/market/index/${code}`),

  indexMinutes: (code: string, limit = 240) =>
    alovaInstance.Get<{ code: string; items: MinutePoint[] }>(
      `/api/market/index/${code}/minutes`,
      { params: { limit } },
    ),

  indexKline: (code: string, period = '5min', limit = 120) =>
    alovaInstance.Get<{ code: string; period: string; items: BarItem[] }>(`/api/market/index/${code}/kline`, {
      params: { period, limit },
    }),

  search: (q: string) =>
    alovaInstance.Get<{
      items: Array<{ code: string; name: string; industry: string; hotword: string; is_index: boolean }>
    }>('/api/market/search', { params: { q } }),
}

export const tradeApi = {
  order: (payload: {
    code: string
    side: 'buy' | 'sell'
    quantity: number
    price?: number
    order_type?: 'limit' | 'market'
  }) =>
    alovaInstance.Post<{ order: OrderItem; trades: TradeItem[] }>('/api/trade/order', {
      order_type: 'limit',
      ...payload,
    }),

  cancel: (order_id: number) => alovaInstance.Post<{ order: OrderItem }>('/api/trade/cancel', { order_id }),

  orders: (status: 'all' | 'open' | 'filled' | 'cancelled' = 'all', limit = 50) =>
    alovaInstance.Get<{ items: OrderItem[] }>('/api/trade/orders', { params: { status, limit } }),

  trades: (limit = 50) => alovaInstance.Get<{ items: TradeItem[] }>('/api/trade/trades', { params: { limit } }),

  preview: (params: { code: string; side: 'buy' | 'sell'; quantity: number; price?: number }) =>
    alovaInstance.Get<TradePreview>('/api/trade/preview', { params }),
}

export const accountApi = {
  summary: () => alovaInstance.Get<AccountSummary>('/api/account/summary'),

  positions: () => alovaInstance.Get<{ items: PositionItem[] }>('/api/account/positions'),

  flows: (limit = 50) =>
    alovaInstance.Get<{
      items: Array<{ biz_type: string; amount: number; balance_after: number; remark: string; created_at: number }>
    }>('/api/account/flows', { params: { limit } }),

  // 业绩表现接口已随服务端一并删除（模拟盘从成交反推曲线既不准也无产品意义）

  /** 提交风险偏好测评：只上传原始答案与问卷版本，分数与等级由服务端复算 */
  setRisk: (payload: { version: number; answers: number[] }) =>
    alovaInstance.Post<{ risk: RiskProfile; version: number }>('/api/account/risk', payload),

  /** 读取当前风险偏好：assessed 由服务端的测评时间戳决定，重启后依然正确 */
  getRisk: () => alovaInstance.Get<RiskProfile>('/api/account/risk'),
}

/** 自选股：分组 + 成分 */
export const watchApi = {
  groups: () => alovaInstance.Get<{ items: WatchGroup[] }>('/api/watch/groups'),

  createGroup: (name: string) =>
    alovaInstance.Post<{ ok: boolean; group: WatchGroup; existed: boolean }>('/api/watch/groups', { name }),

  deleteGroup: (id: number) =>
    alovaInstance.Delete<{ ok: boolean; moved: number; fallback_group_id: number }>(`/api/watch/groups/${id}`),

  items: (group_id?: number) =>
    alovaInstance.Get<{ items: WatchItem[]; total: number }>('/api/watch/items', {
      params: group_id ? { group_id } : {},
    }),

  add: (code: string, group_id?: number) =>
    alovaInstance.Post<{ ok: boolean; watching: boolean; group_id: number; moved: boolean }>('/api/watch/items', {
      code,
      group_id,
    }),

  remove: (code: string) => alovaInstance.Delete<{ ok: boolean; watching: boolean }>(`/api/watch/items/${code}`),

  status: (code: string) =>
    alovaInstance.Get<{ code: string; watching: boolean; group_id: number }>(`/api/watch/status/${code}`),
}
