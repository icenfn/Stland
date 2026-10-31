<script setup lang="ts">
/**
 * K 线 / 分时图表组件。
 *
 * 版式（本轮重构）
 * ---------------
 *   ① 主图选项        单独一行，横跨整个组件宽度
 *   ② 主图 / 副图     居左，纵向堆叠
 *   ③ 五档           居右，与主副图同高的一条窄栏
 *   ④ 时间轴         紧跟副图下方，独立一行，与主图副图共用同一套时间位
 *
 * 为什么把五档收进组件：五档和 K 线必须同屏才能相互印证 —— 看盘是在
 * 「价位形态」和「挂单厚薄」之间来回扫的。之前五档在页面里另起一栏，
 * 组件管不到它，窄屏上还会把 K 线挤掉一半宽度；收进来之后，组件自己保证
 * 「左图右档」的格局，页面只负责把数据递进来。指数没有委托簿，
 * 因此 `isIndex` 为真时不渲染五档，改由页面通过 `side` 插槽塞入涨跌分布。
 *
 * 为什么副图选项折叠成一个按钮：副图有 6 种（成交量 / MACD / KDJ / 量比 /
 * 分时博弈 / 无），全部平铺会占掉两行，把主图压得很矮。折叠成「当前副图名 +
 * 下拉」的按钮后只占一行；点开是底部抽屉，选项竖排、一次看全，
 * 选完即关。此外直接点副图区域也能循环切换 —— 换指标最高频的动作
 * 不必先点开抽屉。
 */
import { computed, ref } from 'vue'
import MiniChart from '@/components/MiniChart.vue'
import type { SubKind } from '@/components/MiniChart.vue'
import DepthPanel from '@/components/DepthPanel.vue'
import type { BarItem, Depth, MinutePoint } from '@/api/types'

const props = withDefaults(
  defineProps<{
    mode: 'minute' | 'kline'
    period?: string
    fiveDay?: boolean
    sub?: SubKind
    minutes?: MinutePoint[]
    bars?: BarItem[]
    prevClose?: number
    /** 主图选项（分时 / 五日 / 5分 / 15分 …） */
    tabs?: Array<{ id: string; label: string }>
    /** 折叠在「更多」里的长周期选项 */
    morePeriods?: Array<{ id: string; label: string }>
    moreOpen?: boolean
    /** 五档数据；指数不传 */
    depth?: Depth | null
    /** 指数：没有委托簿，不渲染五档 */
    isIndex?: boolean
    /** 主图高度，默认 176 */
    mainHeight?: number
    /** 副图高度，默认 66 */
    subHeight?: number
  }>(),
  {
    period: '5min',
    fiveDay: false,
    sub: 'macd',
    minutes: () => [],
    bars: () => [],
    prevClose: 0,
    tabs: () => [],
    morePeriods: () => [],
    moreOpen: false,
    depth: null,
    isIndex: false,
    mainHeight: 176,
    subHeight: 66,
  },
)

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'update:sub', v: SubKind): void
  (e: 'update:moreOpen', v: boolean): void
}>()

/**
 * 副图候选。'none' 单独放在抽屉里作为「不显示副图」，
 * 循环切换时跳过它 —— 用户点副图是想「换一个指标」，不是想关掉。
 */
const SUB_LIST: Array<{ id: SubKind; label: string }> = [
  { id: 'volume', label: '成交量' },
  { id: 'macd', label: 'MACD' },
  { id: 'kdj', label: 'KDJ' },
  { id: 'ratio', label: '量比' },
  { id: 'game', label: '分时博弈' },
]

const subLabel = computed(() => {
  if (props.sub === 'none') return '副图'
  return SUB_LIST.find((s) => s.id === props.sub)?.label ?? '副图'
})

const drawerOpen = ref(false)

/** 当前选中的主图项：五日与分时共用 minute 模式，用 fiveDay 区分 */
const activeTab = computed(() => {
  if (props.mode === 'minute') return props.fiveDay ? 'fiveDay' : 'minute'
  return props.period
})

function pick(id: string) {
  emit('select', id)
}

function setSub(id: SubKind) {
  emit('update:sub', id)
  drawerOpen.value = false
}

/** 直接点副图：在指标之间循环，跳过「无」 */
function cycleSub() {
  const idx = SUB_LIST.findIndex((s) => s.id === props.sub)
  const next = SUB_LIST[(idx + 1) % SUB_LIST.length]
  setSub(next.id)
}

function toggleMore() {
  emit('update:moreOpen', !props.moreOpen)
}
</script>

<template>
  <div class="kc">
    <!-- ① 主图选项：独占一行 -->
    <div class="kc-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="kc-tab"
        :class="{ on: activeTab === t.id }"
        @click="pick(t.id)"
      >
        {{ t.label }}
      </button>
      <button v-if="morePeriods.length" class="kc-tab more" :class="{ on: moreOpen }" @click="toggleMore">
        更多
        <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
          <path d="M2 4.5L6 8.5L10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
        </svg>
      </button>
    </div>

    <!-- 折叠的长周期选项 -->
    <div v-if="moreOpen && morePeriods.length" class="kc-chips">
      <button
        v-for="p in morePeriods"
        :key="p.id"
        class="kc-chip"
        :class="{ on: activeTab === p.id }"
        @click="pick(p.id)"
      >
        {{ p.label }}
      </button>
    </div>

    <!-- ②③ 主副图居左，五档居右 -->
    <div class="kc-body">
      <div class="kc-left">
        <MiniChart
          part="main"
          :mode="mode"
          :minutes="minutes"
          :bars="bars"
          :prev-close="prevClose"
          :multi-day="fiveDay"
          :height="mainHeight"
        />

        <!-- 副图选项：折叠成一个按钮，显示当前副图名称 -->
        <div class="kc-subhead">
          <button class="kc-subbtn" @click.stop="drawerOpen = true">
            {{ subLabel }}
            <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
              <path d="M2 4.5L6 8.5L10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </button>
          <span v-if="sub === 'game'" class="kc-note">估算</span>
        </div>

        <!-- 副图画布：直接点击可循环切换副图 -->
        <div class="kc-subwrap" :class="{ off: sub === 'none' }" @click="cycleSub">
          <MiniChart
            part="sub"
            :mode="mode"
            :sub="sub"
            :minutes="minutes"
            :bars="bars"
            :prev-close="prevClose"
            :multi-day="fiveDay"
            :height="subHeight"
          />
          <div v-if="sub === 'none'" class="kc-subempty">点击此处切换副图</div>
        </div>

        <!-- ④ 时间轴：紧跟副图，与上面两块共用时间位 -->
        <div class="kc-axis">
          <MiniChart
            part="axis"
            :mode="mode"
            :minutes="minutes"
            :bars="bars"
            :multi-day="fiveDay"
            :height="16"
          />
        </div>
      </div>

      <div v-if="!isIndex || $slots.side" class="kc-side">
        <DepthPanel v-if="!isIndex" :depth="depth" />
        <slot v-else name="side" />
      </div>
    </div>

    <!-- 副图选择抽屉：竖排一次看全，选完即关 -->
    <Teleport to="body">
      <div v-if="drawerOpen" class="kc-mask" @click="drawerOpen = false">
        <div class="kc-drawer" @click.stop>
          <div class="kc-drawer-head">
            <span>副图指标</span>
            <button class="kc-drawer-close" @click="drawerOpen = false">完成</button>
          </div>
          <div class="kc-drawer-grid">
            <button
              v-for="s in SUB_LIST"
              :key="s.id"
              class="kc-drawer-item"
              :class="{ on: sub === s.id }"
              @click="setSub(s.id)"
            >
              {{ s.label }}
            </button>
            <button class="kc-drawer-item" :class="{ on: sub === 'none' }" @click="setSub('none')">
              不显示副图
            </button>
          </div>
          <p v-if="sub === 'game'" class="kc-drawer-tip">
            分时博弈按「相邻分钟价格方向 × 成交量」估算净流入，仅表达量价配合方向，
            不等同券商的逐笔资金流。
          </p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.kc {
  /* 组件整体左右边距：贴着卡片边缘会让图表显得局促 */
  padding: 0 12px 10px;
}

/* ① 主图选项：一行，可横向滚动，避免小屏换行挤压 */
.kc-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.kc-tabs::-webkit-scrollbar {
  display: none;
}
.kc-tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--c-text-2, #aab4c2);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.kc-tab.on {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
  color: var(--c-text, #eaf0f8);
  font-weight: 600;
}
.kc-tab.more {
  margin-left: auto;
}

/* 折叠的长周期选项 */
.kc-chips {
  display: flex;
  gap: 6px;
  padding: 0 0 8px;
  flex-wrap: wrap;
}
.kc-chip {
  padding: 3px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: var(--c-text-2, #aab4c2);
  font-size: 12px;
  cursor: pointer;
}
.kc-chip.on {
  color: #e8b339;
  border-color: rgba(232, 179, 57, 0.45);
  background: rgba(232, 179, 57, 0.1);
}

/* ②③ 左图右档 */
.kc-body {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.kc-left {
  flex: 1 1 auto;
  min-width: 0;
}
.kc-side {
  flex: 0 0 88px;
  padding-top: 2px;
}

/* 副图标题行：只放当前副图名的按钮 */
.kc-subhead {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0 1px;
}
.kc-subbtn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px 1px 0;
  border: 0;
  background: transparent;
  color: var(--c-text-3, #8b96a5);
  font-size: 11px;
  cursor: pointer;
}
.kc-subbtn:hover {
  color: var(--c-text, #eaf0f8);
}
.kc-note {
  font-size: 10px;
  color: rgba(232, 179, 57, 0.85);
}

/* 副图区域：可点击切换，给一点可交互提示 */
.kc-subwrap {
  position: relative;
  cursor: pointer;
}
.kc-subwrap.off {
  min-height: 28px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 6px;
}
.kc-subempty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--c-text-3, #8b96a5);
}

/* ④ 时间轴 */
.kc-axis {
  padding-top: 1px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: 2px;
}

/* 抽屉 */
.kc-mask {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.5);
}
.kc-drawer {
  width: 100%;
  padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  border-radius: 16px 16px 0 0;
  background: #151c26;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.kc-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text, #eaf0f8);
}
.kc-drawer-close {
  border: 0;
  background: transparent;
  color: #e8b339;
  font-size: 13px;
  cursor: pointer;
}
.kc-drawer-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.kc-drawer-item {
  padding: 11px 4px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: var(--c-text-2, #aab4c2);
  font-size: 13px;
  cursor: pointer;
}
.kc-drawer-item.on {
  color: #e8b339;
  border-color: rgba(232, 179, 57, 0.5);
  background: rgba(232, 179, 57, 0.12);
}
.kc-drawer-tip {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3, #8b96a5);
}
</style>
