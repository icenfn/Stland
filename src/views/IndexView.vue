<script setup lang="ts">
/**
 * 指数详情：指数和个股一样有代码，可以点进来看走势。
 *
 * 与个股页的差别（这也是为什么不合并成一个页面）：
 *  · 指数不可交易 —— 没有五档盘口、没有买入/卖出按钮，底部不放交易条；
 *  · 指数由成分股等权合成，所以要多两块信息：成分家数（涨/跌/平分布）与成分清单；
 *  · 分时/K 线由服务端按同样口径合成，图上最后一点与顶部点位一致。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { marketApi } from '@/api'
import type { BarItem, IndexQuote, StockMeta } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import MiniChart from '@/components/MiniChart.vue'
import { fmtAmount, fmtPct, fmtPrice, trendClass } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const code = String(route.params.code)

const quote = ref<IndexQuote | null>(null)
const meta = ref<StockMeta | null>(null)
const members = ref<Array<{ code: string; name: string; board: string; industry: string }>>([])
const minutes = ref<Array<{ t: number; price: number }>>([])
const bars = ref<BarItem[]>([])
const mode = ref<'minute' | 'kline'>('minute')
const period = ref('5min')
const error = ref('')

const pctClass = computed(() => trendClass(quote.value?.change_pct ?? 0))

async function loadDetail() {
  try {
    const res = await marketApi.indexDetail(code)
    quote.value = res.quote
    meta.value = res.meta
    members.value = res.members
    error.value = ''
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  }
}

async function loadChart() {
  try {
    if (mode.value === 'minute') {
      const res = await marketApi.indexMinutes(code, 240)
      minutes.value = res.items
    } else {
      const res = await marketApi.indexKline(code, period.value, 120)
      bars.value = res.items
    }
  } catch {
    /* 静默：图表失败不应挡住点位展示 */
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

useIntervalFn(loadDetail, 3000)

onMounted(async () => {
  await Promise.all([loadDetail(), loadChart()])
})
</script>

<template>
  <div class="page">
    <AppBar back>
      <template #title>
        <div class="head-title">
          <span>{{ meta?.name ?? '指数' }}</span>
          <span class="code">{{ code }}</span>
        </div>
      </template>
      <template #actions>
        <span class="tag tag-blue">指数</span>
      </template>
    </AppBar>

    <div v-if="error" class="empty">{{ error }}</div>

    <template v-else>
      <section class="px price-area">
        <div class="row" style="align-items: flex-end; gap: 12px">
          <div class="big-price tabular" :class="pctClass">{{ fmtPrice(quote?.price ?? 0) }}</div>
          <div class="price-delta tabular" :class="pctClass">
            {{ (quote?.change ?? 0) > 0 ? '+' : '' }}{{ fmtPrice(quote?.change ?? 0) }}
            <span>{{ fmtPct(quote?.change_pct ?? 0) }}</span>
          </div>
        </div>
        <div class="stat-row">
          <div class="stat">
            <span class="k">成分</span>
            <span class="v tabular">{{ quote?.members ?? 0 }} 只</span>
          </div>
          <div class="stat">
            <span class="k">上涨</span>
            <span class="v tabular up">{{ quote?.up ?? 0 }}</span>
          </div>
          <div class="stat">
            <span class="k">平盘</span>
            <span class="v tabular">{{ quote?.flat ?? 0 }}</span>
          </div>
          <div class="stat">
            <span class="k">下跌</span>
            <span class="v tabular down">{{ quote?.down ?? 0 }}</span>
          </div>
          <div class="stat">
            <span class="k">成交额</span>
            <span class="v tabular">{{ fmtAmount(quote?.amount ?? 0) }}</span>
          </div>
        </div>
        <p v-if="meta?.note" class="note text-xs">{{ meta.note }}</p>
      </section>

      <section class="px">
        <div class="card chart-card">
          <div class="chart-tabs">
            <button class="ctab" :class="{ on: mode === 'minute' }" @click="switchMode('minute')">分时</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '5min' }" @click="switchPeriod('5min')">5分</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '15min' }" @click="switchPeriod('15min')">15分</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '30min' }" @click="switchPeriod('30min')">30分</button>
            <button class="ctab" :class="{ on: mode === 'kline' && period === '60min' }" @click="switchPeriod('60min')">60分</button>
          </div>
          <MiniChart
            v-if="mode === 'minute'"
            :minutes="minutes"
            :prev-close="quote?.prev_close ?? 0"
            :height="200"
          />
          <MiniChart v-else mode="kline" :bars="bars" :height="200" />
        </div>
      </section>

      <section v-if="members.length" class="card">
        <div class="card-title">成分股（{{ members.length }}）</div>
        <div class="mem-grid">
          <button v-for="m in members" :key="m.code" class="mem" @click="router.push(`/stock/${m.code}`)">
            <span class="mem-name">{{ m.name }}</span>
            <span class="mem-code">{{ m.code }}</span>
          </button>
        </div>
      </section>

      <p class="disclaimer px">
        指数由成分股按等权归一化价格合成，点位与涨跌幅由行情引擎实时计算，不构成任何投资建议。
      </p>
    </template>
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
  padding-bottom: 10px;
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
  gap: 4px;
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.k {
  font-size: 10px;
  color: var(--c-text-3);
}
.v {
  font-size: 12px;
  font-weight: 600;
}
.note {
  margin: 8px 0 0;
  color: var(--c-text-3);
}
.chart-card {
  padding: 10px 6px 8px;
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
  padding: 4px 7px;
  border-radius: 7px;
  cursor: pointer;
}
.ctab.on {
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}
.card-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.mem-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mem {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  padding: 6px 9px;
  cursor: pointer;
}
.mem-name {
  font-size: 12px;
  color: var(--c-text);
}
.mem-code {
  font-size: 9px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}
.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  padding: 14px;
  line-height: 1.6;
}
</style>
