<script setup lang="ts">
/** 资产页：总览 + 持仓 + 业绩指标，仿理财通资产管理页 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi } from '@/api'
import type { AccountSummary, PositionItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import MiniChart from '@/components/MiniChart.vue'
import { fmtAmount, fmtPrice, fmtPct, trendClass } from '@/utils/format'

const router = useRouter()
const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const perf = ref<{ curve: Array<{ t: number; equity: number }>; metrics: any } | null>(null)
const error = ref('')

const asset = computed(() => summary.value?.asset)
const risk = computed(() => summary.value?.risk)

const curvePoints = computed(() =>
  (perf.value?.curve ?? []).map((p) => ({ t: p.t, price: p.equity })),
)

async function refresh() {
  try {
    const [s, p] = await Promise.all([accountApi.summary(), accountApi.positions()])
    summary.value = s
    positions.value = p.items
    error.value = ''
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  }
}

async function loadPerf() {
  try {
    perf.value = await accountApi.performance()
  } catch {
    perf.value = null
  }
}

useIntervalFn(refresh, 4000)

onMounted(async () => {
  await refresh()
  await loadPerf()
})
onBeforeUnmount(() => {})
</script>

<template>
  <div class="page">
    <AppBar title="我的资产">
      <template #actions>
        <button class="mini-btn" @click="router.push('/orders')">流水</button>
      </template>
    </AppBar>

    <!-- 资产卡 -->
    <section class="px" style="padding-top: 12px">
      <div class="card asset-card">
        <div class="label">总资产（元）</div>
        <div class="total tabular">{{ fmtAmount(asset?.total_asset ?? 0) }}</div>
        <div class="row" style="gap: 16px; margin-top: 6px">
          <div>
            <div class="text-xs">当日盈亏</div>
            <div class="tabular" :class="trendClass(asset?.day_pnl ?? 0)" style="font-weight: 600">
              {{ (asset?.day_pnl ?? 0) > 0 ? '+' : '' }}{{ fmtPrice(asset?.day_pnl ?? 0) }}
            </div>
          </div>
          <div>
            <div class="text-xs">累计已实现</div>
            <div class="tabular" :class="trendClass(asset?.realized_pnl ?? 0)" style="font-weight: 600">
              {{ (asset?.realized_pnl ?? 0) > 0 ? '+' : '' }}{{ fmtPrice(asset?.realized_pnl ?? 0) }}
            </div>
          </div>
        </div>

        <div class="asset-grid">
          <div class="ag-item">
            <span class="k">可用资金</span>
            <span class="v tabular">{{ fmtAmount(asset?.cash ?? 0) }}</span>
          </div>
          <div class="ag-item">
            <span class="k">冻结资金</span>
            <span class="v tabular">{{ fmtAmount(asset?.frozen_cash ?? 0) }}</span>
          </div>
          <div class="ag-item">
            <span class="k">持仓市值</span>
            <span class="v tabular">{{ fmtAmount(asset?.market_value ?? 0) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 风控指标 -->
    <section class="px">
      <div class="card">
        <div class="card-h">风险画像</div>
        <div class="risk-grid">
          <div class="rk"><span class="rk-v tabular">{{ risk?.position_count ?? 0 }}</span><span class="rk-k">持仓数</span></div>
          <div class="rk"><span class="rk-v tabular">{{ (risk?.concentration_hhi ?? 0).toFixed(0) }}</span><span class="rk-k">集中度HHI</span></div>
          <div class="rk"><span class="rk-v tabular">{{ (risk?.portfolio_beta ?? 0).toFixed(2) }}</span><span class="rk-k">组合β</span></div>
          <div class="rk"><span class="rk-v tabular">{{ (risk?.cash_ratio ?? 0).toFixed(1) }}%</span><span class="rk-k">现金比</span></div>
        </div>
        <p class="text-xs" style="margin-top: 8px; line-height: 1.6">
          HHI &gt; 2500 表示组合高度集中；β &gt; 1 表示系统性风险暴露高于市场。
        </p>
      </div>
    </section>

    <!-- 业绩 -->
    <section v-if="perf && perf.metrics" class="px">
      <div class="card">
        <div class="card-h">业绩表现</div>
        <MiniChart :minutes="curvePoints" :prev-close="curvePoints[0]?.price ?? 0" :height="90" />
        <div class="perf-grid">
          <div class="pf"><span class="pf-v tabular">{{ fmtPct(perf.metrics.total_return_pct) }}</span><span class="pf-k">总收益率</span></div>
          <div class="pf"><span class="pf-v tabular">{{ perf.metrics.sharpe }}</span><span class="pf-k">夏普比率</span></div>
          <div class="pf"><span class="pf-v tabular down">{{ perf.metrics.max_drawdown_pct }}%</span><span class="pf-k">最大回撤</span></div>
          <div class="pf"><span class="pf-v tabular">{{ perf.metrics.win_rate_pct }}%</span><span class="pf-k">胜率</span></div>
        </div>
      </div>
    </section>

    <!-- 持仓 -->
    <section class="holdings">
      <div class="hold-head">
        <span class="card-h" style="margin: 0">持仓 {{ positions.length }}</span>
        <span class="text-xs">点击查看详情</span>
      </div>

      <div v-if="error" class="empty">{{ error }}</div>
      <div v-else-if="!positions.length" class="empty">暂无持仓，去行情页挑一支买入吧</div>

      <div v-for="p in positions" :key="p.code" class="hold-row" @click="router.push(`/stock/${p.code}`)">
        <div class="hl">
          <div class="hname">{{ p.name }}</div>
          <div class="hsub">
            <span>{{ p.code }}</span>
            <span>持仓 {{ p.quantity }}</span>
            <span>可卖 {{ p.available }}</span>
          </div>
        </div>
        <div class="hm">
          <div class="tabular" :class="trendClass(p.unrealized_pnl)" style="font-weight: 600">
            {{ fmtPrice(p.market_value) }}
          </div>
          <div class="text-xs tabular" :class="trendClass(p.unrealized_pnl)">
            {{ fmtPct(p.unrealized_pct) }}
          </div>
        </div>
      </div>
    </section>

    <p class="disclaimer px">资产与盈亏均由服务端账务引擎实时结算（现金/冻结/市值三账分离）。</p>
  </div>
</template>

<style scoped>
.mini-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 5px 10px;
  cursor: pointer;
}
.asset-card {
  background: linear-gradient(150deg, #22303f, #161f2a);
}
.label {
  font-size: 11px;
  color: var(--c-text-2);
}
.total {
  font-size: 30px;
  font-weight: 700;
  margin: 4px 0 2px;
  letter-spacing: -0.5px;
}
.asset-grid {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--c-line);
}
.ag-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ag-item .k {
  font-size: 10px;
  color: var(--c-text-3);
}
.ag-item .v {
  font-size: 13px;
  font-weight: 600;
}
.card-h {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.risk-grid,
.perf-grid {
  display: flex;
  gap: 6px;
}
.perf-grid {
  margin-top: 10px;
}
.rk,
.pf {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 0;
  background: var(--c-bg-elevated);
  border-radius: 10px;
}
.rk-v,
.pf-v {
  font-size: 15px;
  font-weight: 700;
}
.rk-k,
.pf-k {
  font-size: 10px;
  color: var(--c-text-3);
}
.holdings {
  margin-top: 12px;
}
.hold-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 14px 8px;
}
.hold-row {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-top: 1px solid var(--c-line);
  background: var(--c-card);
  cursor: pointer;
}
.hl {
  flex: 1;
  min-width: 0;
}
.hname {
  font-size: 15px;
  font-weight: 600;
}
.hsub {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--c-text-3);
  margin-top: 3px;
}
.hm {
  text-align: right;
}
.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  padding: 14px;
  line-height: 1.6;
}
</style>
