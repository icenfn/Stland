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

export function fmtTime(ts: number): string {
  if (!ts) return '--'
  const d = new Date(ts < 1e12 ? ts * 1000 : ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function fmtDateTime(ts: number): string {
  if (!ts) return '--'
  const d = new Date(ts < 1e12 ? ts * 1000 : ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
