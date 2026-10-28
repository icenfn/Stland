/** 格式化工具：A 股显示习惯（红涨绿跌、万/亿单位、成交量手数） */

export function fmtPrice(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '--'
  return value.toFixed(digits)
}

/** 涨跌幅：带符号百分号 */
export function fmtPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

/** 金额压缩：1.23 亿 / 4567.8 万 */
export function fmtAmount(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return value.toFixed(2)
}

/**
 * 不带单位的金额：千分位分隔的纯数字。
 *
 * 资产页按要求改为「直接显示数字」—— 原来的万/亿压缩虽然省字，
 * 但用户核对「我到底有多少钱」时必须心算还原，反而更费劲。
 * 金额是精确量，不是需要被压缩的观测量，所以这里给完整数值 + 千分位。
 */
export function fmtMoney(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '--'
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** 带符号的金额（盈亏用）：+12,345.67 / -890.00 */
export function fmtSignedMoney(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${fmtMoney(value, digits)}`
}

/** 成交量：股 → 手（1 手 = 100 股） */
export function fmtVolume(shares: number): string {
  if (!Number.isFinite(shares)) return '--'
  const hands = shares / 100
  if (hands >= 1e4) return `${(hands / 1e4).toFixed(2)}万手`
  return `${Math.round(hands)}手`
}

/** 价格方向 → 语义色（A 股：红涨绿跌，与欧美相反） */
export function trendClass(value: number): string {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

/**
 * 时间戳归一化（秒 / 毫秒两种来源都统一成毫秒）。
 *
 * 服务端全部时间戳来自 Python 的 time.time()，即「秒」，带小数；
 * 而部分行情快照会带毫秒。此前直接把秒当毫秒解析，
 * 于是 2026 年的委托时间被显示成 1970 年 —— 这就是「时间显示错误」的根因。
 * 这里按数量级判定：小于 1e11 的一律视为秒，其余视为毫秒。
 */
export function toMillis(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0
  // 1e11 秒 ≈ 5138 年，1e11 毫秒 ≈ 1973 年：任何真实时间戳只会落在其中一侧
  return ts < 1e11 ? Math.round(ts * 1000) : Math.round(ts)
}

export function fmtTime(ts: number): string {
  const ms = toMillis(ts)
  if (!ms) return '--'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function fmtDateTime(ts: number): string {
  const ms = toMillis(ts)
  if (!ms) return '--'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 相对时间：刚刚 / 12 秒前 / 3 分钟前（用于「行情更新于」提示） */
export function fmtAgo(ts: number, now = Date.now()): string {
  const ms = toMillis(ts)
  if (!ms) return '--'
  const diff = Math.max(0, Math.round((now - ms) / 1000))
  if (diff < 2) return '刚刚'
  if (diff < 60) return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  return fmtDateTime(ts)
}

/** 股票代码 → 展示用板块标签 */
export function boardLabel(code: string): string {
  if (code.startsWith('688')) return '科创'
  if (code.startsWith('300')) return '创业'
  if (code.startsWith('600') || code.startsWith('601') || code.startsWith('603')) return '沪A'
  if (code.startsWith('000') || code.startsWith('002')) return '深A'
  return 'A股'
}

export function sideLabel(side: string): string {
  return side === 'buy' ? '买入' : '卖出'
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '已报',
    partial: '部成',
    filled: '已成',
    cancelled: '已撤',
    rejected: '废单',
  }
  return map[status] ?? status
}
