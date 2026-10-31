<script setup lang="ts">
/**
 * 轻量 K 线/分时绘制：Canvas 手绘，避免引入 ECharts 体积（移动端首屏更关键）。
 *
 * 时间轴口径（本轮重点修复）
 * -------------------------
 * 上一版所有横坐标都按「点数」归一：`x = i / (n - 1) * w`。
 * 结果是开盘半小时只有二十来个点，这一小段被横向拉满整幅图，
 * 看起来像一条「全天走完」的曲线 —— 既看不出当前走到一天里的什么位置，
 * 也看不出后半段还是空白。五日视图同理，跨五天的一段被压成一天的样子。
 *
 * 现在改为「时间位」坐标系：横轴固定为一天的 240 个分钟位（A 股连续竞价
 * 9:30–11:30 + 13:00–15:00），价格线只画出「已经走到的那一段」，
 * 剩下的分钟位留白。五日则按每天 240 位依次排布，并画日分隔线。
 * 这样开盘时线从左边开始长出来，收盘时刚好走到右端 —— 时间顺序一目了然。
 *
 * 副图：主图下方可按需切换「成交量」或「MACD」，X 轴与主图共用同一套时间位。
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
  /** 该点所属交易日（仅五日视图下发），画日分隔线与当日基准线要用 */
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

/**
 * 把点的序号映射到「时间位」。
 *
 * 单日：第 i 个点就落在第 i 个分钟位（服务端已按分钟补齐/对齐）。
 * 五日：每天重新从 0 数，整体偏移 dayIndex × 240，并用 day 字段切日。
 */
interface Timeline {
  /** 每个点对应的时间位序号 */
  pos: number[]
  /** 总时间位数量，即横轴的满格长度 */
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
    /** 副图类型：none 不显示、volume 成交量、macd MACD、ratio 量比 */
    sub?: 'none' | 'volume' | 'macd' | 'ratio'
    prevClose?: number
    height?: number
    /**
     * 渲染哪一块：
     *  all  主图 + 副图同画布（默认）
     *  main 只画主图 —— 与副图拆成两个 canvas 时用，副图选项条才能落在两者之间
     *  sub  只画副图
     */
    part?: 'all' | 'main' | 'sub'
    /** 五日视图：分时点带 day 字段时启用，按日画分隔线与当日基准虚线 */
    multiDay?: boolean
    /** 时间位总数；0 表示按「一天 240 位」自动推断 */
    slots?: number
  }>(),
  {
    mode: 'minute',
    sub: 'none',
    prevClose: 0,
    height: 200,
    part: 'all',
    multiDay: false,
    slots: 0,
    minutes: () => [],
    bars: () => [],
  },
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

/**
 * 按时段铺底色。
 *
 * 现在按「时间位」而不是「点数」算列宽：同一段只有几分钟也不会被拉宽，
 * 底色始终贴着真实的时间位置。
 */
function paintSegments(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  segments: Array<Segment | undefined>,
  tl: Timeline,
) {
  const n = segments.length
  if (!n) return
  const slot = w / Math.max(1, tl.cap)
  let start = 0
  while (start < n) {
    const seg = segments[start]
    let end = start
    while (end + 1 < n && segments[end + 1] === seg) end += 1
    const tint = seg ? SEGMENT_TINT[seg] : undefined
    if (tint) {
      ctx.fillStyle = tint
      // 起点用格子的左边界，终点用最后一格的右边界，保证覆盖完整
      const x0 = tl.pos[start] * slot
      const x1 = (tl.pos[end] + 1) * slot
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
  const prices = pts.map((p) => p.price)
  const maxDev = Math.max(...prices.map((p) => Math.abs(p - base)), base * 0.005)
  const hi = base + maxDev
  const lo = base - maxDev
  const yOf = (p: number) => h - ((p - lo) / (hi - lo || 1)) * h

  // 先用底色标出盘前/集合竞价/盘后区间，再画价格线，线压在上面才清楚
  paintSegments(ctx, w, h, pts.map((p) => p.segment), tl)

  // 昨收虚线
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, yOf(base))
  ctx.lineTo(w, yOf(base))
  ctx.stroke()
  ctx.setLineDash([])

  // 五日视图：按交易日画分隔线与当日基准价虚线。
  // 每根竖线落在该日第一个时间位上，因此和真实时间刻度对齐。
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
    const firstIdxOfDay = new Map<string, number>()
    pts.forEach((p, i) => {
      const d = p.day ?? ''
      if (!firstIdxOfDay.has(d)) firstIdxOfDay.set(d, i)
    })
    for (const i of firstIdxOfDay.values()) {
      const y = yOf(pts[i].price)
      ctx.beginPath()
      ctx.moveTo(xOf(i), y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  const last = pts[pts.length - 1].price
  const rising = last >= base
  const color = rising ? UP : DOWN

  // 渐变填充：只填到最后一个已走到的分钟位，右侧留白
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
  const avgs: Array<{ i: number; v: number }> = []
  pts.forEach((p, i) => {
    if (typeof p.avg === 'number' && p.avg > 0) avgs.push({ i, v: p.avg })
  })
  if (avgs.length) {
    ctx.beginPath()
    avgs.forEach((a, k) => {
      const x = xOf(a.i)
      const y = yOf(a.v)
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
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
  ctx.beginPath()
  ctx.arc(lastX, yOf(last), 3, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

/** 主图：K 线（K 线按根数等距排布即可，一根就是一根，不涉及「一天 240 位」） */
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
  paintSegments(ctx, w, h, bars.map((b) => b.segment), {
    pos: bars.map((_, i) => i),
    cap: bars.length,
    dayStarts: [],
  })

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

  if (isKline) {
    const n = bars.length
    if (!n) return
    const vols = bars.map((b) => b.volume || 0)
    const maxV = Math.max(...vols, 1)
    const slot = w / n
    const barW = Math.max(1, slot * 0.62)
    vols.forEach((v, i) => {
      const bh = (v / maxV) * (h - 1)
      ctx.fillStyle = bars[i].close >= bars[i].open ? 'rgba(255,77,79,0.75)' : 'rgba(18,183,106,0.75)'
      const x = slot * i + (slot - barW) / 2
      ctx.fillRect(x, h - bh, barW, Math.max(1, bh))
    })
    return
  }

  const n = pts.length
  if (!n) return
  const tl = buildTimeline(pts, props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)
  const maxV = Math.max(...pts.map((p) => p.volume || 0), 1)

  pts.forEach((p, i) => {
    const v = p.volume || 0
    const bh = (v / maxV) * (h - 1)
    const prev = i === 0 ? props.prevClose || p.price : pts[i - 1].price
    ctx.fillStyle = p.price >= prev ? 'rgba(255,77,79,0.75)' : 'rgba(18,183,106,0.75)'
    const barW = Math.max(1, slot * 0.62)
    ctx.fillRect(tl.pos[i] * slot + (slot - barW) / 2, h - bh, barW, Math.max(1, bh))
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
  const isKline = props.mode === 'kline'
  const closes = isKline
    ? (props.bars ?? []).map((b) => b.close)
    : (props.minutes ?? []).map((p) => p.price)
  if (closes.length < 2) return

  const e12 = ema(closes, 12)
  const e26 = ema(closes, 26)
  const dif = closes.map((_, i) => e12[i] - e26[i])
  const dea = ema(dif, 9)
  const hist = dif.map((d, i) => (d - dea[i]) * 2)

  const absMax = Math.max(...dif.map(Math.abs), ...dea.map(Math.abs), ...hist.map(Math.abs), 0.0001)
  const zero = h / 2
  const yOf = (v: number) => zero - (v / absMax) * (h / 2 - 1)

  // 与主图共用时间位：分时按分钟位，K 线按根数
  const tl = isKline
    ? { pos: closes.map((_, i) => i), cap: closes.length }
    : buildTimeline(props.minutes ?? [], props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)
  const xOf = (i: number) => tl.pos[i] * slot + slot / 2

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
    const y2 = yOf(v)
    ctx.fillRect(xOf(i) - barW / 2, Math.min(zero, y2), barW, Math.max(1, Math.abs(y2 - zero)))
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
  const isKline = props.mode === 'kline'
  const vols = isKline
    ? (props.bars ?? []).map((b) => b.volume || 0)
    : (props.minutes ?? []).map((p) => p.volume || 0)
  const n = vols.length
  if (n < 2) return
  const mean = vols.reduce((a, b) => a + b, 0) / n
  if (!(mean > 0)) return

  const ratios = vols.map((v) => v / mean)
  const top = Math.max(...ratios, 1.15)
  const yOf = (r: number) => h - 2 - (r / top) * (h - 4)

  const tl = isKline
    ? { pos: vols.map((_, i) => i), cap: n }
    : buildTimeline(props.minutes ?? [], props.multiDay, props.slots)
  const slot = w / Math.max(1, tl.cap)
  const xOf = (i: number) => tl.pos[i] * slot + slot / 2

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

  // part='main'/'sub' 是把主图与副图拆成两块独立 canvas 的用法：
  // 此时各自占满自己的高度，中间由模板插入副图选项条。
  if (props.part === 'main') {
    drawGrid(ctx, W, H)
    if (props.mode === 'kline') drawKline(ctx, W, H)
    else drawMinute(ctx, W, H)
    return
  }
  if (props.part === 'sub') {
    if (props.sub === 'volume') drawVolume(ctx, W, H)
    else if (props.sub === 'ratio') drawRatio(ctx, W, H)
    else drawMacd(ctx, W, H)
    return
  }

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

watch(
  () => [props.minutes, props.bars, props.mode, props.sub, props.part, props.multiDay, props.slots],
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
