<script setup lang="ts">
/**
 * 首页容器：概览 / 行情 两个面板，左右滑动切换。
 *
 * 三处结构调整：
 *
 * 1) 顶部应用栏移到这里（原来长在概览面板里）。
 *    应用栏属于「首页」而不是「概览」：放在面板内会跟着面板一起横向移走，
 *    滑到行情时品牌与行情状态就消失了，还会和面板自己的工具条叠成两层。
 *    现在它固定在容器顶部，只做一次状态栏留白，两个面板共用。
 *
 * 2) 自选从首页移出，成为底栏独立入口。
 *    自选是账户数据（要登录），和公开行情不是一类；混在滑动面板里会出现
 *    「滑到第三屏才提示要登录」，不如在底栏明确一个入口。
 *
 * 3) 滑动改为自己实现，不再依赖第三方轮播组件。
 *    原来用通用轮播库，它会无条件接管横向手势，和面板里的横向滚动列表
 *    （指数条、板块筛选条）抢事件 —— 想横向滑列表，结果整页翻走了。
 *    现在的规则很明确：手势从横向滚动容器里开始时，一律不翻页；
 *    只有从普通内容区开始、且横向位移明显大于纵向时才翻页，
 *    纵向上滑照常滚动页面（touch-action: pan-y）。
 *
 * 两个面板用 v-show 常驻挂载：滚动位置、轮询状态都保留，切回来不白屏。
 * 行情轮询也由这一层统一启停，面板不再各自 start/stop（重复启停会互相掐断）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMarket } from '@/stores/market'
import OverviewPanel from './panels/OverviewPanel.vue'
import MarketPanel from './panels/MarketPanel.vue'

const route = useRoute()
const router = useRouter()
const market = useMarket()
const { state, session } = market

const TABS = ['概览', '行情'] as const
const PATHS = ['/', '/market'] as const

const active = ref(0)
const pagerEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
const offset = ref(0)
const dragging = ref(false)

const feedLabel = computed(() => {
  if (state.feed === 'socket') return '实时'
  if (state.feed === 'polling') return '轮询'
  if (state.feed === 'offline') return '离线'
  return '连接中'
})

function clamp(i: number): number {
  return Math.min(Math.max(i, 0), TABS.length - 1)
}

function width(): number {
  return pagerEl.value?.clientWidth ?? 0
}

/** 静止状态下的位移：第 i 屏左移 i 个屏宽 */
function restingOffset(i: number): number {
  return -clamp(i) * width()
}

function applyOffset(px: number, animate = false) {
  const el = trackEl.value
  if (!el) return
  el.style.transition = animate ? 'transform 0.26s cubic-bezier(0.22,0.61,0.36,1)' : 'none'
  el.style.transform = `translate3d(${px}px,0,0)`
}

function settle(i: number) {
  active.value = clamp(i)
  offset.value = restingOffset(active.value)
  applyOffset(offset.value, true)
}

function goPanel(i: number) {
  const target = clamp(i)
  if (target === active.value) return
  settle(target)
  if (route.path !== PATHS[target]) void router.replace(PATHS[target])
}

/* ---------------- 手势 ---------------- */

let startX = 0
let startY = 0
let dx = 0
let dy = 0
let axis: 'x' | 'y' | null = null
let startAt = 0
let blocked = false

/**
 * 手势是否从横向滚动容器里开始。
 * 这类容器自己不翻页，否则「滑板块条」会变成「翻到行情」。
 * 除显式标记外，也按实际溢出情况判断，避免漏标就冲突。
 */
function startsInHScroll(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null
  const root = pagerEl.value
  while (el && el !== root) {
    if (el.dataset && el.dataset.hscroll !== undefined) return true
    const cs = getComputedStyle(el)
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2) {
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
  dy = 0
  axis = null
  startAt = Date.now()
  blocked = startsInHScroll(e.target)
}

function onTouchMove(e: TouchEvent) {
  if (blocked || e.touches.length !== 1) return
  const t = e.touches[0]
  dx = t.clientX - startX
  dy = t.clientY - startY

  if (!axis) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    // 横向明显大于纵向才认定翻页；否则交还给页面纵向滚动
    axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
    if (axis === 'x') dragging.value = true
  }
  if (axis !== 'x') return

  e.preventDefault()
  const base = restingOffset(active.value)
  let next = base + dx
  // 首屏右滑、末屏左滑时给一点阻尼，让边界可感知但不穿透
  const min = restingOffset(TABS.length - 1)
  const max = restingOffset(0)
  if (next > max) next = max + (next - max) * 0.3
  if (next < min) next = min + (next - min) * 0.3
  offset.value = next
  applyOffset(next)
}

function onTouchEnd() {
  if (!dragging.value) {
    axis = null
    blocked = false
    return
  }
  const w = width() || 1
  const dt = Math.max(Date.now() - startAt, 1)
  const velocity = dx / dt
  const far = Math.abs(dx) > w * 0.22
  const flick = Math.abs(velocity) > 0.4
  let target = active.value
  if (far || flick) target = dx < 0 ? active.value + 1 : active.value - 1

  dragging.value = false
  axis = null
  blocked = false
  dx = 0
  dy = 0
  goPanel(target)
}

function onResize() {
  applyOffset(restingOffset(active.value))
}

watch(
  () => route.meta.panel,
  (v) => {
    const i = clamp(Number(v) || 0)
    if (i !== active.value) settle(i)
  },
)

onMounted(() => {
  active.value = clamp(Number(route.meta.panel) || 0)
  offset.value = restingOffset(active.value)
  applyOffset(offset.value)
  window.addEventListener('resize', onResize)
  // 行情轮询在首页统一启停：两个面板常驻，谁都不该单独把它关掉
  market.start(1800)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  market.stop()
})
</script>

<template>
  <div class="home-shell">
    <!-- 顶部应用栏：品牌 + 面板 tab + 行情状态，固定在容器顶部，不随面板移走 -->
    <header class="home-bar">
      <div class="brand">股岛</div>
      <nav class="panel-tabs">
        <button
          v-for="(t, i) in TABS"
          :key="t"
          class="ptab"
          :class="{ on: active === i }"
          @click="goPanel(i)"
        >
          {{ t }}
        </button>
      </nav>
      <span class="feed-chip" :class="state.feed">{{ feedLabel }}</span>
      <span class="session-chip" :class="{ open: session?.can_trade }">
        {{ session?.label ?? '休市' }}
      </span>
    </header>

    <!-- 滑动容器：只吃横向手势，纵向交给页面滚动 -->
    <div
      ref="pagerEl"
      class="pager"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div ref="trackEl" class="track" :class="{ dragging }">
        <section class="pane">
          <OverviewPanel />
        </section>
        <section class="pane">
          <MarketPanel />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.home-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  /* 状态栏留白只在这里做一次，面板内部不再重复 */
  padding: var(--status-bar-height) 12px 0;
  min-height: calc(var(--status-bar-height, 0px) + 46px);
  box-sizing: content-box;
  background: linear-gradient(180deg, #101823 0%, rgba(16, 24, 35, 0.94) 100%);
  backdrop-filter: saturate(160%) blur(14px);
  border-bottom: 1px solid var(--c-line);
  z-index: 10;
}

.brand {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 2px;
  background: linear-gradient(120deg, #ff6b6d, #ffb45c);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  flex: 0 0 auto;
}

.panel-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  padding-left: 2px;
}

.ptab {
  position: relative;
  background: none;
  border: none;
  color: var(--c-text-3);
  font-family: inherit;
  font-size: 15px;
  padding: 0 8px;
  height: 30px;
  cursor: pointer;
  transition: color 0.15s ease;
  white-space: nowrap;
}

.ptab.on {
  color: var(--c-text);
  font-weight: 700;
}

.ptab.on::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 1px;
  width: 16px;
  height: 2.5px;
  border-radius: 2px;
  background: var(--c-brand);
  transform: translateX(-50%);
}

.feed-chip,
.session-chip {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-text-2);
}
.feed-chip.socket {
  background: rgba(18, 183, 106, 0.16);
  color: #4ade9b;
}
.feed-chip.polling {
  background: rgba(240, 160, 32, 0.16);
  color: #f5c26b;
}
.feed-chip.offline {
  background: rgba(255, 77, 79, 0.16);
  color: #ff8b8d;
}
.session-chip.open {
  background: rgba(255, 77, 79, 0.16);
  color: #ff8b8d;
}

.pager {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  /* 纵向滚动交还浏览器，横向手势自己处理 —— 两者互不抢事件 */
  touch-action: pan-y;
  /* 底部给固定底栏留位，最后一屏内容不会被遮住 */
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

/* 面板自带的顶栏在这里只作为工具条，不再重复状态栏留白，也不 sticky */
.pane :deep(.app-bar) {
  padding-top: 0;
  position: static;
}
.pane :deep(.app-bar__inner) {
  height: auto;
  min-height: 44px;
}
</style>
