<script setup lang="ts">
/**
 * 资产页：总资产 / 风险偏好 / 业绩 / 持仓。
 *
 * 本轮结构调整：
 *  · 删除「风险画像」卡片（持仓数 / 集中度 HHI / 组合β / 现金比）。
 *    这四个指标与下方的持仓明细、资产构成高度重复，且 HHI/β 对普通用户
 *    没有可执行的决策含义，属于「为展示而展示」的冗余模块；
 *  · 把「风险偏好」从「我的」页迁到这里。风险偏好本质是资金属性，
 *    与资产、持仓同屏才有意义（用户看完风险等级，紧接着就看见自己的仓位）；
 *  · 持仓与流水时间戳一律经 toMillis 归一化（服务端是秒级时间戳，
 *    直接按毫秒渲染会显示成 1970 年）。
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

    <!-- 风险偏好：未测评时不显示等级，只给测评入口 -->
    <section class="px">
      <div class="card">
        <div class="row-between">
          <span class="card-h" style="margin: 0">风险偏好</span>
          <span class="text-xs">{{ risk.assessed.value ? '已测评' : '未评估' }}</span>
        </div>

        <template v-if="risk.assessed.value">
          <div class="risk-show">
            <span class="risk-level" :style="{ color: levelTone(risk.level.value) }">
              {{ levelLabel(risk.level.value) }}
            </span>
            <span class="text-xs tabular">
              {{ risk.score.value }} 分 · {{ fmtDateTime(risk.assessedAt.value) }}
            </span>
          </div>
          <p class="text-xs hint">
            风险偏好用于匹配你可承受的仓位波动；等级随测评结果更新，口径调整后需重新测评。
          </p>
        </template>
        <p v-else class="text-xs hint">
          尚未完成风险测评，因此不显示风险偏好。先答 5 道题，再得到结论。
        </p>

        <button class="btn btn-ghost btn-block risk-btn" @click="router.push('/risk')">
          {{ risk.assessed.value ? '重新测评' : '开始风险测评' }}
        </button>
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
.risk-show {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--c-bg-elevated);
  border-radius: 10px;
}
.risk-level {
  font-size: 17px;
  font-weight: 700;
}
.risk-btn {
  margin-top: 12px;
  font-size: 13px;
  padding: 10px 16px;
}
.perf-grid {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
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
.pf-v {
  font-size: 15px;
  font-weight: 700;
}
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
