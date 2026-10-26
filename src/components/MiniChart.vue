<script setup lang="ts">
/** 轻量 K 线/分时绘制：Canvas 手绘，避免引入 ECharts 体积（移动端首屏更关键） */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Point {
  t: number
  price: number
  /** 分时均价；K 线数据没有该字段，因此可选 */
  avg?: number
}
interface Bar {
  time: number | string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const props = withDefaults(
  defineProps<{
    minutes?: Point[]
    bars?: Bar[]
    mode?: 'minute' | 'kline'
    prevClose?: number
    height?: number
  }>(),
  { mode: 'minute', prevClose: 0, height: 200, minutes: () => [], bars: () => [] },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ro: ResizeObserver | null = null

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 2)
}

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
  const color = rising ? '#ff4d4f' : '#12b76a'

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

function drawKline(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bars = props.bars ?? []
  if (!bars.length) return
  const hi = Math.max(...bars.map((b) => b.high))
  const lo = Math.min(...bars.map((b) => b.low))
  const span = hi - lo || 1
  const yOf = (p: number) => h - ((p - lo) / span) * h
  const slot = w / bars.length
  const bodyW = Math.max(1.5, slot * 0.62)

  bars.forEach((b, i) => {
    const x = slot * i + slot / 2
    const rising = b.close >= b.open
    ctx.strokeStyle = rising ? '#ff4d4f' : '#12b76a'
    ctx.fillStyle = rising ? '#ff4d4f' : '#12b76a'
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
  ctx.clearRect(0, 0, rect.width, rect.height)
  drawGrid(ctx, rect.width, rect.height)
  if (props.mode === 'kline') drawKline(ctx, rect.width, rect.height)
  else drawMinute(ctx, rect.width, rect.height)
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

watch(() => [props.minutes, props.bars, props.mode], () => render(), { deep: true })
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
