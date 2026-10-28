<script setup lang="ts">
/**
 * 资产页：总资产 / 风险偏好 / 持仓。
 *
 * 本轮两处删减：
 *  · 删除「单位」相关处理：原来金额走 fmtAmount 压成「12.34 万 / 1.23 亿」，
 *    用户核对「我到底有多少钱」还得心算还原。金额是精确量，不是观测量，
 *    改为千分位纯数字直出（fmtMoney），标签上也不再带（元）。
 *  · 删除「业绩表现」卡片及其接口调用：模拟盘里从成交记录反推的收益曲线
 *    既不准也没有产品意义，留着只会误导用户对自己收益的判断。
 *
 * 保留的结构调整：风险偏好仍在资产页（与资金属性同屏），且未测评时
 * 只显示「开始风险测评」按钮、不显示任何等级 —— 判据完全来自服务端。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi } from '@/api'
import type { AccountSummary, PositionItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { fmtAgo, fmtDateTime, fmtMoney, fmtPct, fmtPrice, fmtSignedMoney, trendClass } from '@/utils/format'
import { levelLabel, levelTone, useRisk } from '@/stores/risk'

const router = useRouter()
const risk = useRisk()
const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const error = ref('')
const updatedAt = ref(0)

const asset = computed(() => summary.value?.asset)

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

useIntervalFn(refresh, 4000)

onMounted(async () => {
  await Promise.all([refresh(), risk.refresh()])
})
</script>

<template>
  <div class="page">
    <AppBar title="我的资产">
      <template #actions>
        <span v-if="updatedAt" class="upd-tag">{{ fmtAgo(updatedAt) }}</span>
        <button class="mini-btn" @click="router.push('/orders')">流水</button>
      </template>
    </AppBar>

    <!-- 资产卡：纯数字，不带单位 -->
    <section class="px sect">
      <div class="card asset-card">
        <div class="label">总资产</div>
        <div class="total tabular">{{ fmtMoney(asset?.total_asset ?? 0) }}</div>
        <div class="pnl-row">
          <div class="pnl">
            <div class="text-xs">当日盈亏</div>
            <div class="tabular pnl-v" :class="trendClass(asset?.day_pnl ?? 0)">
              {{ fmtSignedMoney(asset?.day_pnl ?? 0) }}
            </div>
          </div>
          <div class="pnl">
            <div class="text-xs">累计已实现</div>
            <div class="tabular pnl-v" :class="trendClass(asset?.realized_pnl ?? 0)">
              {{ fmtSignedMoney(asset?.realized_pnl ?? 0) }}
            </div>
          </div>
        </div>

        <div class="asset-grid">
          <div class="ag-item">
            <span class="k">可用资金</span>
            <span class="v tabular">{{ fmtMoney(asset?.cash ?? 0) }}</span>
          </div>
          <div class="ag-item">
            <span class="k">冻结资金</span>
            <span class="v tabular">{{ fmtMoney(asset?.frozen_cash ?? 0) }}</span>
          </div>
          <div class="ag-item">
            <span class="k">持仓市值</span>
            <span class="v tabular">{{ fmtMoney(asset?.market_value ?? 0) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 风险偏好：未测评不显示等级，只给测评入口 -->
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
            <span class="text-xs tabular">{{ fmtDateTime(risk.assessedAt.value) }}</span>
          </div>
          <p class="text-xs hint">风险偏好用于匹配你可承受的仓位波动。</p>
        </template>
        <p v-else class="text-xs hint">尚未完成风险测评，因此不显示风险偏好。</p>

        <button class="btn btn-ghost btn-block risk-btn" @click="router.push('/risk')">
          {{ risk.assessed.value ? '重新测评' : '开始风险测评' }}
        </button>
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
          <div class="tabular hmv" :class="trendClass(p.unrealized_pnl)">{{ fmtMoney(p.market_value) }}</div>
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
  min-width: 0;
}
.ag-item .k {
  font-size: 10px;
  color: var(--c-text-3);
}
.ag-item .v {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
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
