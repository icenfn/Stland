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
 * 副图有两种切换方式，互为补充
 * --------------------------
 *  · 点副图本体 → 轮到下一个指标。看盘时视线就落在副图上，「看→换→再看」
 *    连点两下就能来回对比，是高频动作的最短路径。
 *  · 点副图标题按钮 → 打开底部抽屉（BaseSheet），一次列出全部指标。
 *    五个指标里按名字直接跳转（而不是连点三次轮过去）只有抽屉能做到，
 *    并且能附带显示每个指标的读数口径。
 * 两种入口并存：高频靠轮切，跨多个指标靠抽屉。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

/**
 * 跨主图/副图的十字光标。
 *
 * 主图与副图是两块独立 canvas，竖线要一路穿到副图里，只能在两者之上盖一层
 * DOM 覆盖层（pointer-events:none，不吃手势）。MiniChart 只负责算「吸附到哪根
 * K 线、读数是几」，坐标换算与绘制都交给这里。
 */
interface CrosshairState {
  x: number
  y: number
  price: string
  time: string
  info: string[]
}

const crosshair = ref<CrosshairState | null>(null)
/** 图表左栏：用来判断点击是否落在图外 */
const leftRef = ref<HTMLElement | null>(null)
/** 时间轴行高；竖线在这里收住，不压到刻度文字上 */
const AXIS_H = 16

function onCrosshair(p: CrosshairState | null) {
  crosshair.value = p
}

/**
 * 点图外的空白处清除光标。
 *
 * 覆盖层本身不接事件（否则会挡掉副图点击与轮切换），所以只能把监听挂在
 * document 上，用 capture 抢在业务点击之前判断「是不是在图里」。
 */
function onDocPointerDown(ev: PointerEvent) {
  const el = leftRef.value
  if (!el) return
  if (el.contains(ev.target as Node)) return
  crosshair.value = null
}

onMounted(function () {
  document.addEventListener('pointerdown', onDocPointerDown, true)
})

onBeforeUnmount(function () {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})

// 换周期、换标的、换副图后旧下标已无意义，直接把光标清掉
watch(
  [
    function () { return props.bars },
    function () { return props.minutes },
    function () { return props.sub },
    function () { return props.period },
    function () { return props.fiveDay },
  ],
  function () { crosshair.value = null },
)

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

/**
 * 点击副图：轮到下一个指标。
 *
 * 顺序即 SUB_OPTIONS 的排列（成交量 → MACD → KDJ → 量比 → 分时博弈），
 * 走到末尾回到第一个。副图内任何位置都可以点 —— 看图时视线就落在那里，
 * 比回头找标题按钮顺手。
 */
function cycleSub() {
  const ids = SUB_OPTIONS.map((s) => s.id)
  if (!ids.length) return
  const next = (ids.indexOf(props.sub) + 1) % ids.length
  emit('update:sub', ids[next])
}

/** 副图选择抽屉的开合 */
const drawerOpen = ref(false)

/**
 * 从抽屉里选一个副图。
 *
 * 选中已激活的项不重复 emit：父级会因此重新取数，图会白闪一下，
 * 而用户的实际意图只是「关掉抽屉」。直接关闭即可。
 */
function chooseSub(id: SubKind) {
  drawerOpen.value = false
  if (id !== props.sub) emit('update:sub', id)
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
      <div ref="leftRef" class="kc-left">
        <MiniChart
          part="main"
          :mode="mode"
          :minutes="minutes"
          :bars="bars"
          :prev-close="prevClose"
          :multi-day="fiveDay"
          :height="mainHeight"
          :hide-hi-lo="!!crosshair"
          @crosshair="onCrosshair"
        />

        <!-- 副图标题行：左侧切换按钮，右侧指标读数 -->
        <div class="kc-subhead">
          <!-- 标题按钮开抽屉（按名字直选）；副图本体才是轮切换 -->
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

        <!-- 点击副图本体即轮到下一个指标：副图是「看图时视线落点」，
             比回到小小的标题按钮更顺手。 -->
        <div class="kc-subwrap" @click="cycleSub">
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
          <span class="kc-subswap">点图切换</span>
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

        <!-- 十字光标：盖在主图与副图之上，竖线才能一路穿过两块 canvas；
             价格牌贴左边、时间牌落在时间轴行 -->
        <div v-if="crosshair" class="kc-cross">
          <span
            class="kc-cross-v"
            :style="{ left: crosshair.x + 'px', height: 'calc(100% - ' + AXIS_H + 'px)' }"
          />
          <span class="kc-cross-h" :style="{ top: crosshair.y + 'px' }" />
          <span class="kc-cross-price" :style="{ top: crosshair.y - 7 + 'px' }">
            {{ crosshair.price }}
          </span>
          <span
            v-if="crosshair.time"
            class="kc-cross-time"
            :style="{ left: crosshair.x + 'px' }"
          >{{ crosshair.time }}</span>
          <span v-if="crosshair.info.length" class="kc-cross-info">
            {{ crosshair.info.join('  ') }}
          </span>
        </div>
      </div>

      <!-- 五档：只有个股有委托簿；指数不渲染，主副图因此横向铺满 -->
      <div v-if="!isIndex" class="kc-side">
        <DepthPanel :depth="depth" />
      </div>
    </div>

    <!-- 副图选择抽屉：走全局 BaseSheet，圆角/遮罩/返回键/下滑关闭全站一致 -->
    <BaseSheet :show="drawerOpen" max-height="60vh" @update:show="drawerOpen = $event">
      <div class="kc-sheet-head">副图指标</div>
      <div class="kc-sheet-list">
        <button
          v-for="opt in SUB_OPTIONS"
          :key="opt.id"
          class="kc-sheet-row"
          :class="{ on: opt.id === sub }"
          @click="chooseSub(opt.id)"
        >
          <span class="kc-sheet-name">{{ opt.label }}</span>
          <span v-if="opt.id === sub" class="kc-sheet-flag">当前</span>
        </button>
      </div>
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
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

/* 十字光标覆盖层：只画线，不接手势（否则会挡掉副图点击轮切换） */
.kc-cross {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}

/* 虚线用渐变画，比 canvas 的 setLineDash 更省事，且能与 CSS 变量统一 */
.kc-cross-v {
  position: absolute;
  top: 0;
  width: 1px;
  background: repeating-linear-gradient(
    to bottom,
    rgba(226, 232, 240, 0.55) 0 3px,
    transparent 3px 6px
  );
}

.kc-cross-h {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: repeating-linear-gradient(
    to right,
    rgba(226, 232, 240, 0.55) 0 3px,
    transparent 3px 6px
  );
}

/* 价格牌放左边：右侧留给五档栏，压在那边会被挤到图外面 */
.kc-cross-price {
  position: absolute;
  left: 0;
  padding: 1px 4px;
  border-radius: 2px;
  background: rgba(232, 179, 57, 0.94);
  color: #12151c;
  font-size: 10px;
  line-height: 12px;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}

/* 时间牌落在时间轴这一行，与刻度共用同一条基线 */
.kc-cross-time {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  padding: 1px 5px;
  border-radius: 2px;
  background: rgba(232, 179, 57, 0.94);
  color: #12151c;
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}

.kc-cross-info {
  position: absolute;
  top: 2px;
  right: 2px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
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

/* 副图选择抽屉 */
.kc-sheet-head {
  padding: 2px 16px 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}

.kc-sheet-list {
  padding: 0 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kc-sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: var(--c-text-2);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
}

.kc-sheet-row.on {
  border-color: rgba(232, 56, 61, 0.5);
  background: rgba(232, 56, 61, 0.1);
  color: var(--c-text);
  font-weight: 600;
}

.kc-sheet-flag {
  font-size: 11px;
  font-weight: 400;
  color: var(--c-brand);
}

/* ④ 时间轴 */
.kc-axis {
  padding-top: 1px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: 2px;
}

</style>
