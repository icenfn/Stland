<script setup lang="ts">
/**
 * 首页：指数卡 + 涨跌分布 + 榜单，并作为下单抽屉的主要入口。
 *
 * 本轮针对「一直加载中 / 显示连接中 / 全是 0」做了三处结构性修正：
 *  1) 造成功率数据为空的根因是请求未通过服务端签名校验（见 config/app.config.json），
 *     修好后这里不再需要「加载中」兜底，改为明确的三种状态：骨架 / 数据 / 错误重试；
 *  2) 顶部胶囊不再笼统显示「连接中」，而是如实反映当前通道：推送/轮询/离线，
 *     用户能一眼看出是没连上还是没数据；
 *  3) 买入/卖出不再跳整页，直接在底部抽屉里完成，保留用户对当前榜单的上下文。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMarket } from '@/stores/market'
import { fmtAmount, fmtPct, fmtPrice, trendClass } from '@/utils/format'
import MiniChart from '@/components/MiniChart.vue'
import QuoteRow from '@/components/QuoteRow.vue'
import TradeSheet from '@/components/TradeSheet.vue'

const router = useRouter()
const market = useMarket()
const { state, session, index, upCount, downCount, ready } = market

const rankTab = ref<'gainers' | 'losers' | 'active'>('gainers')
const sheetShow = ref(false)
const sheetCode = ref('')
const sheetSide = ref<'buy' | 'sell'>('buy')

const rankList = computed(() => {
  const r = state.overview?.rank
  if (!r) return []
  return rankTab.value === 'gainers' ? r.gainers : rankTab.value === 'losers' ? r.losers : r.active
})

const indexMinutes = computed(() => state.overview?.index_minutes ?? [])
const totalAmount = computed(() => state.overview?.stats.total_amount ?? 0)

/** 通道状态 → 文案与配色：区分「没连上」与「连上但没数据」 */
const feedLabel = computed(() => {
  if (state.feed === 'socket') return '实时'
  if (state.feed === 'polling') return '轮询'
  if (state.feed === 'offline') return '离线'
  return '连接中'
})

function openSheet(side: 'buy' | 'sell', code = '') {
  // 未指定标的时默认用榜单第一支，避免抽屉空着让用户再找一次
  const fallback = rankList.value[0]?.code ?? state.quotes[0]?.code ?? ''
  sheetCode.value = code || fallback
  sheetSide.value = side
  sheetShow.value = true
}

onMounted(() => market.start(1500))
onBeforeUnmount(() => market.stop())
</script>

<template>
  <div class="page home">
    <header class="app-bar">
      <div class="app-bar__inner">
        <div class="brand">股岛</div>
        <div class="grow" />
        <span class="feed-chip" :class="state.feed">{{ feedLabel }}</span>
        <span class="session-chip" :class="{ open: session?.can_trade }">
          {{ session?.label ?? '休市' }}
        </span>
      </div>
    </header>

    <!-- 指数卡 -->
    <section class="px sect">
      <div class="card index-card">
        <div class="row-between">
          <div class="grow">
            <div class="index-name">{{ index?.name ?? '股岛综合指数' }}</div>
            <div class="index-price tabular" :class="trendClass(index?.change ?? 0)">
              {{ ready ? fmtPrice(index?.price ?? 0) : '--' }}
            </div>
            <div class="index-change tabular" :class="trendClass(index?.change ?? 0)">
              {{ (index?.change ?? 0) > 0 ? '+' : '' }}{{ fmtPrice(index?.change ?? 0) }}
              <span class="pct">{{ fmtPct(index?.change_pct ?? 0) }}</span>
            </div>
          </div>
          <div class="chart-box">
            <MiniChart :minutes="indexMinutes" :prev-close="index?.prev_close ?? 0" :height="76" />
          </div>
        </div>

        <div class="dist">
          <div class="dist-item">
            <span class="dist-num up tabular">{{ ready ? upCount : '--' }}</span>
            <span class="text-xs">上涨</span>
          </div>
          <div class="dist-item">
            <span class="dist-num flat tabular">{{ ready ? state.overview?.stats.flat ?? 0 : '--' }}</span>
            <span class="text-xs">平盘</span>
          </div>
          <div class="dist-item">
            <span class="dist-num down tabular">{{ ready ? downCount : '--' }}</span>
            <span class="text-xs">下跌</span>
          </div>
          <div class="dist-item wide">
            <span class="dist-num tabular">{{ ready ? fmtAmount(totalAmount) : '--' }}</span>
            <span class="text-xs">总成交额</span>
          </div>
        </div>

        <p v-if="state.lastError" class="err-line">
          行情获取失败：{{ state.lastError }}
        </p>
      </div>
    </section>

    <!-- 快捷入口 -->
    <section class="px">
      <div class="quick">
        <button class="quick-item" @click="openSheet('buy')">
          <div class="quick-ico buy">买</div>
          <span>买入</span>
        </button>
        <button class="quick-item" @click="openSheet('sell')">
          <div class="quick-ico sell">卖</div>
          <span>卖出</span>
        </button>
        <button class="quick-item" @click="router.push('/orders')">
          <div class="quick-ico">单</div>
          <span>委托</span>
        </button>
        <button class="quick-item" @click="router.push('/assets')">
          <div class="quick-ico">仓</div>
          <span>持仓</span>
        </button>
        <button class="quick-item" @click="router.push('/market')">
          <div class="quick-ico">行</div>
          <span>行情</span>
        </button>
      </div>
    </section>

    <!-- 榜单 -->
    <section class="rank">
      <div class="rank-tabs">
        <button class="rank-tab" :class="{ on: rankTab === 'gainers' }" @click="rankTab = 'gainers'">涨幅榜</button>
        <button class="rank-tab" :class="{ on: rankTab === 'losers' }" @click="rankTab = 'losers'">跌幅榜</button>
        <button class="rank-tab" :class="{ on: rankTab === 'active' }" @click="rankTab = 'active'">成交额</button>
      </div>

      <div v-if="!rankList.length" class="rank-skeleton">
        <div v-for="i in 5" :key="i" class="sk-row">
          <div class="skeleton" style="width: 38%; height: 13px" />
          <div class="skeleton" style="width: 22%; height: 13px" />
        </div>
      </div>
      <QuoteRow v-for="q in rankList" :key="q.code" :quote="q" show-hotword />
    </section>

    <p class="disclaimer px">
      本系统为自包含模拟交易环境，全部行情由内置引擎生成，不构成任何投资建议。
    </p>

    <TradeSheet v-model:show="sheetShow" :code="sheetCode" :side="sheetSide"
      @submitted="() => { market.refreshAll() }" />
  </div>
</template>

<style scoped>
.brand {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 2px;
  background: linear-gradient(120deg, #ff6b6d, #ffb45c);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.sect {
  padding-top: 10px;
}
.feed-chip,
.session-chip {
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-text-2);
  margin-left: 6px;
}
.feed-chip.socket {
  background: rgba(18, 183, 106, 0.16);
  color: #4ade9b;
}
.feed-chip.polling {
  background: rgba(240, 160, 32, 0.16);
  color: #f5c26b;
}
.feed-chip.offline {
  background: rgba(255, 77, 79, 0.16);
  color: #ff8b8d;
}
.session-chip.open {
  background: rgba(255, 77, 79, 0.16);
  color: #ff8b8d;
}

.index-card {
  background: linear-gradient(150deg, #1d2837, #151d29);
}
.index-name {
  font-size: 12px;
  color: var(--c-text-2);
}
.index-price {
  font-size: 27px;
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
.chart-box {
  width: 118px;
  flex: 0 0 auto;
}
.err-line {
  margin: 10px 0 0;
  font-size: 11px;
  color: #ff8b8d;
  line-height: 1.5;
}

.dist {
  display: flex;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--c-line);
  gap: 8px;
}
.dist-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.dist-item.wide {
  flex: 1.6;
}
.dist-num {
  font-size: 15px;
  font-weight: 600;
}

.quick {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  padding: 12px;
  background: var(--c-card);
  border-radius: var(--r-lg);
  border: 1px solid var(--c-line);
}
.quick-item {
  background: none;
  border: none;
  color: var(--c-text-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  cursor: pointer;
  flex: 1;
}
.quick-ico {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.07);
  color: var(--c-text);
}
.quick-ico.buy {
  background: rgba(255, 77, 79, 0.18);
  color: #ff8b8d;
}
.quick-ico.sell {
  background: rgba(18, 183, 106, 0.18);
  color: #4ade9b;
}

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

.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  margin: 14px 0 8px;
  line-height: 1.6;
}
</style>
