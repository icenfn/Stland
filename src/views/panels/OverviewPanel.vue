<script setup lang="ts">
/**
 * 首页（概览）重写。
 *
 * 参考东方财富 / 同花顺 / 腾讯自选股的首页骨架，按「一眼看全局 → 一键进细看」组织：
 *   1) 指数横条：多指数并排，横向滚动，点哪个进哪个详情；
 *   2) 主指数大卡：点位、涨跌、分时缩略图、成交额；
 *   3) 账户卡（仅登录后）：总资产 + 当日盈亏 + 持仓市值，整卡点进交易页；
 *   4) 市场情绪：涨跌家数堆叠条，比三个孤立数字更快看出今天强还是弱；
 *   5) 榜单：涨幅 / 跌幅 / 成交额三档，行内直接下单入口在详情页。
 *
 * 相比旧版的三处结构性改动：
 *  · 旧版只有一张指数卡，看不到板块与其它指数；现在指数是集合，主卡只是「当前被选中的那个」；
 *  · 旧版没有账户信息，用户想知道「今天赚没赚」必须先切到交易页；现在首页就给结论；
 *  · 旧版涨跌家数是四个等宽格子，必须逐个读数才能比较强弱；现在多一条按比例堆叠的色带。
 *
 * 数据来源仍是行情状态层里的同一份推送快照（state.overview），本页不额外发请求；
 * 账户卡只在登录后单独取一次 /api/account/summary，失败就静默隐藏，不影响行情展示。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { vAutoAnimate } from '@formkit/auto-animate/vue'
import { accountApi } from '@/api'
import type { AccountSummary } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useMarket } from '@/stores/market'
import {
  fmtAmount,
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtSignedMoney,
  trendClass,
} from '@/utils/format'
import { storeToRefs } from 'pinia'
import MiniChart from '@/components/MiniChart.vue'
import QuoteRow from '@/components/QuoteRow.vue'

const router = useRouter()
const market = useMarket()
const auth = useAuth()
// state 是 reactive 对象，解构出来的仍是同一个代理，天然保持响应；
// 而 index / upCount / downCount / ready 是计算属性 —— Pinia 在 store 上把它们
// 解包成了值，直接解构会当场取快照、之后再也不更新（画面卡在首帧）。
// storeToRefs 保留它们的 ref 身份，模板自动解包、脚本里继续用 .value。
const { state } = market
const { index, upCount, downCount, ready } = storeToRefs(market)

const rankTab = ref<'gainers' | 'losers' | 'active'>('gainers')

const RANK_TABS = [
  { key: 'gainers', label: '涨幅榜' },
  { key: 'losers', label: '跌幅榜' },
  { key: 'active', label: '成交额' },
] as const

const rankList = computed(() => {
  const r = state.overview?.rank
  if (!r) return []
  return rankTab.value === 'gainers' ? r.gainers : rankTab.value === 'losers' ? r.losers : r.active
})

/** 指数集合：服务端下发全部指数，主卡只是其中被高亮的那个 */
const indices = computed(() => state.overview?.indices ?? [])
const indexMinutes = computed(() => state.overview?.index_minutes ?? [])
const totalAmount = computed(() => state.overview?.stats.total_amount ?? 0)
const flatCount = computed(() => state.overview?.stats.flat ?? 0)

/**
 * 涨跌堆叠条的三段宽度（百分比）。
 * 用「占已开盘家数的比例」而不是绝对家数：家数变化时色带总长恒定，
 * 一眼看的是强弱结构，不会被总数波动干扰。
 */
const distBar = computed(() => {
  const up = upCount.value
  const flat = flatCount.value
  const down = downCount.value
  const total = up + flat + down
  if (!total) return { up: 0, flat: 0, down: 0 }
  return {
    up: (up / total) * 100,
    flat: (flat / total) * 100,
    down: (down / total) * 100,
  }
})

/** 账户摘要：仅登录后取，失败静默隐藏（行情照常展示，不让一个可选卡片拖垮首页） */
const summary = ref<AccountSummary | null>(null)
const asset = computed(() => summary.value?.asset)

async function loadSummary() {
  if (!auth.state.user) {
    summary.value = null
    return
  }
  try {
    summary.value = await accountApi.summary()
  } catch {
    summary.value = null
  }
}

onMounted(loadSummary)
// 登录 / 退出会切换 user，账户卡跟着来去
watch(() => auth.state.user?.id, loadSummary)

function openIndex(code?: string) {
  if (!code) return
  void router.push(`/index/${code}`)
}

function openStock(code?: string) {
  if (!code) return
  void router.push(`/stock/${code}`)
}
</script>

<template>
  <div class="page home">
    <!-- ① 指数横条：横向滚动，点哪个进哪个详情。
         data-hscroll 让外层 swiper 把手势让给这条横向滚动条。 -->
    <div v-if="indices.length > 1" class="idx-strip" data-hscroll>
      <button
        v-for="it in indices"
        :key="it.code"
        class="idx-chip"
        @click="openIndex(it.code)"
      >
        <span class="ic-name">{{ it.name }}</span>
        <span class="ic-val tabular" :class="trendClass(it.change_pct)">
          {{ it.has_data === false ? '--' : fmtPrice(it.price) }}
        </span>
        <span class="ic-chg tabular" :class="trendClass(it.change_pct)">
          {{ it.has_data === false ? '--' : fmtPct(it.change_pct) }}
        </span>
      </button>
    </div>

    <!-- ② 主指数大卡 -->
    <section class="px sect">
      <div class="card index-card" @click="openIndex(index?.code)">
        <div class="row-between">
          <div class="grow">
            <div class="idx-head">
              <span class="index-name">{{ index?.name ?? '股岛综合指数' }}</span>
              <span class="idx-code tabular">{{ index?.code ?? '—' }}</span>
            </div>
            <div class="index-price tabular" :class="trendClass(index?.change)">
              {{ index?.has_data === false ? '--' : fmtPrice(index?.price) }}
            </div>
            <div class="index-change tabular" :class="trendClass(index?.change)">
              <template v-if="index?.has_data === false">--</template>
              <template v-else>
                {{ (index?.change ?? 0) > 0 ? '+' : '' }}{{ fmtPrice(index?.change) }}
                <span class="pct">{{ fmtPct(index?.change_pct) }}</span>
              </template>
            </div>
            <div class="idx-meta">
              <span>最高 <b class="tabular up">{{ fmtPrice(index?.high) }}</b></span>
              <span>最低 <b class="tabular down">{{ fmtPrice(index?.low) }}</b></span>
            </div>
          </div>
          <div class="chart-box">
            <MiniChart :minutes="indexMinutes" :prev-close="index?.prev_close ?? 0" :height="86" />
          </div>
        </div>

        <p v-if="state.lastError" class="err-line">行情获取失败：{{ state.lastError }}</p>
      </div>
    </section>

    <!-- ③ 账户卡：登录后才有。整卡点进交易页，首页就能回答「今天赚没赚」 -->
    <section v-if="auth.state.user && asset" class="px">
      <div class="card acct-card" @click="router.push('/trade')">
        <div class="row-between">
          <span class="acct-label">总资产（元）</span>
          <span class="acct-link">交易 ›</span>
        </div>
        <div class="acct-total tabular">{{ fmtMoney(asset.total_asset) }}</div>
        <div class="acct-row">
          <div class="acct-cell">
            <span class="ak">当日盈亏</span>
            <span class="av tabular" :class="trendClass(asset.day_pnl)">
              {{ fmtSignedMoney(asset.day_pnl) }}
            </span>
          </div>
          <div class="acct-cell">
            <span class="ak">持仓市值</span>
            <span class="av tabular">{{ fmtMoney(asset.market_value) }}</span>
          </div>
          <div class="acct-cell">
            <span class="ak">可用资金</span>
            <span class="av tabular">{{ fmtMoney(asset.cash) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ④ 市场情绪：堆叠色带 + 家数，比孤立数字更快看出强弱 -->
    <section class="px">
      <div class="card mood-card">
        <div class="row-between mood-head">
          <span class="card-h">涨跌分布</span>
          <span class="text-xs">总成交 {{ ready ? fmtAmount(totalAmount) : '--' }}</span>
        </div>

        <div class="dist-bar">
          <span class="seg up-seg" :style="{ width: distBar.up + '%' }" />
          <span class="seg flat-seg" :style="{ width: distBar.flat + '%' }" />
          <span class="seg down-seg" :style="{ width: distBar.down + '%' }" />
        </div>

        <div class="dist-legend">
          <div class="dl-item">
            <span class="dot up-dot" />
            <span class="dl-k">上涨</span>
            <span class="dl-v tabular up">{{ ready ? upCount : '--' }}</span>
          </div>
          <div class="dl-item">
            <span class="dot flat-dot" />
            <span class="dl-k">平盘</span>
            <span class="dl-v tabular flat">{{ ready ? flatCount : '--' }}</span>
          </div>
          <div class="dl-item">
            <span class="dot down-dot" />
            <span class="dl-k">下跌</span>
            <span class="dl-v tabular down">{{ ready ? downCount : '--' }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ⑤ 榜单 -->
    <section class="rank">
      <div class="rank-tabs" data-hscroll>
        <button
          v-for="t in RANK_TABS"
          :key="t.key"
          class="rank-tab"
          :class="{ on: rankTab === t.key }"
          @click="rankTab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-if="!rankList.length" v-auto-animate class="rank-skeleton">
        <div v-for="i in 5" :key="i" class="sk-row">
          <div class="skeleton" style="width: 38%; height: 13px" />
          <div class="skeleton" style="width: 22%; height: 13px" />
        </div>
      </div>
      <!-- 切榜单时行是整批替换的，交给 auto-animate 做轻量过渡，避免硬闪 -->
      <div v-else v-auto-animate>
        <QuoteRow v-for="q in rankList" :key="q.code" :quote="q" />
      </div>

      <button class="more-btn" @click="openStock(rankList[0]?.code)">
        查看全部行情 ›
      </button>
    </section>

    <p class="disclaimer px">
      本系统为自包含模拟交易环境，全部行情由内置引擎生成，不构成任何投资建议。
    </p>
  </div>
</template>

<style scoped>
.sect {
  padding-top: 10px;
}

/* ---- 指数横条 ---- */
.idx-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 14px 2px;
  scrollbar-width: none;
}
.idx-strip::-webkit-scrollbar {
  display: none;
}
.idx-chip {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 92px;
  padding: 8px 11px;
  border-radius: var(--r-md);
  background: var(--c-card);
  border: 1px solid var(--c-line);
  color: var(--c-text);
  text-align: left;
  cursor: pointer;
}
.idx-chip:active {
  background: var(--c-card-2);
}
.ic-name {
  font-size: 11px;
  color: var(--c-text-2);
  white-space: nowrap;
}
.ic-val {
  font-size: 14px;
  font-weight: 700;
}
.ic-chg {
  font-size: 11px;
  font-weight: 600;
}

/* ---- 主指数卡 ---- */
.index-card {
  background: linear-gradient(150deg, #1d2837, #151d29);
}
.idx-head {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.index-name {
  font-size: 12px;
  color: var(--c-text-2);
}
.idx-code {
  font-size: 10px;
  color: var(--c-text-3);
}
.index-price {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
  margin-top: 2px;
}
.index-change {
  font-size: 12px;
  margin-top: 2px;
}
.pct {
  margin-left: 6px;
}
.idx-meta {
  display: flex;
  gap: 12px;
  margin-top: 7px;
  font-size: 10px;
  color: var(--c-text-3);
}
.idx-meta b {
  font-weight: 600;
}
.chart-box {
  width: 122px;
  flex: 0 0 auto;
}
.err-line {
  margin: 10px 0 0;
  font-size: 11px;
  color: #ff8b8d;
  line-height: 1.5;
}

/* ---- 账户卡 ---- */
.acct-card {
  background: linear-gradient(150deg, #21313f, #161f2a);
  cursor: pointer;
}
.acct-label {
  font-size: 11px;
  color: var(--c-text-2);
}
.acct-link {
  font-size: 11px;
  color: var(--c-brand);
}
.acct-total {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.4px;
  margin: 3px 0 8px;
}
.acct-row {
  display: flex;
  gap: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--c-line);
}
.acct-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ak {
  font-size: 10px;
  color: var(--c-text-3);
}
.av {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- 市场情绪 ---- */
.mood-head {
  margin-bottom: 10px;
}
.card-h {
  font-size: 13px;
  font-weight: 600;
}
.dist-bar {
  display: flex;
  height: 7px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--c-bg-elevated);
}
.seg {
  display: block;
  height: 100%;
  transition: width 0.35s ease;
}
.up-seg {
  background: linear-gradient(90deg, #ff5c5e, #e8383d);
}
.flat-seg {
  background: #4b5563;
}
.down-seg {
  background: linear-gradient(90deg, #0a8f52, #1cc477);
}
.dist-legend {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.dl-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.up-dot {
  background: var(--c-up);
}
.flat-dot {
  background: #6b7280;
}
.down-dot {
  background: var(--c-down);
}
.dl-k {
  font-size: 10px;
  color: var(--c-text-3);
}
.dl-v {
  font-size: 12px;
  font-weight: 700;
  margin-left: auto;
}

/* ---- 榜单 ---- */
.rank {
  margin-top: 12px;
  background: var(--c-card);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  border-top: 1px solid var(--c-line);
  overflow: hidden;
}
.rank-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 12px 8px;
}
.rank-tab {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.rank-tab.on {
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.12);
}
.rank-skeleton {
  padding: 4px 14px 12px;
}
.sk-row {
  display: flex;
  justify-content: space-between;
  padding: 11px 0;
  border-bottom: 1px solid var(--c-line);
}
.more-btn {
  width: 100%;
  background: none;
  border: none;
  border-top: 1px solid var(--c-line);
  color: var(--c-text-3);
  font-size: 12px;
  padding: 13px 0;
  cursor: pointer;
}

.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  margin: 14px 0 8px;
  line-height: 1.6;
}
</style>
