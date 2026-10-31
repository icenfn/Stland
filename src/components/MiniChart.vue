<script lang="ts">
/**
 * 副图种类：图表组件与两个详情页都要用，因此放在普通 script 块里导出。
 * `<script setup>` 内不允许 export，独立声明块才能被外部 import type。
 */
export type SubKind = 'volume' | 'macd' | 'kdj' | 'ratio' | 'game'
</script>

<script setup lang="ts">
/**
 * 轻量 K 线 / 分时 / 指标绘制：Canvas 手绘，避免引入 ECharts 的体积
 * （移动端首屏体积是硬约束，一张图不值得几百 KB）。
 *
 * 时间轴口径
 * ----------
 * 横坐标一律用「时间位」而不是「点数」：一天固定 240 个分钟位
 * （9:30–11:30 + 13:00–15:00），已经走到的部分从左往右画，未走到的分钟位留白。
 * 若按 `i / (n - 1) * w` 归一，开盘二十分钟只有二十来个点，这一小段会被横向
 * 拉满整幅图 —— 看起来像「全天走完」，既读不出当前走到一天里的什么位置，
 * 也看不出后半段还是空白。五日视图按每天 240 位依次排布并画日分隔线。
 *
 * 横轴刻度由 `part="axis"` 单独渲染，交给 K 线组件贴在副图正下方，
 * 这样刻度与主图/副图共用同一套时间位，三者永远对齐。
 *
 * 副图口径
 * --------
 * volume 成交量、macd MACD、kdj KDJ、ratio 量比、game 分时博弈。
 * 除「分时博弈」外都是公开的标准算法，按常规参数实现：
 *   MACD 12/26/9；KDJ 9/3/3；量比 = 本根量 ÷ 本区间均量。
 * 「分时博弈」需要逐笔的主动买卖方向，服务端没有下发该数据，因此用
 * 「相邻两点价格方向 × 该点成交量」估算净流入并累计，再叠一条均值线。
 * 它是量价方向的近似，不等同券商的分时博弈（那是按单笔金额分档统计的），
 * 这一点在界面上以「估算」提示，避免误读。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** 交易时段标签，与服务端 BarItem.segment 对齐 */
type Segment = 'pre' | 'auction' | 'continuous' | 'lunch' | 'post' | 'closed'

interface Point {
  t: number
  price: number
  /** 分时均价；K 线数据没有该字段，因此可选 */
  avg?: number
  /** 分时逐点成交量（股） */
  volume?: number
  /** 该点所属时段，用于给竞价/盘前/盘后区间打底色 */
  segment?: Segment
  /** 该点所属交易日（仅五日视图下发） */
  day?: string
}
interface Bar {
  time: number | string
  open: number
  high: number
  low: number
  close: number
  volume: number
  segment?: Segment
}

/** 一整个交易日的分钟位数：9:30–11:30 + 13:00–15:00 = 240 */
const MINUTES_PER_DAY = 240

/**
 * 非连续竞价时段的底色。
 *
 * 为什么不动红绿柱本身：红绿是「涨跌」的唯一编码，改掉就分不清方向了。
 * 用整列半透明底色标注时段，既能看出「这段是集合竞价 / 盘前 / 盘后」，
 * 也不与涨跌信息打架。连续竞价不画底色，保持画面干净。
 */
const SEGMENT_TINT: Record<string, string> = {
  pre: 'rgba(96,140,255,0.14)',
  auction: 'rgba(232,179,57,0.16)',
  post: 'rgba(150,120,240,0.14)',
  closed: 'rgba(140,150,165,0.08)',
}

interface Timeline {
  /** 每个点对应的时间位序号 */
  pos: number[]
  /** 时间位总数，即横轴满格长度 */
  cap: number
  /** 每天的起始时间位（五日画分隔线用） */
  dayStarts: Array<{ day: string; pos: number }>
}

function buildTimeline(pts: Point[], multiDay: boolean, slots: number): Timeline {
  if (!multiDay) {
    const cap = slots > 0 ? slots : MINUTES_PER_DAY
    return { pos: pts.map((_, i) => i), cap, dayStarts: [] }
  }
  const pos: number[] = []
  const dayStarts: Array<{ day: string; pos: number }> = []
  let dayIndex = -1
  let lastDay = ''
  let within = 0
  for (const p of pts) {
    const d = p.day ?? ''
    if (d !== lastDay) {
      lastDay = d
      dayIndex += 1
      within = 0
      dayStarts.push({ day: d, pos: dayIndex * MINUTES_PER_DAY })
    }
    pos.push(dayIndex * MINUTES_PER_DAY + within)
    within += 1
  }
  const cap = Math.max(1, (dayIndex + 1) * MINUTES_PER_DAY)
  return { pos, cap, dayStarts }
}

const props = withDefaults(
  defineProps<{
    minutes?: Point[]
    bars?: Bar[]
    mode?: 'minute' | 'kline'
    /** 副图类型；axis 模式不需要该字段 */
    sub?: SubKind
    prevClose?: number
    height?: number
    /**
     * 渲染哪一块：
     *  all  主图 + 副图同画布（默认）
     *  main 只画主图（与副图拆成两个 canvas，副图选项条才能落在两者之间）
     *  sub  只画副图
     *  axis 只画横轴刻度
     */
    part?: 'all' | 'main' | 'sub' | 'axis'
    /** 五日视图：分时点带 day 字段时启用，按日画分隔线与当日基准虚线 */
    multiDay?: boolean
    /** 时间位总数；0 表示按「一天 240 位」自动推断 */
    slots?: number
    /** 当前 K 线周期（1min/5min/day/week/month…），只用于横轴刻度格式 */
    period?: string
  }>(),
  {
    mode: 'minute',
    sub: 'macd',
    prevClose: 0,
    height: 200,
    part: 'all',
    multiDay: false,
    slots: 0,
    period: 'day',
    minutes: () => [],
    bars: () => [],
  },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ro: ResizeObserver | null = null

const UP = '#ff4d4f'
const DOWN = '#12b76a'
const LINE_GOLD = '#e8b339'
const LINE_BLUE = '#7aa9ff'

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2)
}

/** 稀疏网格：只画几条参考线，避免把副图区域切碎 */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let i = 1; i < 4; i += 1) {
    const y = (h / 4) * i
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  for (let i = 1; i < 3; i += 1) {
    const x = (w / 3) * i
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
}

/** 按时段铺底色：按时间位算列宽，同一段只有几分钟也不会被拉宽 */
function paintSegments(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  segments: Array<Segment | undefined>,
  pos: number[],
  cap: number,
) {
  const n = segments.length
  if (!n) return
  const slot = w / Math.max(1, cap)
  let start = 0
  while (start < n) {
    const seg = segments[start]
    let end = start
    while (end + 1 < n && segments[end + 1] === seg) end += 1
    const tint = seg ? SEGMENT_TINT[seg] : undefined
    if (tint) {
      ctx.fillStyle = tint
      const x0 = pos[start] * slot
      const x1 = (pos[end] + 1) * slot
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h)
    }
    start = end + 1
  }
}

/** 主图：分时走势（横轴为时间位，未走到的分钟位留白） */
function drawMinute(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const pts = props.minutes ?? []
  if (!pts.length) return
  const tl = buildTimeline(pts, props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)
  const xOf = (i: number) => tl.pos[i] * slot + slot / 2

  const base = props.prevClose || pts[0].price
  const maxDev = Math.max(...pts.map((p) => Math.abs(p.price - base)), base * 0.005)
  const hi = base + maxDev
  const lo = base - maxDev
  const yOf = (p: number) => h - ((p - lo) / (hi - lo || 1)) * h

  paintSegments(ctx, w, h, pts.map((p) => p.segment), tl.pos, tl.cap)

  // 昨收虚线
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, yOf(base))
  ctx.lineTo(w, yOf(base))
  ctx.stroke()
  ctx.setLineDash([])

  // 五日：日分隔线 + 当日基准虚线
  if (props.multiDay && tl.dayStarts.length) {
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1
    for (const d of tl.dayStarts) {
      if (d.pos === 0) continue
      const x = d.pos * slot
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    ctx.setLineDash([3, 4])
    ctx.strokeStyle = 'rgba(232,179,57,0.35)'
    const seen = new Set<string>()
    pts.forEach((p, i) => {
      const d = p.day ?? ''
      if (seen.has(d)) return
      seen.add(d)
      const y = yOf(p.price)
      ctx.beginPath()
      ctx.moveTo(xOf(i), y)
      ctx.lineTo(w, y)
      ctx.stroke()
    })
    ctx.setLineDash([])
  }

  const last = pts[pts.length - 1].price
  const rising = last >= base
  const color = rising ? UP : DOWN
  const lastX = xOf(pts.length - 1)

  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, rising ? 'rgba(255,77,79,0.28)' : 'rgba(18,183,106,0.28)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.beginPath()
  ctx.moveTo(xOf(0), h)
  pts.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.price)))
  ctx.lineTo(lastX, h)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  // 均价线
  const avgs = pts.map((p, i) => ({ i, v: p.avg })).filter((a) => typeof a.v === 'number' && a.v > 0)
  if (avgs.length) {
    ctx.beginPath()
    avgs.forEach((a, k) => {
      const x = xOf(a.i)
      const y = yOf(a.v as number)
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = LINE_GOLD
    ctx.lineWidth = 1
    ctx.stroke()
  }

  ctx.beginPath()
  pts.forEach((p, i) => {
    const x = xOf(i)
    const y = yOf(p.price)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(lastX, yOf(last), 3, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/** 主图：K 线（一根就是一根，等距排布，不涉及「一天 240 位」） */
function drawKline(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bars = props.bars ?? []
  if (!bars.length) return
  const hi = Math.max(...bars.map((b) => b.high))
  const lo = Math.min(...bars.map((b) => b.low))
  const span = hi - lo || 1
  const yOf = (p: number) => h - ((p - lo) / span) * h
  const slot = w / bars.length
  const bodyW = Math.max(1.5, slot * 0.62)

  paintSegments(
    ctx,
    w,
    h,
    bars.map((b) => b.segment),
    bars.map((_, i) => i),
    bars.length,
  )

  bars.forEach((b, i) => {
    const x = slot * i + slot / 2
    const rising = b.close >= b.open
    ctx.strokeStyle = rising ? UP : DOWN
    ctx.fillStyle = rising ? UP : DOWN
    ctx.beginPath()
    ctx.moveTo(x, yOf(b.high))
    ctx.lineTo(x, yOf(b.low))
    ctx.lineWidth = 1
    ctx.stroke()
    const y1 = yOf(Math.max(b.open, b.close))
    const y2 = yOf(Math.min(b.open, b.close))
    ctx.fillRect(x - bodyW / 2, y1, bodyW, Math.max(1, y2 - y1))
  })
}

/** 副图：成交量 —— 颜色跟随当根涨跌，高度按区间最大量归一 */
function drawVolume(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (props.mode === 'kline') {
    const bars = props.bars ?? []
    const n = bars.length
    if (!n) return
    const maxV = Math.max(...bars.map((b) => b.volume || 0), 1)
    const slot = w / n
    const barW = Math.max(1, slot * 0.62)
    bars.forEach((b, i) => {
      const bh = ((b.volume || 0) / maxV) * (h - 1)
      ctx.fillStyle = b.close >= b.open ? 'rgba(255,77,79,0.75)' : 'rgba(18,183,106,0.75)'
      const x = slot * i + (slot - barW) / 2
      ctx.fillRect(x, h - bh, barW, Math.max(1, bh))
    })
    return
  }

  const pts = props.minutes ?? []
  if (!pts.length) return
  const tl = buildTimeline(pts, props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)
  const maxV = Math.max(...pts.map((p) => p.volume || 0), 1)
  const barW = Math.max(1, slot * 0.62)

  pts.forEach((p, i) => {
    const v = p.volume || 0
    const bh = (v / maxV) * (h - 1)
    const prev = i === 0 ? props.prevClose || p.price : pts[i - 1].price
    ctx.fillStyle = p.price >= prev ? 'rgba(255,77,79,0.75)' : 'rgba(18,183,106,0.75)'
    ctx.fillRect(tl.pos[i] * slot + (slot - barW) / 2, h - bh, barW, Math.max(1, bh))
  })
}

/** 指数移动平均：MACD / 均线共用 */
function ema(values: number[], period: number): number[] {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const out: number[] = [values[0]]
  for (let i = 1; i < values.length; i += 1) out.push(values[i] * k + out[i - 1] * (1 - k))
  return out
}

/** 当前副图所依据的收盘序列与横坐标 */
function seriesBasis(): { closes: number[]; pos: number[]; cap: number } | null {
  if (props.mode === 'kline') {
    const bars = props.bars ?? []
    if (!bars.length) return null
    return { closes: bars.map((b) => b.close), pos: bars.map((_, i) => i), cap: bars.length }
  }
  const pts = props.minutes ?? []
  if (!pts.length) return null
  const tl = buildTimeline(pts, props.multiDay, props.slots)
  return { closes: pts.map((p) => p.price), pos: tl.pos, cap: tl.cap }
}

/** 副图：MACD —— DIF/DEA 双线 + 红绿柱，零轴居中对称 */
function drawMacd(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const basis = seriesBasis()
  if (!basis || basis.closes.length < 2) return
  const { closes, pos, cap } = basis
  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const dif = closes.map((_, i) => e12[i] - e26[i])
  const dea = ema(dif, 9)
  const hist = dif.map((d, i) => (d - dea[i]) * 2)

  const absMax = Math.max(...dif.map(Math.abs), ...dea.map(Math.abs), ...hist.map(Math.abs), 1e-4)
  const zero = h / 2
  const yOf = (v: number) => zero - (v / absMax) * (h / 2 - 1)
  const slot = w / Math.max(1, cap)
  const xOf = (i: number) => pos[i] * slot + slot / 2

  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, zero)
  ctx.lineTo(w, zero)
  ctx.stroke()

  const barW = Math.max(1, slot * 0.55)
  hist.forEach((v, i) => {
    ctx.fillStyle = v >= 0 ? 'rgba(255,77,79,0.8)' : 'rgba(18,183,106,0.8)'
    const y2 = yOf(v)
    ctx.fillRect(xOf(i) - barW / 2, Math.min(zero, y2), barW, Math.max(1, Math.abs(y2 - zero)))
  })

  const line = (vals: number[], color: string) => {
    ctx.beginPath()
    vals.forEach((v, i) => {
      const x = xOf(i)
      const y = yOf(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
  line(dif, LINE_GOLD)
  line(dea, LINE_BLUE)
}

/**
 * 副图：KDJ（9,3,3 常规参数）。
 *
 * RSV = (C - LLV(L,9)) / (HHV(H,9) - LLV(L,9)) × 100
 * K = 2/3·K(前) + 1/3·RSV，D = 2/3·D(前) + 1/3·K，J = 3K - 2D
 *
 * K 线用真实高低价；分时只有一个价格序列，高低价退化为该点价格本身，
 * 此时 RSV 会贴近 0/100 两端 —— 所以分时下改用价格在最近 9 点区间内的
 * 相对位置来算 RSV，仍是同一口径（收盘价在区间中的位置），只是区间由
 * 「最高最低」换成了「9 点价格区间」。
 */
function drawKdj(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const basis = seriesBasis()
  if (!basis || basis.closes.length < 3) return
  const { closes, pos, cap } = basis
  const n = closes.length
  const isK = props.mode === 'kline'
  const highs = isK ? (props.bars ?? []).map((b) => b.high) : closes
  const lows = isK ? (props.bars ?? []).map((b) => b.low) : closes

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

  // 纵轴固定 0–100，J 可能越界，按实际范围放宽以免折线出画
  const lo = Math.min(0, ...J)
  const hi = Math.max(100, ...J)
  const yOf = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h
  const slot = w / Math.max(1, cap)
  const xOf = (i: number) => pos[i] * slot + slot / 2

  // 20/50/80 三条参考线：超卖 / 中轴 / 超买
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  for (const lv of [20, 50, 80]) {
    ctx.strokeStyle = lv === 50 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.09)'
    ctx.beginPath()
    ctx.moveTo(0, yOf(lv))
    ctx.lineTo(w, yOf(lv))
    ctx.stroke()
  }
  ctx.setLineDash([])

  const line = (vals: number[], color: string) => {
    ctx.beginPath()
    vals.forEach((v, i) => {
      const x = xOf(i)
      const y = yOf(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
  line(K, LINE_GOLD)
  line(D, LINE_BLUE)
  line(J, 'rgba(200,140,255,0.9)')
}

/**
 * 副图：量比。
 *
 * 口径：这一根的量 ÷ 本区间每根的平均量，基准线 1.0。
 * 为什么以「本区间均量」为基准：客户端手上只有当前这一屏的序列，没有过去
 * 5 日每分钟均量；而量比要回答的本来就是「此刻的量相对常态是放大还是萎缩」，
 * 用本区间均量同样能看出放量/缩量，且换周期不失真。
 */
function drawRatio(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const isK = props.mode === 'kline'
  const vols = isK
    ? (props.bars ?? []).map((b) => b.volume || 0)
    : (props.minutes ?? []).map((p) => p.volume || 0)
  const n = vols.length
  if (n < 2) return
  const mean = vols.reduce((a, b) => a + b, 0) / n
  if (!(mean > 0)) return

  const ratios = vols.map((v) => v / mean)
  const top = Math.max(...ratios, 1.15)
  const yOf = (r: number) => h - 2 - (r / top) * (h - 4)

  const tl = isK
    ? { pos: vols.map((_, i) => i), cap: n }
    : buildTimeline(props.minutes ?? [], props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)
  const xOf = (i: number) => tl.pos[i] * slot + slot / 2

  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, yOf(1))
  ctx.lineTo(w, yOf(1))
  ctx.stroke()
  ctx.setLineDash([])

  ctx.beginPath()
  ratios.forEach((r, i) => {
    const x = xOf(i)
    const y = yOf(r)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  const last = ratios[n - 1]
  ctx.strokeStyle = last >= 1 ? LINE_GOLD : LINE_BLUE
  ctx.lineWidth = 1.2
  ctx.stroke()
}

/**
 * 副图：分时博弈（估算）。
 *
 * 真实的分时博弈是按逐笔成交金额分档（大单/中单/小单）统计主动买卖方向，
 * 需要逐笔数据。服务端只下发分钟级价格与成交量，拿不到主动买卖标记，
 * 因此这里用可得的量价信息做一个方向估计：
 *   相邻两点价格上行 → 该点成交量计入「净流入」，下行为「净流出」，
 *   持平时按买卖各半（净额 0）处理；
 * 再把净额按累计求和，得到一条从开盘起算的净流入曲线，并叠一条 5 点均值线。
 * 它只能表达「量价配合的方向与强度」，不等于真实的主力资金流，
 * 界面上标注「估算」以免被当成精确资金流。
 */
function drawGame(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const isK = props.mode === 'kline'
  const prices = isK
    ? (props.bars ?? []).map((b) => b.close)
    : (props.minutes ?? []).map((p) => p.price)
  const vols = isK
    ? (props.bars ?? []).map((b) => b.volume || 0)
    : (props.minutes ?? []).map((p) => p.volume || 0)
  const n = prices.length
  if (n < 2) return

  const net: number[] = [0]
  for (let i = 1; i < n; i += 1) {
    const dir = Math.sign(prices[i] - prices[i - 1])
    net.push(net[i - 1] + dir * (vols[i] || 0))
  }
  const ma: number[] = net.map((_, i) => {
    const from = Math.max(0, i - 4)
    const slice = net.slice(from, i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })

  const all = [...net, ...ma]
  const hi = Math.max(...all, 1)
  const lo = Math.min(...all, -1)
  const yOf = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h

  const tl = isK
    ? { pos: prices.map((_, i) => i), cap: n }
    : buildTimeline(props.minutes ?? [], props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)
  const xOf = (i: number) => tl.pos[i] * slot + slot / 2

  // 零轴：以上为净流入，以下为净流出
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, yOf(0))
  ctx.lineTo(w, yOf(0))
  ctx.stroke()
  ctx.setLineDash([])

  // 净流入区域填充：以零轴为基线，正负两侧分色
  ctx.beginPath()
  ctx.moveTo(xOf(0), yOf(0))
  net.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)))
  ctx.lineTo(xOf(n - 1), yOf(0))
  ctx.closePath()
  ctx.fillStyle = 'rgba(232,179,57,0.14)'
  ctx.fill()

  const line = (vals: number[], color: string, width: number) => {
    ctx.beginPath()
    vals.forEach((v, i) => {
      const x = xOf(i)
      const y = yOf(v)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
  }
  line(net, LINE_GOLD, 1.4)
  line(ma, 'rgba(200,140,255,0.9)', 1)
}

/** 把一根 K 线的时间转成刻度文字 */
const INTRADAY_PERIODS = new Set(['1min', '5min', '15min', '30min', '60min', '120min'])

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 把柱子时间解析成各字段；字符串与秒/毫秒时间戳都支持 */
function parseBarTime(t: number | string): {
  y: number
  mo: number
  d: number
  hh: number
  mi: number
} | null {
  if (typeof t === 'string') {
    const m = t.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
    if (!m) return null
    return {
      y: Number(m[1]),
      mo: Number(m[2]),
      d: Number(m[3]),
      hh: m[4] ? Number(m[4]) : 0,
      mi: m[5] ? Number(m[5]) : 0,
    }
  }
  const ms = t > 1e12 ? t : t * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mi: d.getMinutes() }
}

/**
 * 一根柱子的横轴文字，按周期取不同粒度：
 *   日内周期 → 时:分        （5分/15分/60分… 用同一格式，读者只需知道「这是几点」）
 *   日 / 周  → 月/日        （同一屏很少跨年，写年份会挤掉真正有用的信息）
 *   月 / 季  → 年/月
 *   年       → 年
 */
function barLabel(t: number | string, period: string): string {
  const p = parseBarTime(t)
  if (!p) return typeof t === 'string' ? t : ''
  if (INTRADAY_PERIODS.has(period)) return `${pad2(p.hh)}:${pad2(p.mi)}`
  if (period === 'month' || period === 'quarter') return `${p.y}/${pad2(p.mo)}`
  if (period === 'year') return String(p.y)
  return `${pad2(p.mo)}/${pad2(p.d)}`
}

/**
 * 横轴刻度：贴着副图下方渲染，刻度位置与主图/副图共用同一套时间位。
 *
 * 刻度密度按「可用宽度」反推，而不是写死 4~5 个：
 *   屏幕窄、或者标签本身变长（月/季周期写「2026/10」）时自动减少刻度，
 *   否则最右和最左的文字会互相压住。取点时首尾固定包含，保证能读到区间端点；
 *   相邻标签文字相同的直接跳过（日线跨月时可能出现两个「10/01」）。
 */
function drawAxis(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.font = '10px -apple-system, "PingFang SC", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.42)'
  ctx.textBaseline = 'middle'
  const mid = h / 2 + 0.5

  if (props.mode === 'kline') {
    const bars = props.bars ?? []
    const n = bars.length
    if (!n) return
    const period = props.period || 'day'
    // 每个刻度至少占 52px，最多 5 个，最少 2 个
    const want = Math.max(2, Math.min(5, Math.floor(w / 52) + 1))
    const slot = w / n
    const idxs: number[] = []
    for (let k = 0; k < want; k += 1) idxs.push(Math.round((k / (want - 1)) * (n - 1)))

    let last = ''
    idxs.forEach((i, k) => {
      const bar = bars[i]
      if (!bar) return
      const label = barLabel(bar.time, period)
      if (!label || label === last) return
      last = label
      const first = k === 0
      const lastOne = k === idxs.length - 1
      ctx.textAlign = first ? 'left' : lastOne ? 'right' : 'center'
      // 首尾贴边显示，避免文字被裁掉半个字
      ctx.fillText(label, first ? 0 : lastOne ? w : slot * (i + 0.5), mid)
    })
    return
  }

  const pts = props.minutes ?? []
  if (!pts.length) return
  const tl = buildTimeline(pts, props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)

  if (props.multiDay) {
    // 五日：每天标一次日期，写在日分隔线右侧
    const marks = tl.dayStarts
    const step = marks.length > 3 && w < 320 ? 2 : 1
    marks.forEach((d, k) => {
      if (k % step !== 0) return
      const label = d.day ? d.day.slice(5) : ''
      if (!label) return
      const first = k === 0
      ctx.textAlign = first ? 'left' : 'center'
      ctx.fillText(label, first ? 0 : d.pos * slot + 3, mid)
    })
    return
  }

  // 单日：五个固定时间位。11:30 与 13:00 是同一位置（午休不占分钟位），
  // 因此合并写成「11:30/13:00」。窄屏只留开盘 / 午间 / 收盘三个，
  // 中间两个在 320px 以下必然互相压字。
  const ticks: Array<{ pos: number; label: string }> = [
    { pos: 0, label: '9:30' },
    { pos: 60, label: '10:30' },
    { pos: 120, label: '11:30/13:00' },
    { pos: 180, label: '14:00' },
    { pos: MINUTES_PER_DAY - 1, label: '15:00' },
  ]
  const shown = w < 300 ? [ticks[0], ticks[2], ticks[4]] : ticks
  shown.forEach((t, k) => {
    const first = k === 0
    const lastOne = k === shown.length - 1
    ctx.textAlign = first ? 'left' : lastOne ? 'right' : 'center'
    const x = t.pos * slot + slot / 2
    ctx.fillText(t.label, first ? 0 : lastOne ? w : x, mid)
  })
}

function drawSub(ctx: CanvasRenderingContext2D, w: number, h: number) {
  switch (props.sub) {
    case 'volume':
      drawVolume(ctx, w, h)
      break
    case 'kdj':
      drawKdj(ctx, w, h)
      break
    case 'ratio':
      drawRatio(ctx, w, h)
      break
    case 'game':
      drawGame(ctx, w, h)
      break
    case 'macd':
      drawMacd(ctx, w, h)
      break
    default:
      break
  }
}

function render() {
  const el = canvasRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  // 布局尚未稳定（宽度为 0，例如抽屉开合过程中的一帧）时直接跳过：
  // 此时把 canvas 尺寸写成 1px 会清空 backing store，等下一帧再按真实尺寸
  // 重画，用户看到的就是「K 线闪一下」。
  if (rect.width < 1 || rect.height < 1) return
  const ratio = dpr()
  const w = Math.max(1, Math.floor(rect.width * ratio))
  const h = Math.max(1, Math.floor(rect.height * ratio))
  // 只有尺寸真的变了才重新赋值：给 canvas.width 赋同样的值也会清空画布并
  // 触发一次重绘，ResizeObserver 在亚像素变化下会连续回调，表现为闪白。
  if (el.width !== w) el.width = w
  if (el.height !== h) el.height = h
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  const W = rect.width
  const H = rect.height
  ctx.clearRect(0, 0, W, H)

  // 横轴：不画网格，只画刻度文字
  if (props.part === 'axis') {
    drawAxis(ctx, W, H)
    return
  }

  // 主图与副图拆成两块独立 canvas 时，各自占满自己的高度，
  // 中间由模板插入「副图名称按钮」。
  if (props.part === 'main') {
    drawGrid(ctx, W, H)
    if (props.mode === 'kline') drawKline(ctx, W, H)
    else drawMinute(ctx, W, H)
    return
  }
  if (props.part === 'sub') {
    drawSub(ctx, W, H)
    return
  }

  // all：同一块画布上下分区
  // 副图始终存在（「不显示副图」已移除），主副图按 7:3 固定分配高度
  const gap = 5
  const subH = Math.round((H - gap) * 0.3)
  const mainH = H - subH - gap

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, mainH)
  ctx.clip()
  drawGrid(ctx, W, mainH)
  if (props.mode === 'kline') drawKline(ctx, W, mainH)
  else drawMinute(ctx, W, mainH)
  ctx.restore()

  // 主图与副图之间的分隔线（「不显示副图」已移除，副图始终存在）
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, mainH + gap / 2)
  ctx.lineTo(W, mainH + gap / 2)
  ctx.stroke()

  const subTop = mainH + gap
  ctx.save()
  ctx.translate(0, subTop)
  ctx.beginPath()
  ctx.rect(0, 0, W, subH)
  ctx.clip()
  drawSub(ctx, W, subH)
  ctx.restore()
}

onMounted(() => {
  render()
  if (canvasRef.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => render())
    ro.observe(canvasRef.value)
  }
  window.addEventListener('resize', render)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', render)
})

watch(
  () => [props.minutes, props.bars, props.mode, props.sub, props.part, props.multiDay, props.slots, props.height],
  () => render(),
  { deep: true },
)
</script>

<template>
  <canvas ref="canvasRef" class="mini-chart" :style="{ height: height + 'px' }" />
</template>

<style scoped>
.mini-chart {
  width: 100%;
  display: block;
}
</style>
