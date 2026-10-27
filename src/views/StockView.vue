<script setup lang="ts">
/** 个股详情：分时/K线 + 五档盘口 + 交易入口，仿东方财富个股页 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { marketApi, tradeApi } from '@/api'
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

/** 下单抽屉：不再跳转整页，保留当前个股的图表与盘口上下文 */
const sheetShow = ref(false)
const sheetSide = ref<'buy' | 'sell'>('buy')

function openSheet(side: 'buy' | 'sell') {
  sheetSide.value = side
  sheetShow.value = true
}

async function onSubmitted() {
  // 成交后立刻刷新盘口与价格，用户能马上看到结果
  await Promise.all([loadMeta(), loadDepth()])
}

const pctClass = computed(() => trendClass(quote.value?.change_pct ?? 0))

async function loadMeta() {
  try {
    const res = await marketApi.detail(code)
    quote.value = res.quote
    meta.value = res.meta
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
  await Promise.all([loadMeta(), loadDepth(), loadChart()])
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
          <div class="stat"><span class="k">今开</span><span class="v tabular" :class="trendClass((quote?.open ?? 0) - (quote?.prev_close ?? 0))">{{ fmtPrice(quote?.open ?? 0) }}</span></div>
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

      <!-- 图表 -->
      <section class="card chart-card">
        <div class="chart-tabs">
          <button class="ctab" :class="{ on: mode === 'minute' }" @click="switchMode('minute')">分时</button>
          <button class="ctab" :class="{ on: mode === 'kline' && period === '1min' }" @click="switchPeriod('1min')">1分</button>
          <button class="ctab" :class="{ on: mode === 'kline' && period === '5min' }" @click="switchPeriod('5min')">5分</button>
          <button class="ctab" :class="{ on: mode === 'kline' && period === '15min' }" @click="switchPeriod('15min')">15分</button>
          <button class="ctab" :class="{ on: mode === 'kline' && period === '60min' }" @click="switchPeriod('60min')">60分</button>
        </div>
        <MiniChart v-if="mode === 'minute'" :minutes="minutes" :prev-close="quote?.prev_close ?? 0" :height="186" />
        <MiniChart v-else mode="kline" :bars="bars" :height="186" />
      </section>

      <!-- 五档盘口 -->
      <section class="card">
        <div class="card-title">五档盘口</div>
        <div class="depth">
          <div class="depth-col">
            <div v-for="(lv, i) in (depth?.asks ?? []).slice().reverse()" :key="'a' + i" class="depth-row">
              <span class="dk">卖{{ 5 - i }}</span>
              <span class="dp tabular down">{{ fmtPrice(lv.price) }}</span>
              <span class="dv tabular">{{ lv.volume }}</span>
            </div>
          </div>
          <div class="depth-col">
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
.chart-card {
  margin: 0 14px 12px;
  padding: 10px 8px;
}
.chart-tabs {
  display: flex;
  gap: 4px;
  padding: 0 6px 8px;
}
.ctab {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 12px;
  padding: 4px 8px;
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
  gap: 14px;
}
.depth-col {
  flex: 1;
}
.depth-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 3px 0;
}
.dk {
  color: var(--c-text-3);
  width: 30px;
}
.dv {
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
