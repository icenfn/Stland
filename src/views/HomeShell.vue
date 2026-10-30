<script setup lang="ts">
/**
 * 首页框架（应用外壳）：五个主页面横排在一个 swiper 里，点击底栏或左右滑动切换。
 *
 * 布局分三层，缺一不可：
 *   1. top-bar —— 品牌与行情状态。固定在 swiper 之外，所以滑动切页时它不动；
 *   2. pager   —— 五屏横向轨道，每屏各自纵向滚动；
 *   3. TabBar  —— 在 App.vue 里画，fixed 贴底，同样在 swiper 之外。
 * 上一版把顶栏长在「概览」面板里，属于把外壳塞进内容：滑到行情时品牌跟着滑走，
 * 还会和面板自己的工具条叠成两层。
 *
 * 手势冲突的处理（横向列表 vs 翻页）：
 * 面板里有横向滚动条（指数卡、板块筛选、自选分组 chip）。通用轮播库会无条件
 * 接管横向手势，导致这些列表滑不动。这里只在「手势起点不在横向滚动容器内」时才翻页：
 *   · data-hscroll 显式标记优先；
 *   · 没有标记时退化为看实际溢出（scrollWidth > clientWidth + 2），漏标也能兜住；
 *   · 纵向位移更大时一律不翻页，交给页面滚动（容器 touch-action: pan-y）。
 *
 * 五页常驻挂载（不 v-if），所以滚动位置、筛选状态、行情轮询都不会因为切页丢失。
 * 行情轮询也只在这里启停一次：五个页面都活着，谁单独 stop 都会把别人的数据掐断。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMarket } from '@/stores/market'
import OverviewPanel from './panels/OverviewPanel.vue'
import MarketPanel from './panels/MarketPanel.vue'
import WatchPanel from './panels/WatchPanel.vue'
import TradePanel from './panels/TradePanel.vue'
import ProfilePanel from './panels/ProfilePanel.vue'

const route = useRoute()
const router = useRouter()
const market = useMarket()
const { state, session } = market

/** 五屏顺序，与底栏一一对应；index 就是这个顺序 */
const PATHS = ['/', '/market', '/watch', '/trade', '/profile'] as const

const active = ref(0)
const pagerEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)

const feedLabel = computed(() => {
  if (state.feed === 'socket') return '实时'
  if (state.feed === 'polling') return '轮询'
  if (state.feed === 'offline') return '离线'
  return '连接中'
})

function clamp(i: number): number {
  return Math.min(Math.max(i, 0), PATHS.length - 1)
}

function width(): number {
  return pagerEl.value?.clientWidth ?? 0
}

function restingOffset(i: number): number {
  return -clamp(i) * width()
}

/** 只用 transform 位移，不碰 scrollLeft：纵向滚动与横向翻页互不干扰 */
function applyOffset(px: number, animate = false) {
  const el = trackEl.value
  if (!el) return
  el.style.transition = animate ? 'transform 0.26s cubic-bezier(0.22,0.61,0.36,1)' : 'none'
  el.style.transform = `translate3d(${px}px,0,0)`
}

function settle(i: number) {
  active.value = clamp(i)
  applyOffset(restingOffset(active.value), true)
}

/** 切到第 i 屏，并把地址同步过去（replace：不堆历史，返回键交给 useBackExit） */
function go(i: number) {
  const target = clamp(i)
  if (target === active.value) return
  settle(target)
  if (route.path !== PATHS[target]) void router.replace(PATHS[target])
}

/* ------------------------------ 手势 ------------------------------ */

let startX = 0
let startY = 0
let dx = 0
let axis: 'x' | 'y' | null = null
let startAt = 0
let blocked = false

function startsInHScroll(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null
  const root = pagerEl.value
  while (el && el !== root) {
    if (el.dataset && el.dataset.hscroll !== undefined) return true
    const cs = getComputedStyle(el)
    if (
      (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth + 2
    ) {
      return true
    }
    el = el.parentElement
  }
  return false
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  const t = e.touches[0]
  startX = t.clientX
  startY = t.clientY
  dx = 0
  axis = null
  startAt = Date.now()
  blocked = startsInHScroll(e.target)
}

function onTouchMove(e: TouchEvent) {
  if (blocked || e.touches.length !== 1) return
  const t = e.touches[0]
  dx = t.clientX - startX
  const dy = t.clientY - startY

  if (!axis) {
    // 6px 内先不定方向，避免手抖就把纵向滚动判成翻页
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
    if (axis === 'x') dragging.value = true
  }
  if (axis !== 'x') return

  e.preventDefault()
  let next = restingOffset(active.value) + dx
  const min = restingOffset(PATHS.length - 1)
  const max = restingOffset(0)
  // 首屏右滑、末屏左滑给阻尼，边界可感知但不穿透
  if (next > max) next = max + (next - max) * 0.3
  if (next < min) next = min + (next - min) * 0.3
  applyOffset(next)
}

function onTouchEnd() {
  if (!dragging.value) {
    axis = null
    blocked = false
    return
  }
  const w = width() || 1
  const velocity = dx / Math.max(Date.now() - startAt, 1)
  const far = Math.abs(dx) > w * 0.22
  const flick = Math.abs(velocity) > 0.4
  let target = active.value
  if (far || flick) target = dx < 0 ? active.value + 1 : active.value - 1
  dragging.value = false
  axis = null
  blocked = false
  dx = 0
  go(target)
}

function onResize() {
  applyOffset(restingOffset(active.value))
}

// 深链 /market、/trade 等进来时直接落到对应屏
watch(
  () => route.meta.panel,
  (v) => {
    const i = clamp(Number(v) || 0)
    if (i !== active.value) settle(i)
  },
)

onMounted(() => {
  active.value = clamp(Number(route.meta.panel) || 0)
  applyOffset(restingOffset(active.value))
  window.addEventListener('resize', onResize)
  market.start(1800)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  market.stop()
})
</script>

<template>
  <div class="shell">
    <!-- 顶部应用栏：在 swiper 之外，和底栏一样属于外壳 -->
    <header class="top-bar">
      <span class="brand">股岛</span>
      <span class="spacer" />
      <span class="chip feed" :class="state.feed">{{ feedLabel }}</span>
      <span class="chip session" :class="{ open: session?.can_trade }">
        {{ session?.label ?? '休市' }}
      </span>
    </header>

    <div
      ref="pagerEl"
      class="pager"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div ref="trackEl" class="track" :class="{ dragging }">
        <section class="pane"><OverviewPanel /></section>
        <section class="pane"><MarketPanel /></section>
        <section class="pane"><WatchPanel /></section>
        <section class="pane"><TradePanel /></section>
        <section class="pane"><ProfilePanel /></section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.top-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  /* 状态栏留白只在这一层做，五屏内部都不再重复 */
  padding: calc(var(--status-bar-height) + 8px) 14px 8px;
  background: linear-gradient(180deg, #101823 0%, rgba(16, 24, 35, 0.96) 100%);
  backdrop-filter: saturate(160%) blur(14px);
  border-bottom: 1px solid var(--c-line);
  z-index: 5;
}

.brand {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 2px;
  background: linear-gradient(120deg, #ff6b6d, #ffb45c);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.spacer {
  flex: 1;
}

.chip {
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-text-2);
  white-space: nowrap;
}
.chip.feed.socket {
  background: rgba(18, 183, 106, 0.16);
  color: #4ade9b;
}
.chip.feed.polling {
  background: rgba(240, 160, 32, 0.16);
  color: #f5c26b;
}
.chip.feed.offline {
  background: rgba(255, 77, 79, 0.16);
  color: #ff8b8d;
}
.chip.session.open {
  background: rgba(255, 77, 79, 0.16);
  color: #ff8b8d;
}

.pager {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  /* 纵向交还浏览器，横向由这套手势接管 —— 两者不抢事件 */
  touch-action: pan-y;
  /* 给 fixed 底栏让位，最后一屏不会被遮住 */
  padding-bottom: calc(var(--h-tabbar) + var(--safe-bottom));
  box-sizing: border-box;
}

.track {
  display: flex;
  height: 100%;
  will-change: transform;
}

.pane {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* 面板内若还有 .app-bar，只当普通工具条：不再重复状态栏留白，也不 sticky */
.pane :deep(.app-bar) {
  padding-top: 0;
  position: static;
}
</style>
