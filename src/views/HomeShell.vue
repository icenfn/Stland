<script setup lang="ts">
/**
 * 首页框架（应用外壳）：五个主页面横排在一个横向轨道里，点击底栏或左右滑动切换。
 *
 * 为什么不再用第三方 swiper
 * ------------------------
 * 上一版为了 `noSwipingSelector`（面板里有横向滚动条，手势落在里面时要让给它们）
 * 引入了 @zebra-ui/swiper —— 那是 uni-app 生态的组件，它要求模板写成小程序标签，
 * 还需要一份 `window.uni` 运行时垫片（src/shims/uni.ts，185 行）和一份标签样式补齐
 * （src/styles/zebra-compat.css）。为了一个「五屏平移」引入了三层兼容负担。
 *
 * 现在换成 40 行的自实现轨道：
 *   · 位移用 transform: translate3d —— 走合成层，不触发布局；
 *   · 手势在 touchend 判定，|dx| 超过阈值且明显大于 |dy| 才切屏，
 *     纵向滚动因此完全不受干扰（内核方案反而要靠 touch-action 反复调）；
 *   · 落在 `[data-hscroll]` 里的手势直接放弃接管，等价于原来的 noSwipingSelector。
 *
 * 布局仍然是三层，缺一不可：
 *   1. top-bar —— 品牌。固定在轨道之外，滑动切页时它不动；
 *   2. track   —— 五屏横向轨道，每屏各自纵向滚动；
 *   3. TabBar  —— 在 App.vue 里画，fixed 贴底，同样在轨道之外。
 *
 * 五页常驻挂载（不 v-if），滚动位置、筛选状态不会因为切页丢失；
 * 行情连接也只在这里启停一次，五个页面都活着，谁单独 stop 都会把别人的数据掐断。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMarket } from '@/stores/market'
import { setHomeHandler } from '@/composables/useBackExit'
import OverviewPanel from './panels/OverviewPanel.vue'
import MarketPanel from './panels/MarketPanel.vue'
import WatchPanel from './panels/WatchPanel.vue'
import TradePanel from './panels/TradePanel.vue'
import ProfilePanel from './panels/ProfilePanel.vue'

const route = useRoute()
const router = useRouter()
const market = useMarket()

/** 五屏顺序，与底栏一一对应；index 就是这个顺序 */
const PATHS = ['/', '/market', '/watch', '/trade', '/profile'] as const

/** 与 PATHS 同序的页名，供顶栏显示当前所在页 */
const PANEL_NAMES = ['概览', '行情', '自选', '交易', '我的'] as const

const active = ref(0)
/** 顶栏副标题：当前屏的名字 */
const activeName = computed(() => PANEL_NAMES[clamp(active.value)] ?? '')

/** 拖动过程中的实时位移（百分比，负值向左），松手后归零由 transition 接管 */
const dragOffset = ref(0)
const dragging = ref(false)

function clamp(i: number): number {
  return Math.min(Math.max(i, 0), PATHS.length - 1)
}

/** 轨道位移：基准位置 + 拖动中的临时偏移 */
const trackStyle = computed(() => {
  const base = -active.value * 100
  return {
    transform: `translate3d(${base + dragOffset.value}%, 0, 0)`,
    transition: dragging.value ? 'none' : 'transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)',
  }
})

/** 切到第 i 屏，并把地址同步过去（replace：不堆历史，返回键交给 useBackExit） */
function go(i: number) {
  const target = clamp(i)
  dragOffset.value = 0
  active.value = target
  if (route.path !== PATHS[target]) void router.replace(PATHS[target])
}

/** 手势结束后内核回传的当前页，用来同步高亮与地址 */
function onSlideChange() {
  void 0
}

// ---- 手势 ----
let startX = 0
let startY = 0
let axis: 'none' | 'x' | 'y' = 'none'
/** 手势起点是否落在横向滚动容器里：是则整段手势交还给容器 */
let yieldToScroll = false

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  const t = e.touches[0]
  startX = t.clientX
  startY = t.clientY
  axis = 'none'
  const el = e.target as HTMLElement | null
  // 等价于内核的 noSwipingSelector：横向滚动条里的滑动不切屏
  yieldToScroll = Boolean(el?.closest?.('[data-hscroll]'))
  dragging.value = false
}

function onTouchMove(e: TouchEvent) {
  if (yieldToScroll || e.touches.length !== 1) return
  const t = e.touches[0]
  const dx = t.clientX - startX
  const dy = t.clientY - startY

  if (axis === 'none') {
    // 前 10px 判方向：横向优先接管，纵向则整段放弃（交还页面滚动）
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
    axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
    if (axis === 'x') dragging.value = true
  }
  if (axis !== 'x') return

  const width = (e.currentTarget as HTMLElement).clientWidth || 1
  let next = (dx / width) * 100
  // 首尾屏加阻尼：拖不动但有反馈，避免「滑到尽头像卡死」
  const atEdge = (active.value === 0 && dx > 0) || (active.value === PATHS.length - 1 && dx < 0)
  if (atEdge) next *= 0.3
  dragOffset.value = next
}

function onTouchEnd(e: TouchEvent) {
  if (!dragging.value) {
    axis = 'none'
    dragOffset.value = 0
    return
  }
  const t = e.changedTouches[0]
  const dx = t ? t.clientX - startX : 0
  const width = (e.currentTarget as HTMLElement).clientWidth || 1
  // 越过 1/4 屏宽，或快速轻扫（位移小但方向明确）都算一次切屏
  const passed = Math.abs(dx) > width / 4 || Math.abs(dx) > 40
  dragging.value = false
  axis = 'none'
  if (passed) go(active.value + (dx < 0 ? 1 : -1))
  else dragOffset.value = 0
}

// 深链 /market、/trade 等进来时直接落到对应屏
watch(
  () => route.meta.panel,
  (v) => {
    const i = clamp(Number(v) || 0)
    if (i === active.value) return
    active.value = i
    dragOffset.value = 0
  },
)

onMounted(async () => {
  active.value = clamp(Number(route.meta.panel) || 0)
  market.start(1800)
  // 把「滑回首页」交给返回键处理：框架页按返回且不在第 0 屏时，
  // 由它把轨道横向滑回首页（切 tab 用 replace，不产生历史，因此不动路由）。
  setHomeHandler(() => go(0))
  await nextTick()
})

onBeforeUnmount(() => {
  setHomeHandler(null)
  market.stop()
})

defineExpose({ go, active })
</script>

<template>
  <div class="shell">
    <!-- 顶部应用栏：在轨道之外，和底栏一样属于外壳。
         右侧原来挂着「连接状态」和「交易时段」两个胶囊，本轮按需求删掉：
         连接质量属于运维信息（已挪到后台「模拟引擎」页签），
         交易时段在行情页与 K 线头部会各自呈现，放在全局顶栏反而每屏都在占位。 -->
    <header class="top-bar">
      <span class="brand">股岛</span>
      <!-- 当前页名：滑动或点底栏时跟着变，回答「我现在在哪一屏」 -->
      <span class="page-name">{{ activeName }}</span>
      <span class="spacer" />
    </header>

    <div
      class="pager"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div class="track" :style="trackStyle">
        <div class="pane"><OverviewPanel /></div>
        <div class="pane"><MarketPanel /></div>
        <div class="pane"><WatchPanel /></div>
        <div class="pane"><TradePanel /></div>
        <div class="pane"><ProfilePanel /></div>
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

.page-name {
  font-size: 12px;
  color: var(--c-text-2);
}

.pager {
  flex: 1;
  min-height: 0;
  position: relative;
  /* 给 fixed 底栏让位，最后一屏不会被遮住 */
  padding-bottom: calc(var(--h-tabbar) + var(--safe-bottom));
  box-sizing: border-box;
  overflow: hidden;
}

/* 五屏轨道：宽度按屏数铺开，位移由 transform 完成（合成层，不触发布局） */
.track {
  display: flex;
  width: 500%;
  height: 100%;
  will-change: transform;
}

/* 每屏自己纵向滚动：横向交给轨道，纵向交还浏览器 */
.pane {
  width: 20%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-y;
}

/* 面板内若还有 .app-bar，只当普通工具条：不再重复状态栏留白，也不 sticky */
.pane :deep(.app-bar) {
  padding-top: 0;
  position: static;
}
</style>
