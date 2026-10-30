<script setup lang="ts">
/**
 * 轻量 K 线/分时绘制：Canvas 手绘，避免引入 ECharts 体积（移动端首屏更关键）。
 *
 * 副图（本轮新增）：主图下方可按需切换「成交量」或「MACD」。
 * 为什么做成副图而不是叠加：量能与指标的价值在于「和价格对照着看」，
 * 叠在价格上会互相压线；副图固定占 30% 高度，价格轴与副图轴各自独立缩放，
 * 两条图共享同一 X 轴刻度，扫一眼就能对齐「哪根阳线放量 / 哪段 DIF 上穿」。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** 交易时段标签，与服务端 BarItem.segment 对齐 */
type Segment = 'pre' | 'auction' | 'continuous' | 'lunch' | 'post' | 'closed'

interface Point {
  t: number
  price: number
  /** 分时均价；K 线数据没有该字段，因此可选 */
  avg?: number
  /** 分时逐点成交量（股），用于成交量副图 */
  volume?: number
  /** 该点所属时段，用于给竞价/盘前/盘后区间打底色 */
  segment?: Segment
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

/**
 * 非连续竞价时段的底色。
 *
 * 为什么不改变红绿柱本身：红绿是「涨跌」的唯一编码，改掉就分不清方向了。
 * 用整列半透明底色标注时段，既能看出「这段是集合竞价 / 盘前 / 盘后」，
 * 又不会和涨跌信息打架。连续竞价不画底色，保持画面干净。
 */
const SEGMENT_TINT: Record<string, string> = {
  pre: 'rgba(96,140,255,0.14)',
  auction: 'rgba(232,179,57,0.16)',
  post: 'rgba(150,120,240,0.14)',
  closed: 'rgba(140,150,165,0.08)',
}

/** 在给定几何参数下，把相邻同段落的区间铺一层底色 */
function paintSegments(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  segments: Array<Segment | undefined>,
) {
  const n = segments.length
  if (!n) return
  const slot = w / n
  let start = 0
  while (start < n) {
    const seg = segments[start]
    let end = start
    while (end + 1 < n && segments[end + 1] === seg) end += 1
    const tint = seg ? SEGMENT_TINT[seg] : undefined
    if (tint) {
      ctx.fillStyle = tint
      ctx.fillRect(slot * start, 0, slot * (end - start + 1), h)
    }
    start = end + 1
  }
}

const props = withDefaults(
  defineProps<{
    minutes?: Point[]
    bars?: Bar[]
    mode?: 'minute' | 'kline'
    /** 副图类型：none 不显示、volume 成交量、macd MACD */
    sub?: 'none' | 'volume' | 'macd' | 'ratio'
    prevClose?: number
    height?: number
  }>(),
  { mode: 'minute', sub: 'none', prevClose: 0, height: 200, minutes: () => [], bars: () => [] },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ro: ResizeObserver | null = null

const UP = '#ff4d4f'
const DOWN = '#12b76a'

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2)
}

/** 稀疏网格：只画横向基准线与分隔线，避免副图区域被网格切碎 */
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

/** 主图：分时走势 */
function drawMinute(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const pts = props.minutes ?? []
  if (!pts.length) return
  const base = props.prevClose || pts[0].price
  const prices = pts.map((p) => p.price)
  const maxDev = Math.max(...prices.map((p) => Math.abs(p - base)), base * 0.005)
  const hi = base + maxDev
  const lo = base - maxDev
  const yOf = (p: number) => h - ((p - lo) / (hi - lo || 1)) * h
  const xOf = (i: number) => (i / Math.max(1, pts.length - 1)) * w

  // 先用底色标出盘前/集合竞价/盘后区间，再画价格线，线压在上面才清楚
  paintSegments(ctx, w, h, pts.map((p) => p.segment))

  // 昨收虚线
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, yOf(base))
  ctx.lineTo(w, yOf(base))
  ctx.stroke()
  ctx.setLineDash([])

  const last = pts[pts.length - 1].price
  const rising = last >= base
  const color = rising ? UP : DOWN

  // 渐变填充
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, rising ? 'rgba(255,77,79,0.28)' : 'rgba(18,183,106,0.28)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.beginPath()
  ctx.moveTo(0, h)
  pts.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.price)))
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  // 均价线
  // 均价字段是可选的（K 线数据没有），过滤后用类型守卫收窄成 number[]，
  // 否则后续 yOf(a) 会被推断为 number | undefined
  const avgs: number[] =
    props.minutes?.map((p) => p.avg).filter((a): a is number => typeof a === 'number' && a > 0) ?? []
  if (avgs.length) {
    ctx.beginPath()
    avgs.forEach((a, i) => {
      const x = (i / Math.max(1, avgs.length - 1)) * w
      const y = yOf(a)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = '#e8b339'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 价格线
  ctx.beginPath()
  pts.forEach((p, i) => {
    const x = xOf(i)
    const y = yOf(p.price)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  ctx.stroke()

  // 最新价光点
  const lx = xOf(pts.length - 1)
  const ly = yOf(last)
  ctx.beginPath()
  ctx.arc(lx, ly, 3, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/** 主图：K 线 */
function drawKline(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bars = props.bars ?? []
  if (!bars.length) return
  const hi = Math.max(...bars.map((b) => b.high))
  const lo = Math.min(...bars.map((b) => b.low))
  const span = hi - lo || 1
  const yOf = (p: number) => h - ((p - lo) / span) * h
  const slot = w / bars.length
  const bodyW = Math.max(1.5, slot * 0.62)

  // 时段底色：集合竞价/盘前/盘后整列着色，红绿柱本身仍只表示涨跌
  paintSegments(ctx, w, h, bars.map((b) => b.segment))

  bars.forEach((b, i) => {
    const x = slot * i + slot / 2
    const rising = b.close >= b.open
    ctx.strokeStyle = rising ? UP : DOWN
    ctx.fillStyle = rising ? UP : DOWN
    // 影线
    ctx.beginPath()
    ctx.moveTo(x, yOf(b.high))
    ctx.lineTo(x, yOf(b.low))
    ctx.lineWidth = 1
    ctx.stroke()
    // 实体
    const y1 = yOf(Math.max(b.open, b.close))
    const y2 = yOf(Math.min(b.open, b.close))
    ctx.fillRect(x - bodyW / 2, y1, bodyW, Math.max(1, y2 - y1))
  })
}

/** 副图：成交量 —— 颜色跟随当根涨跌，高度按区间最大量归一 */
function drawVolume(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bars = props.bars ?? []
  const pts = props.minutes ?? []
  const isKline = props.mode === 'kline'
  const n = isKline ? bars.length : pts.length
  if (!n) return

  const vols = isKline ? bars.map((b) => b.volume || 0) : pts.map((p) => p.volume || 0)
  const maxV = Math.max(...vols, 1)
  const slot = w / n
  const barW = Math.max(1, slot * 0.62)

  vols.forEach((v, i) => {
    const bh = (v / maxV) * (h - 1)
    let rising: boolean
    if (isKline) {
      const b = bars[i]
      rising = b.close >= b.open
    } else {
      // 分时没有开收，用「相对上一点」的涨跌决定颜色
      const cur = pts[i].price
      const prev = i === 0 ? props.prevClose || cur : pts[i - 1].price
      rising = cur >= prev
    }
    ctx.fillStyle = rising ? 'rgba(255,77,79,0.75)' : 'rgba(18,183,106,0.75)'
    const x = slot * i + (slot - barW) / 2
    ctx.fillRect(x, h - bh, barW, Math.max(1, bh))
  })
}

/** 指数移动平均：MACD 的底层运算 */
function ema(values: number[], period: number): number[] {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const out: number[] = [values[0]]
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] * k + out[i - 1] * (1 - k))
  }
  return out
}

/** 副图：MACD —— DIF/DEA 双线 + 红绿柱，零轴居中对称 */
function drawMacd(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const closes =
    props.mode === 'kline' ? (props.bars ?? []).map((b) => b.close) : (props.minutes ?? []).map((p) => p.price)
  if (closes.length < 2) return

  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const dif = closes.map((_, i) => e12[i] - e26[i])
  const dea = ema(dif, 9)
  const hist = dif.map((d, i) => (d - dea[i]) * 2)

  const absMax = Math.max(...dif.map(Math.abs), ...dea.map(Math.abs), ...hist.map(Math.abs), 0.0001)
  const zero = h / 2
  const yOf = (v: number) => zero - (v / absMax) * (h / 2 - 1)
  const n = closes.length
  const xOf = (i: number) => (i / Math.max(1, n - 1)) * w
  const slot = w / n

  // 零轴
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, zero)
  ctx.lineTo(w, zero)
  ctx.stroke()

  // 柱状（放大两倍便于肉眼分辨，与常见口径一致）
  const barW = Math.max(1, slot * 0.55)
  hist.forEach((v, i) => {
    ctx.fillStyle = v >= 0 ? 'rgba(255,77,79,0.8)' : 'rgba(18,183,106,0.8)'
    const y1 = zero
    const y2 = yOf(v)
    const x = slot * i + (slot - barW) / 2
    ctx.fillRect(x, Math.min(y1, y2), barW, Math.max(1, Math.abs(y2 - y1)))
  })

  // DIF / DEA 双线
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
  line(dif, '#e8b339')
  line(dea, '#7aa9ff')
}

/**
 * 副图：量比。
 *
 * 口径：这一根的量 ÷ 本区间每根的平均量，基准线 1.0。
 * 为什么以「本区间均量」为基准：客户端手上只有当前这一屏的序列，没有过去 5 日
 * 每分钟均量；而量比要回答的本来就是「此刻的量相对常态是放大还是萎缩」，
 * 用本区间均量同样能看出放量/缩量，且换周期不会失真。
 * 服务端另下发的 volume_ratio 是用于指标网格展示的全市场口径数值。
 */
function drawRatio(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const vols = props.mode === 'kline'
    ? (props.bars ?? []).map((b) => b.volume || 0)
    : (props.minutes ?? []).map((p) => p.volume || 0)
  const n = vols.length
  if (n < 2) return
  const mean = vols.reduce((a, b) => a + b, 0) / n
  if (!(mean > 0)) return

  const ratios = vols.map((v) => v / mean)
  const top = Math.max(...ratios, 1.15)
  const yOf = (r: number) => h - 2 - (r / top) * (h - 4)
  const xOf = (i: number) => (i / Math.max(1, n - 1)) * w

  // 基准线 1.0：高于它是放量，低于它是缩量
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, yOf(1))
  ctx.lineTo(w, yOf(1))
  ctx.stroke()
  ctx.setLineDash([])

  const last = ratios[n - 1]
  ctx.beginPath()
  ratios.forEach((r, i) => {
    const x = xOf(i)
    const y = yOf(r)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.strokeStyle = last >= 1 ? '#e8b339' : '#7aa9ff'
  ctx.lineWidth = 1.2
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(xOf(n - 1), yOf(last), 2.2, 0, Math.PI * 2)
  ctx.fillStyle = last >= 1 ? '#e8b339' : '#7aa9ff'
  ctx.fill()
}

function render() {
  const el = canvasRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const ratio = dpr()
  el.width = Math.max(1, Math.floor(rect.width * ratio))
  el.height = Math.max(1, Math.floor(rect.height * ratio))
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  const W = rect.width
  const H = rect.height
  ctx.clearRect(0, 0, W, H)

  const showSub = props.sub !== 'none'
  const gap = showSub ? 5 : 0
  const subH = showSub ? Math.round((H - gap) * 0.3) : 0
  const mainH = H - subH - gap

  // 主图
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, mainH)
  ctx.clip()
  drawGrid(ctx, W, mainH)
  if (props.mode === 'kline') drawKline(ctx, W, mainH)
  else drawMinute(ctx, W, mainH)
  ctx.restore()

  if (!showSub) return

  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, mainH + gap / 2)
  ctx.lineTo(W, mainH + gap / 2)
  ctx.stroke()

  // 副图
  const subTop = mainH + gap
  ctx.save()
  ctx.translate(0, subTop)
  ctx.beginPath()
  ctx.rect(0, 0, W, subH)
  ctx.clip()
  if (props.sub === 'volume') drawVolume(ctx, W, subH)
  else if (props.sub === 'ratio') drawRatio(ctx, W, subH)
  else drawMacd(ctx, W, subH)
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

watch(() => [props.minutes, props.bars, props.mode, props.sub], () => render(), { deep: true })
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
