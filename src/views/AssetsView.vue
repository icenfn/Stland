<script setup lang="ts">
/**
 * 资产页：总资产 / 风险画像 / 业绩 / 持仓。
 *
 * 本轮修正两个问题：
 *  1) 持仓与流水的时间戳一律走 toMillis 归一化 —— 服务端给的是「秒」，
 *     旧代码直接按毫秒渲染，导致时间显示成 1970 年（即用户看到的「时间戳错误」）；
 *  2) 风险偏好未测评时不再展示等级，而是引导去做风险测评（见 /risk）。
 *     同时把「行情更新于」做成可见提示，用户能判断数据是否真的在刷新。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi } from '@/api'
import type { AccountSummary, PositionItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import MiniChart from '@/components/MiniChart.vue'
import { fmtAgo, fmtAmount, fmtDateTime, fmtPct, fmtPrice, trendClass } from '@/utils/format'
import { levelLabel, levelTone, useRisk } from '@/stores/risk'

const router = useRouter()
const risk = useRisk()
const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const perf = ref<{ curve: Array<{ t: number; equity: number }>; metrics: any } | null>(null)
const error = ref('')
const updatedAt = ref(0)

const asset = computed(() => summary.value?.asset)
const riskInfo = computed(() => summary.value?.risk)

const curvePoints = computed(() => (perf.value?.curve ?? []).map((p) => ({ t: p.t, price: p.equity })))

async function refresh() {
  try {
    const [s, p] = await Promise.all([accountApi.summary(), accountApi.positions()])
    summary.value = s
    positions.value = p.items
    updatedAt.value = Date.now()
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
        <span v-if="updatedAt" class="upd-tag">{{ fmtAgo(updatedAt) }}</span>
        <button class="mini-btn" @click="router.push('/orders')">流水</button>
      </template>
    </AppBar>

    <!-- 资产卡 -->
    <section class="px sect">
      <div class="card asset-card">
        <div class="label">总资产（元）</div>
        <div class="total tabular">{{ fmtAmount(asset?.total_asset ?? 0) }}</div>
        <div class="pnl-row">
          <div class="pnl">
            <div class="text-xs">当日盈亏</div>
            <div class="tabular pnl-v" :class="trendClass(asset?.day_pnl ?? 0)">
              {{ (asset?.day_pnl ?? 0) > 0 ? '+' : '' }}{{ fmtPrice(asset?.day_pnl ?? 0) }}
            </div>
          </div>
          <div class="pnl">
            <div class="text-xs">累计已实现</div>
            <div class="tabular pnl-v" :class="trendClass(asset?.realized_pnl ?? 0)">
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

    <!-- 风险画像：未测评只给入口，不展示等级 -->
    <section class="px">
      <div class="card">
        <div class="row-between">
          <span class="card-h" style="margin: 0">风险画像</span>
          <button v-if="risk.assessed.value" class="mini-btn" @click="router.push('/risk')">
            {{ levelLabel(risk.level.value) }} · 重测
          </button>
          <button v-else class="mini-btn accent" @click="router.push('/risk')">去测风险偏好</button>
        </div>

        <template v-if="risk.assessed.value">
          <div class="risk-grid">
            <div class="rk"><span class="rk-v tabular">{{ riskInfo?.position_count ?? 0 }}</span><span class="rk-k">持仓数</span></div>
            <div class="rk"><span class="rk-v tabular">{{ (riskInfo?.concentration_hhi ?? 0).toFixed(0) }}</span><span class="rk-k">集中度HHI</span></div>
            <div class="rk"><span class="rk-v tabular">{{ (riskInfo?.portfolio_beta ?? 0).toFixed(2) }}</span><span class="rk-k">组合β</span></div>
            <div class="rk"><span class="rk-v tabular">{{ (riskInfo?.cash_ratio ?? 0).toFixed(1) }}%</span><span class="rk-k">现金比</span></div>
          </div>
          <p class="text-xs hint">
            风险等级：<span :style="{ color: levelTone(risk.level.value), fontWeight: 600 }">{{ levelLabel(risk.level.value) }}</span>
            · HHI &gt; 2500 表示高度集中；β &gt; 1 表示系统性风险高于市场。
          </p>
        </template>
        <p v-else class="text-xs hint">
          完成风险测评后，这里会显示与你的风险等级匹配的组合集中度、β 与现金比等指标。
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
          <div class="htime">
            成本 {{ fmtPrice(p.avg_cost, 4) }} · 更新 {{ p.updated_at ? fmtDateTime(p.updated_at) : '实时' }}
          </div>
        </div>
        <div class="hm">
          <div class="tabular hmv" :class="trendClass(p.unrealized_pnl)">{{ fmtPrice(p.market_value) }}</div>
          <div class="text-xs tabular" :class="trendClass(p.unrealized_pnl)">{{ fmtPct(p.unrealized_pct) }}</div>
        </div>
      </div>
    </section>

    <p class="disclaimer px">资产与盈亏由服务端账务引擎结算（现金 / 冻结 / 市值三账分离）。</p>
  </div>
</template>

<style scoped>
.sect {
  padding-top: 10px;
}
.mini-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 5px 10px;
  cursor: pointer;
}
.mini-btn.accent {
  color: #ff8b8d;
  border-color: rgba(232, 56, 61, 0.4);
  background: rgba(232, 56, 61, 0.12);
}
.upd-tag {
  font-size: 10px;
  color: var(--c-text-3);
  margin-right: 2px;
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
.pnl-row {
  display: flex;
  gap: 18px;
  margin-top: 6px;
}
.pnl-v {
  font-weight: 600;
  font-size: 13px;
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
.hint {
  margin: 8px 0 0;
  line-height: 1.65;
}
.risk-grid,
.perf-grid {
  display: flex;
  gap: 6px;
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
.htime {
  font-size: 10px;
  color: var(--c-text-3);
  margin-top: 2px;
}
.hm {
  text-align: right;
}
.hmv {
  font-weight: 600;
}
.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  padding: 14px;
  line-height: 1.6;
}
</style>
