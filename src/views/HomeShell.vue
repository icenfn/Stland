<script setup lang="ts">
/**
 * 首页框架（应用外壳）：五个主页面横排在一个 swiper 里，点击底栏或左右滑动切换。
 *
 * 本轮把自实现的位移轨道换成了 zebra-swiper（@zebra-ui/swiper v3.0.3）。
 * 选它的理由是它直接封了 Swiper 内核，带 `noSwipingSelector`：
 * 面板里有横向滚动条（指数卡、板块筛选、自选分组 chip），把这些容器标成
 * `[data-hscroll]` 交给 noSwipingSelector，手势落在里面时内核自己放弃横向接管 ——
 * 比在 touchend 里逐个判方向更干净，也不会和纵向滚动抢事件。
 *
 * 布局仍然是三层，缺一不可：
 *   1. top-bar —— 品牌。固定在 swiper 之外，滑动切页时它不动；
 *   2. swiper  —— 五屏横向轨道，每屏各自纵向滚动；
 *   3. TabBar  —— 在 App.vue 里画，fixed 贴底，同样在 swiper 之外。
 *
 * 五页常驻挂载（不 v-if），滚动位置、筛选状态不会因为切页丢失；
 * 行情连接也只在这里启停一次，五个页面都活着，谁单独 stop 都会把别人的数据掐断。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMarket } from '@/stores/market'
import OverviewPanel from './panels/OverviewPanel.vue'
import MarketPanel from './panels/MarketPanel.vue'
import WatchPanel from './panels/WatchPanel.vue'
import TradePanel from './panels/TradePanel.vue'
import ProfilePanel from './panels/ProfilePanel.vue'

// 走包自带的 index.d.ts 具名导出，vue-tsc 才不会报缺声明
import { ZSwiper, ZSwiperItem } from '@zebra-ui/swiper'

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
const swiperRef = ref<any>(null)

function clamp(i: number): number {
  return Math.min(Math.max(i, 0), PATHS.length - 1)
}

/** 取内核实例：组件 expose 的是 { swiper: Swiper } */
function instance(): any {
  const r = swiperRef.value
  return r?.swiper ?? r?.$swiper ?? null
}

/** 切到第 i 屏，并把地址同步过去（replace：不堆历史，返回键交给 useBackExit） */
function go(i: number) {
  const target = clamp(i)
  const inst = instance()
  if (inst?.slideTo) inst.slideTo(target)
  active.value = target
  if (route.path !== PATHS[target]) void router.replace(PATHS[target])
}

/** 手势结束后内核回传的当前页，用来同步高亮与地址 */
function onSlideChange() {
  const inst = instance()
  const i = clamp(Number(inst?.activeIndex ?? 0))
  if (i === active.value) return
  active.value = i
  if (route.path !== PATHS[i]) void router.replace(PATHS[i])
}

// 深链 /market、/trade 等进来时直接落到对应屏
watch(
  () => route.meta.panel,
  (v) => {
    const i = clamp(Number(v) || 0)
    if (i === active.value) return
    active.value = i
    const inst = instance()
    if (inst?.slideTo) inst.slideTo(i)
  },
)

onMounted(async () => {
  active.value = clamp(Number(route.meta.panel) || 0)
  market.start(1800)
  // 首屏尺寸要等布局稳定后再让内核量一次，否则宽度按 0 算会全部叠在一起
  await nextTick()
  const inst = instance()
  if (inst?.update) inst.update()
  if (active.value && inst?.slideTo) inst.slideTo(active.value, 0)
})

onBeforeUnmount(() => {
  market.stop()
})

defineExpose({ go, active })
</script>

<template>
  <div class="shell">
    <!-- 顶部应用栏：在 swiper 之外，和底栏一样属于外壳。
         右侧原来挂着「连接状态」和「交易时段」两个胶囊，本轮按需求删掉：
         连接质量属于运维信息（已挪到后台「模拟引擎」页签），
         交易时段在行情页与 K 线头部会各自呈现，放在全局顶栏反而每屏都在占位。 -->
    <header class="top-bar">
      <span class="brand">股岛</span>
      <!-- 当前页名：滑动或点底栏时跟着变，回答「我现在在哪一屏」 -->
      <span class="page-name">{{ activeName }}</span>
      <span class="spacer" />
    </header>

    <div class="pager">
      <z-swiper
        ref="swiperRef"
        :initial-slide="active"
        :speed="280"
        :slides-per-view="1"
        :space-between="0"
        :follow-finger="true"
        :threshold="8"
        :touch-angle="35"
        :resistance-ratio="0.3"
        :touch-start-prevent-default="false"
        :passive-listeners="false"
        :resistance="true"
        no-swiping-selector="[data-hscroll]"
        class="shell-swiper"
        @slideChange="onSlideChange"
      >
        <z-swiper-item class="pane"><OverviewPanel /></z-swiper-item>
        <z-swiper-item class="pane"><MarketPanel /></z-swiper-item>
        <z-swiper-item class="pane"><WatchPanel /></z-swiper-item>
        <z-swiper-item class="pane"><TradePanel /></z-swiper-item>
        <z-swiper-item class="pane"><ProfilePanel /></z-swiper-item>
      </z-swiper>
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

.pager {
  flex: 1;
  min-height: 0;
  position: relative;
  /* 给 fixed 底栏让位，最后一屏不会被遮住 */
  padding-bottom: calc(var(--h-tabbar) + var(--safe-bottom));
  box-sizing: border-box;
  overflow: hidden;
}

/* 内核容器要撑满，否则 slidesPerView:1 算不出可用宽度 */
.shell-swiper {
  width: 100%;
  height: 100%;
}

/* 每屏自己纵向滚动：横向交给内核，纵向交还浏览器 */
.pane {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  /* 让内核把纵向手势判给页面滚动 */
  touch-action: pan-y;
}

/* 面板内若还有 .app-bar，只当普通工具条：不再重复状态栏留白，也不 sticky */
.pane :deep(.app-bar) {
  padding-top: 0;
  position: static;
}
</style>
