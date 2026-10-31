<script setup lang="ts">
/**
 * 指数详情页（独立页面）。
 *
 * 这一页只服务 指数：身份在文件里写死，不再由路由名推断，
 * 也不会因为另一类标的的改动被牵连。
 *
 * 为什么合并成一个页面：指数和个股本来就是同一种东西的不同外延 ——
 * 都有代码、都有分时与 K 线、都有当前价与涨跌。上一版把指数单独做成一个
 * 精简页（没有盘口、没有指标网格、没有副图），结果是「同一支标的换个入口
 * 就换了副样子」，用户要重新学一遍布局。现在两者同构：
 *
 *   ① 价格头    名称/代码 + 大号现价 + 涨跌额/涨跌幅 + 关键指标网格
 *   ② 图表卡    周期选项与个股完全一致（分时/五日/日K/周K/月K/更多），
 *               由 K 线组件统一定义；指数没有委托簿，组件不渲染五档栏，
 *               主副图横向铺满整行
 *   ④ 资料区    题材/板块/简介；指数额外列出成分股及其涨跌
 *   ⑤ 交易条    仅个股出现（指数不可交易，不摆一个点了会报错的按钮）
 *
 * 版式说明：价格与涨跌是视觉焦点，指标网格紧跟在价格下面。
 * 图表宽度：指数不渲染右侧五档栏，主副图直接铺满整行 ——
 * 上一版在右栏塞了「涨跌分布」，把 K 线挤到只剩一半宽度，
 * 而涨跌家数本来就在成分股统计里能读到。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { marketApi, watchApi } from '@/api'
import type {
  BarItem,
  DetailQuote,
  IndexMember,
  IndexQuote,
  KlinePeriod,
  MinutePoint,
  Quote,
  StockMeta,
} from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import KLineChart from '@/components/KLineChart.vue'
import WatchAddSheet from '@/components/WatchAddSheet.vue'
import { useLongPress } from '@/composables/useLongPress'
import type { SubKind } from '@/components/MiniChart.vue'
import TradeSheet from '@/components/TradeSheet.vue'
import { fmtAmount, fmtPct, fmtPrice, fmtVolume, trendClass } from '@/utils/format'

const route = useRoute()
const router = useRouter()

/**
 * 指数详情页（/index/:code）。个股已有独立页面，这里身份固定为指数，
 * 不再靠路由名在同一个模板里分叉 —— 改个股时不会碰坏指数。
 */
const isIndex = computed(() => true)
const code = computed(() => String(route.params.code ?? ''))

const quote = ref<DetailQuote | null>(null)
const meta = ref<StockMeta | null>(null)
const members = ref<IndexMember[]>([])
const minutes = ref<MinutePoint[]>([])
const bars = ref<BarItem[]>([])
const error = ref('')
const loading = ref(true)

/** 主图类型与周期：分时不带周期，K 线才带 */
const mode = ref<'minute' | 'kline'>('minute')
const period = ref<KlinePeriod>('day')
/**
 * 分时的「当日 / 五日」。
 *
 * 指数与个股必须用同一套视图能力：上一版指数页把 five-day 写死成 false、
 * 主周期栏也没有「五日」，于是同一个「看分时」的动作在两页得到两种结果。
 * 现在与个股完全对齐 —— 分时拿 days=1 的当日序列，五日拿 days=5。
 */
const fiveDay = ref(false)
/** 副图：成交量 / MACD / KDJ / 量比 / 分时博弈 —— 纯展示切换，不产生请求 */
const sub = ref<SubKind>('macd')

const sheetShow = ref(false)
const sheetSide = ref<'buy' | 'sell'>('buy')

const watching = ref(false)
const watchBusy = ref(false)
/** 长按加自选：弹出分组多选抽屉（与个股页同一套交互） */
const addSheetOpen = ref(false)

const watchLongPress = useLongPress(() => {
  if (watching.value || watchBusy.value) return
  addSheetOpen.value = true
})

const pctClass = computed(() => trendClass(quote.value?.change_pct ?? 0))
const priceClass = computed(() => trendClass(quote.value?.change ?? 0))

/** 指标网格：个股与指数取同一批字段，指数缺的用自身的分布数据顶上 */
const statRows = computed(() => {
  const q = quote.value
  if (!q) return []
  const rows: Array<{ k: string; v: string; cls?: string }> = [
    { k: '今开', v: fmtPrice(q.open), cls: trendClass(q.open - q.prev_close) },
    { k: '最高', v: fmtPrice(q.high), cls: trendClass(q.high - q.prev_close) },
    { k: '最低', v: fmtPrice(q.low), cls: trendClass(q.low - q.prev_close) },
    { k: '昨收', v: fmtPrice(q.prev_close) },
    { k: '成交量', v: fmtVolume(q.volume) },
    { k: '成交额', v: fmtAmount(q.amount) },
  ]
  if (isIndex.value) {
    rows.push(
      { k: '振幅', v: q.prev_close ? `${(((q.high - q.low) / q.prev_close) * 100).toFixed(2)}%` : '—' },
      { k: '成分', v: `${q.members ?? 0} 家` },
    )
  } else {
    rows.push(
      { k: '换手率', v: `${(q.turnover_rate ?? 0).toFixed(2)}%` },
      { k: '振幅', v: `${(q.amplitude ?? 0).toFixed(2)}%` },
    )
  }
  return rows
})

/**
 * 把个股报价与指数报价统一成 DetailQuote。
 *
 * 两边的差异只有几处：指数没有涨跌停与换手率（按 0 占位且模板不展示），
 * 个股没有成分涨跌家数。归一化放在这里做一次，模板与指标网格就只写一条路径，
 * 不必在每处取值时判空。
 */
function toDetail(src: Quote | IndexQuote, index: boolean): DetailQuote {
  const common = {
    code: src.code,
    name: src.name,
    price: src.price,
    prev_close: src.prev_close,
    open: src.open,
    high: src.high,
    low: src.low,
    volume: src.volume ?? 0,
    amount: src.amount,
    change: src.change,
    change_pct: src.change_pct,
  }
  if (index) {
    const ix = src as IndexQuote
    return {
      ...common,
      // 指数振幅只能现算：没有换手率概念，按 0 处理
      amplitude: ix.prev_close ? ((ix.high - ix.low) / ix.prev_close) * 100 : 0,
      turnover_rate: 0,
      up: ix.up,
      down: ix.down,
      flat: ix.flat,
      members: ix.members,
      is_index: true,
    }
  }
  const st = src as Quote
  return {
    ...common,
    amplitude: st.amplitude ?? 0,
    turnover_rate: st.turnover_rate ?? 0,
    limit_up: st.limit_up,
    limit_down: st.limit_down,
    is_index: false,
  }
}

async function loadQuote() {
  try {
    if (isIndex.value) {
      const res = await marketApi.indexDetail(code.value)
      quote.value = toDetail(res.quote, true)
      meta.value = res.meta
      members.value = res.members ?? []
    } else {
      const res = await marketApi.detail(code.value)
      quote.value = toDetail(res.quote, false)
      meta.value = res.meta
    }
    error.value = ''
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadChart() {
  try {
    if (mode.value === 'minute') {
      // 五日视图需要五天的分钟线：limit 放大到 5×240，并用 days=5 让服务端按日切开
      const days = fiveDay.value ? 5 : 1
      const limit = fiveDay.value ? 1200 : 240
      const res = isIndex.value
        ? await marketApi.indexMinutes(code.value, limit, days)
        : await marketApi.minutes(code.value, limit, days)
      minutes.value = res.items
    } else {
      const res = isIndex.value
        ? await marketApi.indexKline(code.value, period.value, 120)
        : await marketApi.kline(code.value, period.value, 120)
      bars.value = res.items as BarItem[]
    }
  } catch {
    /* 静默 */
  }
}

async function loadWatch() {
  try {
    const res = await watchApi.status(code.value)
    watching.value = res.watching
  } catch {
    /* 未登录或接口异常时不阻塞行情展示 */
  }
}

/**
 * 加为自选 / 取消自选。加入是幂等接口：已在自选时会移动到默认分组而非报错，
 * 所以按钮可以放心连点，不必先查状态再决定调哪个。
 */
async function toggleWatch() {
  if (watchBusy.value) return
  watchBusy.value = true
  try {
    if (watching.value) {
      await watchApi.remove(code.value)
      watching.value = false
    } else {
      await watchApi.add(code.value)
      watching.value = true
    }
  } catch {
    /* 失败保持原状，避免按钮与真实状态脱节 */
  } finally {
    watchBusy.value = false
  }
}

/** 组件只回报点了哪个 id，取数仍留在本页 */
function onChartSelect(id: string): void {
  if (id === 'minute') return switchMinute()
  if (id === 'fiveDay') return switchFiveDay()
  switchPeriod(id as KlinePeriod)
}

function switchPeriod(p: KlinePeriod) {
  mode.value = 'kline'
  period.value = p
  fiveDay.value = false
  loadChart()
}

function switchMinute() {
  if (mode.value === 'minute' && !fiveDay.value) return
  mode.value = 'minute'
  fiveDay.value = false
  loadChart()
}

function switchFiveDay() {
  if (mode.value === 'minute' && fiveDay.value) return
  mode.value = 'minute'
  fiveDay.value = true
  loadChart()
}

function openSheet(side: 'buy' | 'sell') {
  sheetSide.value = side
  sheetShow.value = true
}

async function onSubmitted() {
  await Promise.all([loadQuote()])
}

/** 价格与盘口高频刷新；图表跟着一起走，但只在秒级轻轻刷新一次，避免逐 tick 重绘 */
const { pause, resume } = useIntervalFn(
  () => {
    loadQuote()
  },
  3000,
  { immediate: false },
)

onMounted(async () => {
  await Promise.all([loadQuote(), loadChart(), loadWatch()])
  resume()
})

onBeforeUnmount(() => pause())

/** 同一组件在不同标的间跳转时路由参数会变，需要重新拉全量数据 */
watch(
  () => [route.name, route.params.code],
  async () => {
    loading.value = true
    minutes.value = []
    bars.value = []
    members.value = []
    mode.value = 'minute'
    fiveDay.value = false
    await Promise.all([loadQuote(), loadChart(), loadWatch()])
  },
)

/** 顶栏标题：名称与代码并排，指数再标一个前缀，避免和个股混看 */
const title = computed(() => {
  const name = meta.value?.name || quote.value?.name || ''
  const prefix = isIndex.value ? '指数 ' : ''
  return name ? `${prefix}${name} ${code.value}` : '详情'
})
</script>

<template>
  <div class="page">
    <AppBar :title="title" back />

    <div v-if="error" class="err">{{ error }}</div>

    <template v-if="quote">
      <!-- ① 价格头：现价与涨跌是视觉焦点，指标网格紧跟其下 -->
      <section class="head">
        <div class="head-top">
          <div class="price-block">
            <div class="price tabular" :class="priceClass">{{ fmtPrice(quote.price) }}</div>
            <div class="delta tabular" :class="pctClass">
              <span>{{ quote.change >= 0 ? '+' : '' }}{{ quote.change.toFixed(2) }}</span>
              <span>{{ quote.change_pct >= 0 ? '+' : '' }}{{ fmtPct(quote.change_pct) }}</span>
            </div>
          </div>
          <div class="tags">
            <span v-if="meta?.board" class="tag">{{ meta.board }}</span>
            <span v-if="meta?.industry" class="tag ghost">{{ meta.industry }}</span>
            <span v-if="meta?.is_st" class="tag st">ST</span>
            <span v-if="isIndex" class="tag idx">指数</span>
          </div>
        </div>

        <div class="stats">
          <div v-for="s in statRows" :key="s.k" class="stat">
            <span class="k">{{ s.k }}</span>
            <span class="v tabular" :class="s.cls">{{ s.v }}</span>
          </div>
        </div>
      </section>

      <!-- ② 图表卡：主图选项、主副图、时间轴都由 K 线组件负责，
           指数没有委托簿，组件不渲染五档栏，主副图因此横向铺满整行。
           涨跌家数已经在下方「涨跌分布」统计里给出，不再塞进图右侧的窄栏。 -->
      <section class="chart-card">
        <KLineChart
          :mode="mode"
          :period="period"
          :five-day="fiveDay"
          :sub="sub"
          :minutes="minutes"
          :bars="bars"
          :prev-close="quote.prev_close ?? 0"
          :is-index="true"
          :main-height="176"
          :sub-height="66"
          @select="onChartSelect"
          @update:sub="sub = $event"
        />
      </section>

      <section v-if="isIndex && members.length" class="card info-card">
        <h3>成分股 <span class="n">共 {{ members.length }} 支，按代码排序</span></h3>
        <div class="mtable">
          <button
            v-for="m in members"
            :key="m.code"
            class="mrow"
            @click="router.push(`/stock/${m.code}`)"
          >
            <span class="mname">
              <b>{{ m.name }}</b>
              <i>{{ m.code }}</i>
            </span>
            <span class="mprice tabular">{{ fmtPrice(m.price ?? 0) }}</span>
            <span class="mpct tabular" :class="trendClass(m.change_pct ?? 0)">
              {{ (m.change_pct ?? 0) >= 0 ? '+' : '' }}{{ fmtPct(m.change_pct ?? 0) }}
            </span>
          </button>
        </div>
      </section>

      <!-- ⑤ 交易条：仅个股，指数不可交易不摆无效按钮 -->
      <section v-if="!isIndex" class="actions">
        <button
          class="act-watch"
          :class="{ on: watching }"
          :disabled="watchBusy"
          v-on="watchLongPress.handlers"
          @click="watchLongPress.guardClick(toggleWatch)()"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" />
          </svg>
          <span>{{ watching ? '已自选' : '加自选' }}</span>
        </button>
        <button class="btn buy" @click="openSheet('buy')">买入</button>
        <button class="btn sell" @click="openSheet('sell')">卖出</button>
      </section>
    </template>

    <div v-else-if="loading" class="loading">加载中…</div>

    <!-- 指数不可交易：底栏只保留加自选 -->
    <section v-if="isIndex && quote" class="actions">
      <button
        class="act-watch wide"
        :class="{ on: watching }"
        :disabled="watchBusy"
        v-on="watchLongPress.handlers"
        @click="watchLongPress.guardClick(toggleWatch)()"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" />
        </svg>
        <span>{{ watching ? '取消自选' : '加自选' }}</span>
      </button>
    </section>

    <TradeSheet
      v-if="!isIndex && quote"
      v-model:show="sheetShow"
      :code="code"
      :side="sheetSide"
      @submitted="onSubmitted"
    />
  </div>
    <!-- 长按「加自选」弹出的分组多选（走全局底部抽屉） -->
    <WatchAddSheet
      v-model:show="addSheetOpen"
      :code="code"
      :name="quote?.name"
      @added="watching = true"
    />
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding-bottom: 24px;
  background: var(--c-bg);
}

.err {
  margin: 10px 14px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: rgba(255, 77, 79, 0.12);
  color: var(--c-up);
  font-size: 12px;
}

/* ---------- ① 价格头 ---------- */
.head {
  padding: 14px 14px 10px;
}

.head-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.price {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.5px;
}

.delta {
  display: flex;
  gap: 10px;
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
}

.up {
  color: var(--c-up);
}
.down {
  color: var(--c-down);
}
.flat {
  color: var(--c-flat);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  max-width: 45%;
}

.tag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(232, 56, 61, 0.14);
  color: var(--c-brand);
  white-space: nowrap;
}

.tag.ghost {
  background: rgba(255, 255, 255, 0.06);
  color: var(--c-text-2);
}

.tag.st {
  background: rgba(255, 77, 79, 0.2);
  color: var(--c-up);
}

.tag.idx {
  background: rgba(47, 123, 255, 0.16);
  color: var(--c-accent);
}

/* 指标网格：三列，指标名在上、数值在下，扫读时以数值为主 */
.stats {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px 8px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--c-card);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stat .k {
  font-size: 10px;
  color: var(--c-text-3);
}

.stat .v {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- ② 图表 + ③ 盘口 ---------- */
.chart-row {
  /* 指数页：图表在上、涨跌分布在下，纵向排列 */
  display: flex;
  flex-direction: column;
  gap: 0;
  /* 图表贴边：卡片内边距会把曲线挤窄，这里去掉左右留白 */
  padding: 0 0 10px;
  align-items: stretch;
}

.card {
  background: var(--c-card);
  border-radius: var(--r-md);
  border: 1px solid var(--c-line);
}

.chart-card {
  min-width: 0;
  padding: 8px 0 6px;
}

.empty {
  font-size: 11px;
  color: var(--c-text-3);
  text-align: center;
  padding: 18px 0;
}

/* ---------- ④ 资料 / 成分 ---------- */
.info-card {
  margin: 0 14px 10px;
  padding: 12px;
}

.info-card h3 {
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--c-text);
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.info-card h3 .n {
  font-size: 10px;
  font-weight: 400;
  color: var(--c-text-3);
}

.line {
  margin: 0 0 6px;
  font-size: 11.5px;
  color: var(--c-text-2);
  line-height: 1.6;
}

.line .k {
  display: inline-block;
  min-width: 52px;
  color: var(--c-text-3);
  font-size: 10.5px;
}

.mtable {
  display: flex;
  flex-direction: column;
}

.mrow {
  display: grid;
  grid-template-columns: 1fr auto 66px;
  gap: 8px;
  align-items: center;
  padding: 8px 0;
  border: none;
  border-bottom: 1px solid var(--c-line);
  background: transparent;
  font-family: inherit;
  text-align: left;
}

.mrow:last-child {
  border-bottom: none;
}

.mname {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mname b {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mname i {
  font-size: 9.5px;
  font-style: normal;
  color: var(--c-text-3);
}

.mprice {
  font-size: 12px;
  color: var(--c-text);
}

.mpct {
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

/* ---------- ⑤ 交易条 ---------- */
.actions {
  /* 固定在屏幕底部：详情页很长，sticky 会被后面的内容顶走 */
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  gap: 8px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: var(--c-bg);
  border-top: 1px solid var(--c-line);
}

/* 底栏里的「加自选」：图标 + 文字，纵向排布，占用宽度比一个文字按钮更省 */
.act-watch {
  flex: 0 0 auto;
  width: 54px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  background: none;
  color: var(--c-text-3);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
}
.act-watch svg {
  width: 20px;
  height: 20px;
}
.act-watch.on {
  color: #e8b339;
}
.act-watch.wide {
  width: 100%;
  flex-direction: row;
  gap: 6px;
  height: 42px;
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-md);
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 14px;
  font-weight: 600;
}
.act-watch.wide.on {
  color: #e8b339;
  border-color: rgba(232, 179, 57, 0.45);
}

.btn {
  flex: 1;
  height: 42px;
  border: none;
  border-radius: var(--r-md);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  color: #fff;
}

.btn.buy {
  background: var(--c-up);
}

.btn.sell {
  background: var(--c-down);
}

.watch-btn {
  border: 1px solid var(--c-line-strong);
  background: transparent;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: inherit;
}

.watch-btn.on {
  border-color: rgba(232, 56, 61, 0.5);
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.1);
}

.loading {
  padding: 40px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}

.tabular {
  font-variant-numeric: tabular-nums;
}

/* 页面底部留白：固定底栏会盖住最后一段内容 */
.page {
  padding-bottom: calc(72px + env(safe-area-inset-bottom));
}
</style>
