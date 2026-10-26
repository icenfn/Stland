<script setup lang="ts">
import { apiConfig } from '@/config'
/** 机构交易台：持仓集中度监控 + 批量下单 + 融资额度，仅机构角色可见 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi, tradeApi } from '@/api'
import { useAuth } from '@/stores/auth'
import type { AccountSummary, PositionItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtPrice, fmtPct, trendClass } from '@/utils/format'

const router = useRouter()
const auth = useAuth()
const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const batchCode = ref('688302')
const batchQty = ref('1000')
const batchSide = ref<'buy' | 'sell'>('buy')
const message = ref('')

const asset = computed(() => summary.value?.asset)
const risk = computed(() => summary.value?.risk)

async function refresh() {
  try {
    const [s, p] = await Promise.all([accountApi.summary(), accountApi.positions()])
    summary.value = s
    positions.value = p.items
  } catch (e: any) {
    message.value = e?.message ?? '加载失败'
  }
}

async function submitBatch() {
  message.value = ''
  try {
    const res = await tradeApi.order({
      code: batchCode.value.trim(),
      side: batchSide.value,
      quantity: Number(batchQty.value),
      order_type: 'market',
    })
    message.value = `批量委托已提交：${res.order.status}，成交 ${res.order.filled_quantity} 股，均价 ${fmtPrice(res.order.avg_fill_price, 4)}`
    await refresh()
  } catch (e: any) {
    message.value = e?.message ?? '提交失败'
  }
}

useIntervalFn(refresh, apiConfig.polling.accountMs)
onMounted(refresh)
</script>

<template>
  <div class="page">
    <AppBar back title="机构交易台">
      <template #actions>
        <span class="tag tag-blue">{{ auth.state.user?.display_name }}</span>
      </template>
    </AppBar>

    <section class="px" style="padding-top: 12px">
      <div class="card kpi-card">
        <div class="row-between">
          <div>
            <div class="text-xs">总资产</div>
            <div class="kpi tabular">{{ fmtAmount(asset?.total_asset ?? 0) }}</div>
          </div>
          <div style="text-align: right">
            <div class="text-xs">可用融资额度</div>
            <div class="kpi-sub tabular">{{ fmtAmount(asset?.credit_limit ?? 0) }}</div>
          </div>
        </div>
        <div class="kpi-grid">
          <div class="kg"><span class="kg-k">可用资金</span><span class="kg-v tabular">{{ fmtAmount(asset?.cash ?? 0) }}</span></div>
          <div class="kg"><span class="kg-k">持仓市值</span><span class="kg-v tabular">{{ fmtAmount(asset?.market_value ?? 0) }}</span></div>
          <div class="kg"><span class="kg-k">组合β</span><span class="kg-v tabular">{{ (risk?.portfolio_beta ?? 0).toFixed(2) }}</span></div>
        </div>
      </div>
    </section>

    <section class="px">
      <div class="card">
        <div class="card-h">批量下单（市价执行）</div>
        <div class="form-row">
          <span class="flabel">标的代码</span>
          <input v-model="batchCode" class="input tabular" style="flex: 1" placeholder="6 位代码" />
        </div>
        <div class="form-row">
          <span class="flabel">数量（股）</span>
          <input v-model="batchQty" class="input tabular" style="flex: 1" type="number" />
        </div>
        <div class="seg-row">
          <button class="seg" :class="{ on: batchSide === 'buy' }" @click="batchSide = 'buy'">买入</button>
          <button class="seg sell" :class="{ on: batchSide === 'sell' }" @click="batchSide = 'sell'">卖出</button>
          <button class="btn btn-primary" style="flex: 1.4; padding: 10px" @click="submitBatch">提交</button>
        </div>
        <p v-if="message" class="msg">{{ message }}</p>
        <p class="text-xs" style="line-height: 1.7">
          市价单按五档盘口逐档吃单，以第五档为保护价；超出保护价的剩余部分自动撤销（防极端滑点）。
        </p>
      </div>
    </section>

    <section class="holdings">
      <div class="hold-head"><span class="card-h" style="margin: 0">持仓明细</span></div>
      <div v-if="!positions.length" class="empty">暂无持仓</div>
      <div v-for="p in positions" :key="p.code" class="hold-row" @click="router.push(`/stock/${p.code}`)">
        <div class="hl">
          <div class="hname">{{ p.name }}</div>
          <div class="hsub"><span>{{ p.code }}</span><span>持仓 {{ p.quantity }}</span><span>可卖 {{ p.available }}</span></div>
        </div>
        <div class="hm">
          <div class="tabular">{{ fmtPrice(p.market_value) }}</div>
          <div class="text-xs tabular" :class="trendClass(p.unrealized_pnl)">{{ fmtPct(p.unrealized_pct) }}</div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.kpi-card {
  background: linear-gradient(150deg, #1f2c3b, #151d27);
}
.kpi {
  font-size: 26px;
  font-weight: 700;
  margin-top: 2px;
}
.kpi-sub {
  font-size: 15px;
  font-weight: 600;
  color: #7aa9ff;
  margin-top: 2px;
}
.kpi-grid {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--c-line);
}
.kg {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.kg-k {
  font-size: 10px;
  color: var(--c-text-3);
}
.kg-v {
  font-size: 13px;
  font-weight: 600;
}
.card-h {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.flabel {
  width: 66px;
  flex: 0 0 66px;
  font-size: 12px;
  color: var(--c-text-2);
}
.seg-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.seg {
  flex: 1;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: 9px;
  color: var(--c-text-2);
  font-size: 13px;
  padding: 10px 0;
  cursor: pointer;
}
.seg.on {
  background: rgba(255, 77, 79, 0.16);
  border-color: var(--c-brand);
  color: #ff8b8d;
  font-weight: 600;
}
.seg.sell.on {
  background: rgba(18, 183, 106, 0.16);
  border-color: #12b76a;
  color: #4ade9b;
}
.msg {
  font-size: 12px;
  color: #69e2a5;
  margin: 10px 0 0;
}
.holdings {
  margin-top: 12px;
}
.hold-head {
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
</style>
