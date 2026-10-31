/**
 * 指标计算：图表绘制与「副图读数」共用同一套实现。
 *
 * 为什么单独抽一个模块：副图标签（K:81.2↑ D:74.5↑ J:94.6↑）和副图画出来的线
 * 必须是同一组数值 —— 各算一遍迟早会因为参数或起始值不同而出现「标签和图形不一致」。
 * 这里只放纯函数，不依赖任何渲染环境，画布侧与文字侧都从这里取数。
 */

/** 副图种类。'none' 已随「不显示副图」按钮一并移除。 */
export type SubKind = 'volume' | 'macd' | 'kdj' | 'ratio' | 'game'

/** 副图选项，顺序即抽屉里的排列顺序 */
export const SUB_OPTIONS: Array<{ id: SubKind; label: string }> = [
  { id: 'volume', label: '成交量' },
  { id: 'macd', label: 'MACD' },
  { id: 'kdj', label: 'KDJ' },
  { id: 'ratio', label: '量比' },
  { id: 'game', label: '分时博弈' },
]

export interface SeriesInput {
  /** 收盘价（分时即逐点价格） */
  closes: number[]
  /** 最高价；分时视图没有，缺省用收盘价代替 */
  highs?: number[]
  /** 最低价；同上 */
  lows?: number[]
  /** 成交量（股） */
  vols?: number[]
}

/** 指数移动平均 */
export function ema(values: number[], period: number): number[] {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const out: number[] = [values[0]]
  for (let i = 1; i < values.length; i += 1) out.push(values[i] * k + out[i - 1] * (1 - k))
  return out
}

/** MACD（12, 26, 9）：DIF、DEA、柱（DIF−DEA 的两倍） */
export function macdOf(closes: number[]): { dif: number[]; dea: number[]; hist: number[] } {
  if (closes.length < 2) return { dif: [], dea: [], hist: [] }
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const dif = closes.map((_, i) => e12[i] - e26[i])
  const dea = ema(dif, 9)
  const hist = dif.map((d, i) => (d - dea[i]) * 2)
  return { dif, dea, hist }
}

/**
 * KDJ（9, 3, 3）。
 *
 * RSV = (C − LLV(L,9)) / (HHV(H,9) − LLV(L,9)) × 100
 * K = 2/3·K(前) + 1/3·RSV，D = 2/3·D(前) + 1/3·K，J = 3K − 2D
 *
 * 分时视图只有一条价格序列，最高/最低退化为价格本身，RSV 会贴死 0/100；
 * 因此分时下改用「最近 9 点价格区间」的相对位置，口径仍是收盘在区间中的位置。
 */
export function kdjOf(input: SeriesInput): { k: number[]; d: number[]; j: number[] } {
  const closes = input.closes
  const n = closes.length
  if (n < 3) return { k: [], d: [], j: [] }
  const highs = input.highs ?? closes
  const lows = input.lows ?? closes
  const K: number[] = []
  const D: number[] = []
  const J: number[] = []
  let k = 50
  let d = 50
  for (let i = 0; i < n; i += 1) {
    const from = Math.max(0, i - 8)
    let hh = -Infinity
    let ll = Infinity
    for (let j = from; j <= i; j += 1) {
      hh = Math.max(hh, highs[j])
      ll = Math.min(ll, lows[j])
    }
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100
    k = (2 / 3) * k + (1 / 3) * rsv
    d = (2 / 3) * d + (1 / 3) * k
    K.push(k)
    D.push(d)
    J.push(3 * k - 2 * d)
  }
  return { k: K, d: D, j: J }
}

/** 量比：本根量 ÷ 区间均量，基准线 1.0（区间均量口径，见图表注释） */
export function ratioOf(vols: number[]): number[] {
  if (vols.length < 2) return []
  const mean = vols.reduce((a, b) => a + b, 0) / vols.length
  if (!(mean > 0)) return []
  return vols.map((v) => (v || 0) / mean)
}

/** 分时博弈（估算）：相邻价格方向 × 成交量累计净额，附 5 点均值 */
export function netFlowOf(prices: number[], vols: number[]): { net: number[]; ma: number[] } {
  const n = Math.min(prices.length, vols.length)
  if (n < 2) return { net: [], ma: [] }
  const net: number[] = [0]
  for (let i = 1; i < n; i += 1) {
    const dir = Math.sign(prices[i] - prices[i - 1])
    net.push(net[i - 1] + dir * (vols[i] || 0))
  }
  const ma = net.map((_, i) => {
    const from = Math.max(0, i - 4)
    const slice = net.slice(from, i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
  return { net, ma }
}

/** 一段序列的「当前值 / 方向」，副图读数用 */
export interface Readout {
  /** 指标名，如 K、DIF */
  label: string
  /** 已格式化的数值 */
  value: string
  /** 与上一点相比的方向：1 上行 / -1 下行 / 0 持平 */
  dir: 1 | -1 | 0
}

function compact(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return v.toFixed(0)
}

function dirOf(series: number[]): 1 | -1 | 0 {
  const n = series.length
  if (n < 2) return 0
  const d = series[n - 1] - series[n - 2]
  return d > 0 ? 1 : d < 0 ? -1 : 0
}

function tailReadout(label: string, series: number[], digits: number): Readout {
  const n = series.length
  return {
    label,
    value: n ? series[n - 1].toFixed(digits) : '—',
    dir: dirOf(series),
  }
}

/**
 * 生成副图读数，例如 KDJ 下返回 K/D/J 三项。
 * 数值缺失时返回该指标名 + 破折号，界面不会因为数据未到而抖动。
 */
export function subReadout(kind: SubKind, input: SeriesInput): Readout[] {
  switch (kind) {
    case 'kdj': {
      const { k, d, j } = kdjOf(input)
      return [tailReadout('K', k, 1), tailReadout('D', d, 1), tailReadout('J', j, 1)]
    }
    case 'macd': {
      const { dif, dea } = macdOf(input.closes)
      return [tailReadout('DIF', dif, 3), tailReadout('DEA', dea, 3)]
    }
    case 'ratio': {
      const r = ratioOf(input.vols ?? [])
      return [tailReadout('量比', r, 2)]
    }
    case 'game': {
      const { net } = netFlowOf(input.closes, input.vols ?? [])
      const n = net.length
      return [
        {
          label: '净流',
          value: n ? compact(net[n - 1]) : '—',
          dir: dirOf(net),
        },
      ]
    }
    case 'volume': {
      const vols = input.vols ?? []
      const n = vols.length
      return [
        {
          label: '量',
          value: n ? compact(vols[n - 1]) : '—',
          dir: dirOf(vols),
        },
      ]
    }
    default:
      return []
  }
}
