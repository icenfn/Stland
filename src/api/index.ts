/** 接口聚合层：所有请求集中在此，便于统一签名、错误处理与类型约束 */
import { alovaInstance } from './http'
import type {
  AccountSummary,
  BarItem,
  Depth,
  MinutePoint,
  OrderItem,
  Overview,
  PositionItem,
  Quote,
  SessionState,
  StockMeta,
  TradeItem,
  TradePreview,
  UserProfile,
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

  index: () =>
    alovaInstance.Get<{ quote: any; minutes: Array<{ t: number; price: number }>; stats: any }>('/api/market/index'),

  search: (q: string) =>
    alovaInstance.Get<{ items: Array<{ code: string; name: string; industry: string; hotword: string }> }>(
      '/api/market/search',
      { params: { q } },
    ),
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
    alovaInstance.Get<{ items: Array<{ biz_type: string; amount: number; balance_after: number; remark: string; created_at: number }> }>(
      '/api/account/flows',
      { params: { limit } },
    ),

  performance: () =>
    alovaInstance.Get<{
      curve: Array<{ t: number; equity: number }>
      metrics: {
        total_return_pct: number
        realized_pnl: number
        fee_paid: number
        sharpe: number
        max_drawdown_pct: number
        win_rate_pct: number
        trade_count: number
      }
    }>('/api/account/performance'),

  setRisk: (risk_level: number) => alovaInstance.Post<{ risk_level: number }>('/api/account/risk', { risk_level }),

  reset: () => alovaInstance.Post<{ ok: boolean; cash: number }>('/api/account/reset', {}),
}
