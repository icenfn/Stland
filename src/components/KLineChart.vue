<script setup lang="ts">
/**
 * K 线图表卡：个股详情与指数详情共用。
 *
 * 为什么抽出来：两页原本各写一份「周期栏 + 更多平铺 + 时段图例 + 主图 + 副图选项 + 副图」，
 * 结构完全同构，只是可选周期不同。任何一处微调都要改两遍，早晚会漂移成两种样子。
 *
 * 职责边界：
 *  · 本组件只管「选哪个周期 / 画什么」，不发请求；
 *  · 取数留在页面里（个股调 stocks.minutes/kline，指数调 indexMinutes/indexKline），
 *    通过 minutes / bars 两个 props 把数据递进来。
 *  · 用户点周期时 emit('select', id)，页面据此决定拉哪个接口。
 *
 * 这样个股与指数的差异就只剩：tabs 传什么、morePeriods 传不传、数据从哪来。
 */
import { computed } from 'vue'
import type { BarItem, MinutePoint } from '@/api/types'
import MiniChart from './MiniChart.vue'

/** 主周期栏的一个标签 */
export interface ChartTab {
  /** 'minute' 分时 / 'fiveDay' 五日 / 其余视为 K 线周期值 */
  id: string
  label: string
}

const props = withDefaults(
  defineProps<{
    /** 主图类型 */
    mode: 'minute' | 'kline'
    /** K 线周期；mode 为 minute 时忽略 */
    period: string
    /** 分时是否多日（五日） */
    fiveDay: boolean
    /** 副图指标 */
    sub: 'macd' | 'volume' | 'ratio'
    /** 分钟线数据 */
    minutes: MinutePoint[]
    /** K 线数据 */
    bars: BarItem[]
    /** 昨收，分时基准线用 */
    prevClose: number
    /** 主周期栏配置 */
    tabs: ChartTab[]
    /** 「更多」里平铺的低频周期；为空则不出现「更多」按钮 */
    morePeriods?: ChartTab[]
    /** 主图高度 */
    mainHeight?: number
    /** 副图高度 */
    subHeight?: number
  }>(),
  {
    morePeriods: () => [],
    mainHeight: 166,
    subHeight: 66,
  },
)

const emit = defineEmits<{
  /** 用户选了某个周期标签；id 语义同 ChartTab.id */
  (e: 'select', id: string): void
  (e: 'update:sub', v: 'macd' | 'volume' | 'ratio'): void
  (e: 'toggleMore', v: boolean): void
  (e: 'update:moreOpen', v: boolean): void
}>()

const moreOpen = defineModel<boolean>('moreOpen', { default: false })

/** 当前是否选中某个标签 */
function isOn(id: string): boolean {
  if (id === 'minute') return props.mode === 'minute' && !props.fiveDay
  if (id === 'fiveDay') return props.mode === 'minute' && props.fiveDay
  return props.mode === 'kline' && props.period === id
}

/** 「更多」按钮是否高亮：当前周期属于 morePeriods 里的项 */
const inMore = computed(() => props.morePeriods.some((p) => isOn(p.id)))

/** 需要画图例说明的非常规时段（常规连续竞价不画） */
const LEGEND_SEGMENTS = ['pre', 'auction', 'post'] as const

/** 只有分时且带多日数据时才需要时段图例 */
const segmentsPresent = computed(() => {
  if (props.mode !== 'minute') return [] as string[]
  const set = new Set<string>()
  for (const p of props.minutes) {
    if (p.segment && (LEGEND_SEGMENTS as readonly string[]).includes(p.segment)) {
      set.add(p.segment)
    }
  }
  return LEGEND_SEGMENTS.filter((k) => set.has(k)) as unknown as string[]
})

const SEGMENT_TEXT: Record<string, string> = {
  pre: '盘前',
  auction: '集合竞价',
  post: '盘后',
}

const SUB_TABS = [
  { v: 'macd', label: 'MACD' },
  { v: 'volume', label: '成交量' },
  { v: 'ratio', label: '量比' },
] as const

function pick(id: string): void {
  emit('select', id)
  moreOpen.value = false
}
</script>

<template>
  <!-- 主图周期：落在主图之上，先选「看什么周期」，再看图 -->
  <div class="chart-tabs">
    <button
      v-for="t in tabs"
      :key="t.id"
      class="ctab"
      :class="{ on: isOn(t.id) }"
      @click="pick(t.id)"
    >
      {{ t.label }}
    </button>
    <button
      v-if="morePeriods.length"
      class="ctab more"
      :class="{ on: inMore, open: moreOpen }"
      @click="moreOpen = !moreOpen"
    >
      更多<i class="caret">{{ moreOpen ? '▴' : '▾' }}</i>
    </button>
  </div>

  <!-- 更多：平铺低频周期，一次点击可见，不做横向滚动去找 -->
  <div v-if="morePeriods.length && moreOpen" class="more-grid">
    <button
      v-for="p in morePeriods"
      :key="p.id"
      class="mchip"
      :class="{ on: isOn(p.id) }"
      @click="pick(p.id)"
    >
      {{ p.label }}
    </button>
  </div>

  <!-- 时段图例：只在出现盘前/集合竞价/盘后时显示，说明底色含义 -->
  <div v-if="segmentsPresent.length" class="seg-legend">
    <span v-for="k in segmentsPresent" :key="k" class="seg-item" :class="'seg-' + k">
      <i class="dot" />{{ SEGMENT_TEXT[k] }}
    </span>
  </div>

  <!-- 主图：单独一块 canvas，副图选项条才能插在它与副图之间 -->
  <MiniChart
    v-if="mode === 'minute'"
    part="main"
    :minutes="minutes"
    :prev-close="prevClose"
    :multi-day="fiveDay"
    :height="mainHeight"
  />
  <MiniChart v-else part="main" mode="kline" :bars="bars" :height="mainHeight" />

  <!-- 副图选项：落在副图之上，先选指标再看曲线 -->
  <div class="chart-tabs sub-tabs">
    <span class="sub-label">副图</span>
    <button
      v-for="t in SUB_TABS"
      :key="t.v"
      class="ctab s"
      :class="{ on: sub === t.v }"
      @click="emit('update:sub', t.v)"
    >
      {{ t.label }}
    </button>
  </div>

  <!-- 副图必须与主图共用同一套时间轴：multi-day 不传的话，
       五日主图按日切分、副图却按单日重排，两块的横坐标就对不上了 -->
  <MiniChart
    v-if="mode === 'minute'"
    part="sub"
    :minutes="minutes"
    :prev-close="prevClose"
    :sub="sub"
    :multi-day="fiveDay"
    :height="subHeight"
  />
  <MiniChart v-else part="sub" mode="kline" :bars="bars" :sub="sub" :height="subHeight" />
</template>

<style scoped>
.chart-tabs {
  display: flex;
  gap: 3px;
  padding: 0 2px 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chart-tabs::-webkit-scrollbar {
  display: none;
}

.ctab {
  flex: 0 0 auto;
  font-size: 10.5px;
  padding: 3px 7px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--c-text-3);
  font-family: inherit;
}

.ctab.on {
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}

.sub-tabs {
  padding: 2px 2px 2px;
  align-items: center;
  border-top: 1px solid var(--c-line);
  margin-top: 2px;
}

/* 「更多」平铺：低频周期一次可见，尺寸按手指能点准来定 */
.more-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 4px 2px 6px;
}
.mchip {
  font-size: 10.5px;
  padding: 5px 0;
  border-radius: 7px;
  border: 1px solid var(--c-line);
  background: var(--c-card);
  color: var(--c-text-2);
  font-family: inherit;
  cursor: pointer;
}
.mchip.on {
  color: #ff8b8d;
  border-color: var(--c-brand);
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}

.ctab.more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--c-line);
}
.ctab.more .caret {
  font-style: normal;
  font-size: 8px;
  line-height: 1;
}

.sub-label {
  font-size: 10px;
  color: var(--c-text-3);
  padding-right: 2px;
  flex: 0 0 auto;
}

.ctab.s {
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 6px;
}

.seg-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 12px 6px;
  font-size: 11px;
  color: var(--c-text-2);
}
.seg-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.seg-item .dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
}
.seg-pre .dot { background: rgba(96, 140, 255, 0.45); }
.seg-auction .dot { background: rgba(232, 179, 57, 0.5); }
.seg-post .dot { background: rgba(150, 120, 240, 0.45); }
</style>
