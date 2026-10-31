<script setup lang="ts">
/**
 * K 线 / 分时图表组件（个股与指数共用这一个）。
 *
 * 版式
 * ----
 *   ① 主图选项   唯一一行：分时 / 五日 / 日K / 周K / 月K / 更多
 *   ② 主图       占满可用宽度
 *   ③ 副图标题   左侧「当前副图名」按钮（点开切换），右侧跟着指标读数
 *   ④ 副图       占满可用宽度
 *   ⑤ 时间轴     与主图副图共用同一套时间位
 *   ⑥ 五档       仅个股：贴在图右侧的窄栏（指数没有委托簿，不渲染）
 *
 * 为什么周期选项写死在组件里
 * ------------------------
 * 之前两个详情页各写一份 `MAIN_TABS`：个股是「分时/五日/日K/周K/月K」，
 * 指数是「分时/五日/5分/15分/30分/日K」—— 同一个组件被喂了两套不同的入口，
 * 用户在两页看到的周期排布不一样。既然两页共用同一个组件，选项就该由组件
 * 自己定义一次：分时、五日、日K、周K、月K 常驻首行，其余周期统一收进「更多」。
 * 页面只负责把 segment 的「选中 id」翻译成一次取数。
 *
 * 为什么「更多」由组件自己开合
 * --------------------------
 * 上一版把展开态交给页面（`v-model:more-open`），指数页没接这个绑定：
 * 点「更多」发出了事件却没人管，按钮看起来就是死的。展开与否纯属图表内部的
 * 显示状态，组件自己持有即可，两页都不会再漏。
 *
 * 为什么副图读数单独抽成一行文字
 * ----------------------------
 * 副图画的是曲线，读不出「现在是多少」。把 K/D/J（或 DIF/DEA、量比、净流入）
 * 的当前值与方向标在副图标题行，看盘时不用把视线移到图里逐条比对；
 * 数值与图形由同一套指标实现产出（见 utils/indicators），不会出现「标注 81、
 * 曲线却在 60」这种口径分裂。
 *
 * 为什么副图切换走全局底部抽屉
 * --------------------------
 * 抽屉的圆角、遮罩、返回键、下滑关闭只在 BaseSheet 里实现一次；组件内再手写
 * 一层遮罩，就会出现「这个抽屉能下滑关、那个不能」的不一致，返回键也没有人管。
 */
import { computed, ref } from 'vue'
import MiniChart from '@/components/MiniChart.vue'
import type { SubKind } from '@/components/MiniChart.vue'
import DepthPanel from '@/components/DepthPanel.vue'
import BaseSheet from '@/components/BaseSheet.vue'
import type { BarItem, Depth, MinutePoint } from '@/api/types'
import { SUB_OPTIONS, subReadout } from '@/utils/indicators'
import type { Readout, SeriesInput } from '@/utils/indicators'

const props = withDefaults(
  defineProps<{
    mode: 'minute' | 'kline'
    period?: string
    fiveDay?: boolean
    sub?: SubKind
    minutes?: MinutePoint[]
    bars?: BarItem[]
    prevClose?: number
    /** 五档数据；指数不传 */
    depth?: Depth | null
    /** 指数：没有委托簿，不渲染五档栏 */
    isIndex?: boolean
    mainHeight?: number
    subHeight?: number
  }>(),
  {
    period: 'day',
    fiveDay: false,
    sub: 'macd',
    minutes: () => [],
    bars: () => [],
    prevClose: 0,
    depth: null,
    isIndex: false,
    mainHeight: 176,
    subHeight: 66,
  },
)

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'update:sub', v: SubKind): void
}>()

/** 首行常驻周期：个股与指数完全一致 */
const TABS: Array<{ id: string; label: string }> = [
  { id: 'minute', label: '分时' },
  { id: 'fiveDay', label: '五日' },
  { id: 'day', label: '日K' },
  { id: 'week', label: '周K' },
  { id: 'month', label: '月K' },
]

/** 收进「更多」的低频周期 */
const MORE_TABS: Array<{ id: string; label: string }> = [
  { id: '1min', label: '1分' },
  { id: '5min', label: '5分' },
  { id: '15min', label: '15分' },
  { id: '30min', label: '30分' },
  { id: '60min', label: '60分' },
  { id: '120min', label: '120分' },
  { id: 'quarter', label: '季K' },
  { id: 'year', label: '年K' },
]

/** 「更多」展开态由组件自己持有：页面不必再接一个容易漏掉的绑定 */
const moreOpen = ref(false)
/** 副图切换抽屉 */
const drawerOpen = ref(false)

/** 当前选中的周期 id */
const activeId = computed(() => {
  if (props.mode === 'minute') return props.fiveDay ? 'fiveDay' : 'minute'
  return props.period
})

/** 当前副图名 */
const subLabel = computed(() => SUB_OPTIONS.find((s) => s.id === props.sub)?.label ?? '副图')

/** 当前副图是否属于估算口径（分时博弈没有逐笔数据） */
const subEstimated = computed(() => props.sub === 'game')

/** 图上正在显示的数据，交给指标函数算读数 */
const series = computed<SeriesInput>(() => {
  if (props.mode === 'kline') {
    return {
      closes: props.bars.map((b) => b.close),
      highs: props.bars.map((b) => b.high),
      lows: props.bars.map((b) => b.low),
      vols: props.bars.map((b) => b.volume),
    }
  }
  return {
    closes: props.minutes.map((m) => m.price),
    vols: props.minutes.map((m) => m.volume),
  }
})

/** 副图读数：K/D/J、DIF/DEA、量比、净流入 */
const readouts = computed<Readout[]>(() => subReadout(props.sub, series.value))

function arrow(dir: Readout['dir']): string {
  return dir > 0 ? '↑' : dir < 0 ? '↓' : '·'
}

/**
 * 读数颜色沿用「涨红跌绿」：指标上行用红、下行用绿。
 * 持平不著色，避免一排彩色文字反而看不出方向。
 */
function dirClass(dir: Readout['dir']): string {
  return dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'
}

function pick(id: string) {
  // 选中「更多」里的周期后顺手收起面板：用户已经做出选择，
  // 面板继续摊开会一直占掉一块主图高度。
  moreOpen.value = false
  emit('select', id)
}

function setSub(id: SubKind) {
  emit('update:sub', id)
  drawerOpen.value = false
}
</script>

<template>
  <div class="kc">
    <!-- ① 主图选项 -->
    <div class="kc-tabs">
      <button
        v-for="t in TABS"
        :key="t.id"
        class="kc-tab"
        :class="{ on: activeId === t.id }"
        @click="pick(t.id)"
      >
        {{ t.label }}
      </button>
      <button class="kc-tab more" :class="{ on: moreOpen }" @click="moreOpen = !moreOpen">
        更多
        <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
          <path
            d="M2 4.5L6 8.5L10 4.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            :transform="moreOpen ? 'rotate(180 6 6)' : ''"
          />
        </svg>
      </button>
    </div>

    <!-- 折叠的低频周期 -->
    <div v-if="moreOpen" class="kc-chips">
      <button
        v-for="p in MORE_TABS"
        :key="p.id"
        class="kc-chip"
        :class="{ on: activeId === p.id }"
        @click="pick(p.id)"
      >
        {{ p.label }}
      </button>
    </div>

    <!-- ②③④⑤ 主副图与五档 -->
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

        <!-- 副图标题行：左侧切换按钮，右侧指标读数 -->
        <div class="kc-subhead">
          <button class="kc-subbtn" @click.stop="drawerOpen = true">
            {{ subLabel }}
            <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
              <path d="M2 4.5L6 8.5L10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </button>
          <em v-if="subEstimated" class="kc-note">估算</em>
          <span v-if="readouts.length" class="kc-readout tabular">
            <em
              v-for="r in readouts"
              :key="r.label"
              :class="r.tone ? '' : dirClass(r.dir)"
              :style="r.tone ? { color: r.tone } : undefined"
            >
              {{ r.label }}:{{ r.value }}<i>{{ arrow(r.dir) }}</i>
            </em>
          </span>
        </div>

        <!-- 点击副图本体即可切换指标：副图是「看图时视线落点」，
             比回到小小的标题按钮更顺手。 -->
        <div class="kc-subwrap" @click="drawerOpen = true">
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
          <span class="kc-subswap">切换</span>
        </div>

        <!-- 时间轴：与主图副图共用时间位，按当前周期取刻度格式 -->
        <div class="kc-axis">
          <MiniChart
            part="axis"
            :mode="mode"
            :period="period"
            :minutes="minutes"
            :bars="bars"
            :multi-day="fiveDay"
            :height="16"
          />
        </div>
      </div>

      <!-- 五档：只有个股有委托簿；指数不渲染，主副图因此横向铺满 -->
      <div v-if="!isIndex" class="kc-side">
        <DepthPanel :depth="depth" />
      </div>
    </div>

    <!-- 副图切换：走全局底部抽屉（圆角/遮罩/返回键/下滑关闭都复用同一套） -->
    <BaseSheet v-model:show="drawerOpen" max-height="60vh">
      <div class="kc-sheet-head">
        <span class="kc-sheet-title">副图指标</span>
      </div>
      <div class="kc-sheet-grid">
        <button
          v-for="s in SUB_OPTIONS"
          :key="s.id"
          class="kc-sheet-item"
          :class="{ on: sub === s.id }"
          @click="setSub(s.id)"
        >
          {{ s.label }}
        </button>
      </div>
      <p v-if="subEstimated" class="kc-sheet-tip">
        分时博弈按「相邻分钟价格方向 × 成交量」估算净流入，只表达量价配合方向，
        不等同券商的逐笔资金流。
      </p>
    </BaseSheet>
  </div>
</template>

<style scoped>
.kc {
  padding: 0 12px 10px;
}

/* ① 主图选项：一行，可横向滚动 */
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
  color: var(--c-text-2);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  font-family: inherit;
}
.kc-tab.on {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
  color: var(--c-text);
  font-weight: 600;
}
.kc-tab.more {
  margin-left: auto;
}

/* 折叠的低频周期 */
.kc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 8px;
}
.kc-chip {
  padding: 3px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: var(--c-text-2);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.kc-chip.on {
  color: var(--c-brand);
  border-color: rgba(232, 56, 61, 0.45);
  background: rgba(232, 56, 61, 0.1);
}

/* ②③ 左图右档；指数没有右档，左侧自然铺满 */
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
  flex: 0 0 96px;
  padding-top: 2px;
}

/* 副图标题行 */
.kc-subhead {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
  padding: 2px 0 1px;
}
.kc-subbtn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 1px 0;
  border: 0;
  background: transparent;
  color: var(--c-text-3);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.kc-subbtn:hover {
  color: var(--c-text);
}
.kc-note {
  flex: 0 0 auto;
  font-size: 10px;
  font-style: normal;
  color: rgba(232, 179, 57, 0.85);
}

/* 指标读数：一条横向可滚的行，数值等宽对齐 */
.kc-readout {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  font-size: 10.5px;
  line-height: 1.2;
  white-space: nowrap;
}
.kc-readout::-webkit-scrollbar {
  display: none;
}
.kc-readout em {
  font-style: normal;
  color: var(--c-text-2);
}
.kc-readout i {
  font-style: normal;
  margin-left: 1px;
}
.kc-readout .up {
  color: #ff5a5f;
}
.kc-readout .down {
  color: #2dbe7f;
}
.kc-readout .flat {
  color: var(--c-text-3);
}

/* 副图可点击区：右下角一个淡淡的「切换」提示，说明这里可以点 */
.kc-subwrap {
  position: relative;
  cursor: pointer;
}
.kc-subswap {
  position: absolute;
  right: 2px;
  top: 2px;
  font-size: 9px;
  color: var(--c-text-3);
  opacity: 0.6;
  pointer-events: none;
}

/* ④ 时间轴 */
.kc-axis {
  padding-top: 1px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: 2px;
}

/* 抽屉内：标题与选项网格 */
.kc-sheet-head {
  padding: 2px 0 10px;
}
.kc-sheet-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text);
}
.kc-sheet-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.kc-sheet-item {
  padding: 11px 4px;
  border-radius: 10px;
  border: 1px solid var(--c-line);
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.kc-sheet-item.on {
  color: var(--c-brand);
  border-color: rgba(232, 56, 61, 0.5);
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}
.kc-sheet-tip {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
}
</style>
