<script setup lang="ts">
/**
 * 个股详情：价格区 + (K线/分时 ⇄ 五档盘口) 双栏 + 题材 + 交易条 + 加为自选。
 *
 * 版式取舍：图表与盘口左右 **3:1** 并排。
 * 看盘的固定动作是「看走势、验证盘口」，两者需要同屏对照：
 * 上一版盘口在图表下方整行，手机上要滚屏才能把当前价与卖一/买一对上；
 * 改成 2:1 后盘口虽同屏，但图表被挤得偏窄，K 线细节（影线、量能台阶）看不清。
 * 本次改为 3:1：图表占主视野（75%），盘口右侧窄栏列出卖5→买5 十档，
 * 既保住同屏对照，也让图表重新有足够横向空间。
 *
 * 边距修复：上一版 `.quote-row` 自带 14px 横向内边距，而内部 `.card` 又通过
 * `.card { margin: 0 14px 12px }` 再加一层外边距，两处叠加导致图表卡片左右
 * 各多出 14px、上下也不对称 —— 视觉上就是「图表卡片缩在中间、边距发虚」。
 * 现在 `.quote-row` 作为唯一的横向留白来源，卡片自身 margin 归零，
 * 图表 canvas 的左右内边距统一为 6px（与五档列对齐），上下留白一致。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { marketApi, watchApi } from '@/api'
import type { BarItem, Depth, MinutePoint, Quote, StockMeta } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import MiniChart from '@/components/MiniChart.vue'
import TradeSheet from '@/components/TradeSheet.vue'
import { fmtAmount, fmtPct, fmtPrice, fmtVolume, trendClass } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const code = String(route.params.code)

const quote = ref<Quote | null>(null)
const meta = ref<StockMeta | null>(null)
const depth = ref<Depth | null>(null)
const minutes = ref<MinutePoint[]>([])
const bars = ref<BarItem[]>([])
const mode = ref<'minute' | 'kline'>('minute')
const period = ref('1min')
const error = ref('')

/** 下单抽屉：不跳转整页，保留当前个股的图表与盘口上下文 */
const sheetShow = ref(false)
const sheetSide = ref<'buy' | 'sell'>('buy')

/** 自选状态：进页面时读服务端，避免本地记的和账号实际不一致 */
const watching = ref(false)
const watchBusy = ref(false)

function openSheet(side: 'buy' | 'sell') {
  sheetSide.value = side
  sheetShow.value = true
}

async function onSubmitted() {
  await Promise.all([loadMeta(), loadDepth()])
}

const pctClass = computed(() => trendClass(quote.value?.change_pct ?? 0))

async function loadMeta() {
  try {
    const res = await marketApi.detail(code)
    quote.value = res.quote
    meta.value = res.meta
    error.value = ''
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  }
}

async function loadDepth() {
  try {
    depth.value = await marketApi.depth(code)
  } catch {
    /* 静默 */
  }
}

async function loadChart() {
  try {
    if (mode.value === 'minute') {
      const res = await marketApi.minutes(code, 240)
      minutes.value = res.items
    } else {
      const res = await marketApi.kline(code, period.value, 120)
      bars.value = res.items
    }
  } catch {
    /* 静默 */
  }
}

async function loadWatch() {
  try {
    const res = await watchApi.status(code)
    watching.value = res.watching
  } catch {
    /* 未登录或接口异常时不阻塞行情展示 */
  }
}

/**
 * 加为自选 / 取消自选。
 * 加入走「幂等」接口：已在自选时服务端会把它移动到默认分组而不是报错，
 * 所以按钮可以放心连点，不需要先查状态再决定调哪个接口。
 */
async function toggleWatch() {
  if (watchBusy.value) return
  watchBusy.value = true
  try {
    if (watching.value) {
      await watchApi.remove(code)
      watching.value = false
    } else {
      await watchApi.add(code)
      watching.value = true
    }
  } catch {
    /* 失败保持原状态，避免按钮与真实状态脱节 */
  } finally {
    watchBusy.value = false
  }
}

async function switchMode(m: 'minute' | 'kline') {
  mode.value = m
  await loadChart()
}

async function switchPeriod(p: string) {
  period.value = p
  mode.value = 'kline'
  await loadChart()
}

const refreshing = ref(false)
useIntervalFn(async () => {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.all([loadMeta(), loadDepth()])
    if (mode.value === 'minute') await loadChart()
  } finally {
    refreshing.value = false
  }
}, 2000)

onMounted(async () => {
  await Promise.all([loadMeta(), loadDepth(), loadChart(), loadWatch()])
})
</script>

<template>
  <div class="page" style="padding-bottom: 78px">
    <AppBar back>
      <template #title>
        <div class="head-title">
          <span>{{ meta?.name ?? code }}</span>
          <span class="code">{{ code }}</span>
        </div>
      </template>
      <template #actions>
        <span v-if="meta" class="tag tag-blue">{{ meta.board }}</span>
        <button class="watch-btn" :class="{ on: watching }" :disabled="watchBusy" @click="toggleWatch">
          <svg viewBox="0 0 24 24" class="wico" :fill="watching ? 'currentColor' : 'none'"
            stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
            <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" />
          </svg>
          <span>{{ watching ? '已自选' : '加为自选' }}</span>
        </button>
      </template>
    </AppBar>

    <div v-if="error" class="empty">{{ error }}</div>

    <template v-else>
      <!-- 价格区 -->
      <section class="px price-area">
        <div class="row" style="align-items: flex-end; gap: 12px">
          <div class="big-price tabular" :class="pctClass">{{ fmtPrice(quote?.price ?? 0) }}</div>
          <div class="price-delta tabular" :class="pctClass">
            {{ (quote?.change ?? 0) > 0 ? '+' : '' }}{{ fmtPrice(quote?.change ?? 0) }}
            <span>{{ fmtPct(quote?.change_pct ?? 0) }}</span>
          </div>
        </div>
        <div class="stat-row">
          <div class="stat"><span class="k">今开</span><span class="v tabular"
            :class="trendClass((quote?.open ?? 0) - (quote?.prev_close ?? 0))">{{ fmtPrice(quote?.open ?? 0) }}</span></div>
          <div class="stat"><span class="k">最高</span><span class="v tabular up">{{ fmtPrice(quote?.high ?? 0) }}</span></div>
          <div class="stat"><span class="k">最低</span><span class="v tabular down">{{ fmtPrice(quote?.low ?? 0) }}</span></div>
          <div class="stat"><span class="k">昨收</span><span class="v tabular">{{ fmtPrice(quote?.prev_close ?? 0) }}</span></div>
        </div>
        <div class="stat-row">
          <div class="stat"><span class="k">成交额</span><span class="v tabular">{{ fmtAmount(quote?.amount ?? 0) }}</span></div>
          <div class="stat"><span class="k">成交量</span><span class="v tabular">{{ fmtVolume(quote?.volume ?? 0) }}</span></div>
          <div class="stat"><span class="k">换手</span><span class="v tabular">{{ (quote?.turnover_rate ?? 0).toFixed(2) }}%</span></div>
          <div class="stat"><span class="k">振幅</span><span class="v tabular">{{ (quote?.amplitude ?? 0).toFixed(2) }}%</span></div>
        </div>
      </section>

      <!-- 图表 : 盘口 = 3 : 1 -->
      <section class="quote-row">
        <div class="card chart-card">
          <div class="chart-tabs">
            <button class="ctab" :class="{ on: mode === 'minute' }" @click="switchMode('minute')">分时</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '1min' }" @click="switchPeriod('1min')">1分</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '5min' }" @click="switchPeriod('5min')">5分</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '15min' }" @click="switchPeriod('15min')">15分</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '60min' }" @click="switchPeriod('60min')">60分</button>
          </div>
          <MiniChart v-if="mode === 'minute'" :minutes="minutes" :prev-close="quote?.prev_close ?? 0" :height="180" />
          <MiniChart v-else mode="kline" :bars="bars" :height="180" />
        </div>

        <div class="card depth-card">
          <div class="card-title">五档盘口</div>
          <div class="depth">
            <div v-for="(lv, i) in (depth?.asks ?? []).slice().reverse()" :key="'a' + i" class="depth-row">
              <span class="dk">卖{{ 5 - i }}</span>
              <span class="dp tabular down">{{ fmtPrice(lv.price) }}</span>
              <span class="dv tabular">{{ lv.volume }}</span>
            </div>
            <div class="spread" />
            <div v-for="(lv, i) in depth?.bids ?? []" :key="'b' + i" class="depth-row">
              <span class="dk">买{{ i + 1 }}</span>
              <span class="dp tabular up">{{ fmtPrice(lv.price) }}</span>
              <span class="dv tabular">{{ lv.volume }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 题材信息 -->
      <section v-if="meta" class="card">
        <div class="card-title">题材说明</div>
        <div class="meta-line"><span class="mk">热词</span><span class="tag tag-hot">{{ meta.hotword }}</span></div>
        <div class="meta-line"><span class="mk">行业</span><span>{{ meta.industry }}</span></div>
        <div class="meta-line"><span class="mk">题材</span><span class="muted">{{ meta.theme }}</span></div>
        <div class="meta-line"><span class="mk">涨跌停</span><span class="tabular">{{ fmtPrice(meta.limit_up) }} / {{ fmtPrice(meta.limit_down) }}</span></div>
        <div class="meta-line"><span class="mk">流通股</span><span class="tabular">{{ fmtAmount(meta.float_shares) }}</span></div>
      </section>
    </template>

    <!-- 底部交易条 -->
    <div class="trade-bar bottom-bar">
      <button class="btn btn-buy" @click="openSheet('buy')">买入</button>
      <button class="btn btn-sell" @click="openSheet('sell')">卖出</button>
    </div>

    <TradeSheet v-model:show="sheetShow" :code="code" :side="sheetSide" @submitted="onSubmitted" />
  </div>
</template>

<style scoped>
.head-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.code {
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}
.price-area {
  padding-top: 12px;
  padding-bottom: 12px;
}
.big-price {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
}
.price-delta {
  font-size: 14px;
  display: flex;
  gap: 8px;
  padding-bottom: 4px;
}
.stat-row {
  display: flex;
  margin-top: 10px;
  gap: 6px;
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.k {
  font-size: 10px;
  color: var(--c-text-3);
}
.v {
  font-size: 12px;
  font-weight: 600;
}

/* 横向留白只由这一层提供，卡片自身 margin 归零，避免两层边距叠加 */
.quote-row {
  display: flex;
  gap: 8px;
  padding: 0 14px 12px;
  align-items: stretch;
}
.chart-card {
  flex: 3 1 0;
  min-width: 0;
  margin: 0;
  padding: 10px 6px 8px;
}
.depth-card {
  flex: 1 1 0;
  min-width: 104px;
  max-width: 132px;
  margin: 0;
  padding: 10px 8px;
}
.depth-card .card-title {
  font-size: 12px;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spread {
  height: 1px;
  background: var(--c-line);
  margin: 3px 0;
}
.chart-tabs {
  display: flex;
  gap: 4px;
  padding: 0 2px 6px;
}
.ctab {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 7px;
  cursor: pointer;
}
.ctab.on {
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}
.card {
  margin: 0 14px 12px;
}
.card-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.depth {
  display: flex;
  flex-direction: column;
}
.depth-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 3px;
  font-size: 11px;
  padding: 2.5px 0;
}
.dk {
  color: var(--c-text-3);
  flex: 0 0 auto;
}
.dp {
  flex: 1 1 auto;
  text-align: right;
}
.dv {
  flex: 0 0 38px;
  text-align: right;
  color: var(--c-text-2);
}
.meta-line {
  display: flex;
  gap: 10px;
  font-size: 12px;
  padding: 4px 0;
}
.mk {
  color: var(--c-text-3);
  width: 52px;
  flex: 0 0 52px;
}
.watch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 5px 9px;
  cursor: pointer;
  white-space: nowrap;
}
.watch-btn.on {
  color: var(--c-brand);
  border-color: rgba(232, 56, 61, 0.45);
  background: rgba(232, 56, 61, 0.12);
}
.wico {
  width: 13px;
  height: 13px;
}
.trade-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  padding-bottom: calc(10px + var(--safe-bottom));
  z-index: 30;
}
.trade-bar .btn {
  flex: 1;
}
</style>
