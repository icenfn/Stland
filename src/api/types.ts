/** 领域类型定义（与服务端 Pydantic 响应一一对应，避免 any 泛滥） */

export type Role = 'retail' | 'institution' | 'admin'
export type OrderSide = 'buy' | 'sell'
export type OrderStatus = 'pending' | 'partial' | 'filled' | 'cancelled' | 'rejected'

export interface UserProfile {
  id: number
  username: string
  display_name: string
  role: Role
  status?: string
  cash: number
  frozen_cash?: number
  market_value?: number
  total_asset: number
  realized_pnl?: number
  credit_limit?: number
  risk_level?: number
}

export interface Quote {
  code: string
  name: string
  price: number
  prev_close: number
  open: number
  high: number
  low: number
  volume: number
  amount: number
  change: number
  change_pct: number
  amplitude: number
  turnover_rate: number
  limit_up: number
  limit_down: number
  bid: number
  ask: number
  bid_volume: number
  ask_volume: number
  is_limit_up: boolean
  is_limit_down: boolean
  ts: number
  industry?: string
  board?: string
  hotword?: string
}

export interface StockMeta {
  code: string
  name: string
  board: string
  industry: string
  hotword: string
  theme: string
  tick_size: number
  lot_size: number
  limit_up: number
  limit_down: number
  total_shares: number
  float_shares: number
  is_st: boolean
}

export interface SessionState {
  phase: string
  label: string
  is_open: boolean
  can_trade: boolean
  trade_date: string
  seconds_left?: number
}

export interface IndexQuote {
  code: string
  name: string
  price: number
  prev_close: number
  open: number
  high: number
  low: number
  change: number
  change_pct: number
}

export interface Overview {
  index: IndexQuote
  index_minutes: Array<{ t: number; price: number }>
  stats: {
    tick: number
    listed: number
    up: number
    down: number
    flat: number
    total_amount: number
    index: IndexQuote
  }
  session: SessionState
  rank: {
    gainers: Quote[]
    losers: Quote[]
    active: Quote[]
  }
}

export interface DepthLevel {
  price: number
  volume: number
}

export interface Depth {
  code: string
  bids: DepthLevel[]
  asks: DepthLevel[]
}

export interface BarItem {
  time: number | string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface MinutePoint {
  t: number
  price: number
  volume: number
  avg: number
}

export interface OrderItem {
  id: number
  order_no: string
  code: string
  side: OrderSide
  order_type: 'limit' | 'market'
  price: number
  quantity: number
  filled_quantity: number
  avg_fill_price: number
  status: OrderStatus
  fee: number
  reject_reason: string
  created_at: number
  updated_at: number
}

export interface TradeItem {
  trade_no: string
  order_no?: string
  code: string
  side: OrderSide
  price: number
  quantity: number
  amount: number
  fee: number
  realized_pnl: number
  created_at: number
}

export interface PositionItem {
  code: string
  name: string
  quantity: number
  available: number
  frozen: number
  avg_cost: number
  last_price: number
  market_value: number
  unrealized_pnl: number
  unrealized_pct: number
  day_change_pct: number
  /** 服务端可能返回的持仓更新时间（秒级时间戳，展示前需经 toMillis 归一化） */
  updated_at?: number
  opened_at?: number
}

export interface AccountSummary {
  user: { id: number; username: string; display_name: string; role: Role; risk_level: number }
  asset: {
    cash: number
    frozen_cash: number
    market_value: number
    total_asset: number
    credit_limit: number
    realized_pnl: number
    fee_paid: number
    day_pnl: number
  }
  risk: {
    position_count: number
    concentration_hhi: number
    portfolio_beta: number
    cash_ratio: number
  }
}

export interface TradePreview {
  code: string
  side: OrderSide
  quantity: number
  effective_price: number
  estimated_avg_price: number
  fillable_quantity: number
  slippage_pct: number
  amount: number
  fee: { commission: number; stamp_tax: number; transfer_fee: number; total: number }
  max_buy_quantity: number
  available_cash: number
}
