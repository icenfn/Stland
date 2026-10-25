<script setup lang="ts">
import { feedback } from '@/naive'
/** 委托与成交：双 Tab，支持撤单 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { tradeApi } from '@/api'
import type { OrderItem, TradeItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { fmtDateTime, fmtPrice, sideLabel, statusLabel } from '@/utils/format'

const tab = ref<'orders' | 'trades'>('orders')
const orders = ref<OrderItem[]>([])
const trades = ref<TradeItem[]>([])
const filter = ref<'all' | 'open' | 'filled' | 'cancelled'>('all')
const loading = ref(false)
const message = ref('')

async function loadOrders() {
  try {
    const res = await tradeApi.orders(filter.value, 100)
    orders.value = res.items
  } catch (e: any) {
    message.value = e?.message ?? '加载失败'
  }
}

async function loadTrades() {
  try {
    const res = await tradeApi.trades(100)
    trades.value = res.items
  } catch (e: any) {
    message.value = e?.message ?? '加载失败'
  }
}

async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    await (tab.value === 'orders' ? loadOrders() : loadTrades())
  } finally {
    loading.value = false
  }
}

async function cancel(o: OrderItem) {
  const ok = await feedback.confirm({
    title: '撤销委托',
    content: `确认撤销委托 ${o.order_no}？`,
    positiveText: '撤单',
    danger: true,
  })
  if (!ok) return
  try {
    await tradeApi.cancel(o.id)
    message.value = '撤单成功'
    await refresh()
  } catch (e: any) {
    message.value = e?.message ?? '撤单失败'
  }
}

const filters: Array<{ v: typeof filter.value; label: string }> = [
  { v: 'all', label: '全部' },
  { v: 'open', label: '可撤' },
  { v: 'filled', label: '已成' },
  { v: 'cancelled', label: '已撤' },
]

useIntervalFn(refresh, 3000)

onMounted(refresh)
onBeforeUnmount(() => {})
</script>

<template>
  <div class="page">
    <AppBar back title="委托与成交" />

    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'orders' }" @click="tab = 'orders'; refresh()">当日委托</button>
      <button class="tab" :class="{ on: tab === 'trades' }" @click="tab = 'trades'; refresh()">成交明细</button>
    </div>

    <div v-if="tab === 'orders'" class="filters">
      <button v-for="f in filters" :key="f.v" class="fchip" :class="{ on: filter === f.v }"
        @click="filter = f.v; refresh()">{{ f.label }}</button>
    </div>

    <p v-if="message" class="msg">{{ message }}</p>

    <template v-if="tab === 'orders'">
      <div v-if="!orders.length" class="empty">暂无委托记录</div>
      <div v-for="o in orders" :key="o.id" class="card item-card">
        <div class="row-between">
          <div class="row" style="gap: 8px">
            <span class="side-tag" :class="o.side">{{ sideLabel(o.side) }}</span>
            <span class="code">{{ o.code }}</span>
          </div>
          <span class="status">{{ statusLabel(o.status) }}</span>
        </div>
        <div class="grid">
          <div class="cell"><span class="k">委托价</span><span class="v tabular">{{ fmtPrice(o.price) }}</span></div>
          <div class="cell"><span class="k">委托量</span><span class="v tabular">{{ o.quantity }}</span></div>
          <div class="cell"><span class="k">已成交</span><span class="v tabular">{{ o.filled_quantity }}</span></div>
          <div class="cell"><span class="k">成交均价</span><span class="v tabular">{{ fmtPrice(o.avg_fill_price, 4) }}</span></div>
        </div>
        <div class="row-between foot">
          <span class="text-xs">{{ fmtDateTime(o.created_at) }} · {{ o.order_no }}</span>
          <button v-if="o.status === 'pending' || o.status === 'partial'" class="cancel" @click="cancel(o)">撤单</button>
        </div>
        <p v-if="o.reject_reason" class="text-xs" style="margin-top: 6px; color: #ff8b8d">{{ o.reject_reason }}</p>
      </div>
    </template>

    <template v-else>
      <div v-if="!trades.length" class="empty">暂无成交记录</div>
      <div v-for="t in trades" :key="t.trade_no" class="card item-card">
        <div class="row-between">
          <div class="row" style="gap: 8px">
            <span class="side-tag" :class="t.side">{{ sideLabel(t.side) }}</span>
            <span class="code">{{ t.code }}</span>
          </div>
          <span class="text-xs">{{ fmtDateTime(t.created_at) }}</span>
        </div>
        <div class="grid">
          <div class="cell"><span class="k">成交价</span><span class="v tabular">{{ fmtPrice(t.price, 4) }}</span></div>
          <div class="cell"><span class="k">成交量</span><span class="v tabular">{{ t.quantity }}</span></div>
          <div class="cell"><span class="k">成交额</span><span class="v tabular">{{ fmtPrice(t.amount) }}</span></div>
          <div class="cell"><span class="k">费用</span><span class="v tabular">{{ fmtPrice(t.fee) }}</span></div>
        </div>
        <div v-if="t.realized_pnl" class="text-xs" style="margin-top: 6px"
          :class="t.realized_pnl > 0 ? 'up' : 'down'">
          已实现盈亏 {{ t.realized_pnl > 0 ? '+' : '' }}{{ fmtPrice(t.realized_pnl) }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  padding: 10px 14px 4px;
}
.tab {
  flex: 1;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 10px;
  color: var(--c-text-2);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 0;
  cursor: pointer;
}
.tab.on {
  color: #ff8b8d;
  border-color: var(--c-brand);
  background: rgba(232, 56, 61, 0.1);
}
.filters {
  display: flex;
  gap: 6px;
  padding: 8px 14px;
}
.fchip {
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 14px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 4px 11px;
  cursor: pointer;
}
.fchip.on {
  color: var(--c-brand);
  border-color: var(--c-brand);
}
.msg {
  font-size: 12px;
  color: #ff8b8d;
  padding: 0 14px 6px;
}
.item-card {
  margin: 8px 14px;
  padding: 12px;
}
.side-tag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 5px;
  font-weight: 700;
}
.side-tag.buy {
  background: rgba(255, 77, 79, 0.18);
  color: #ff8b8d;
}
.side-tag.sell {
  background: rgba(18, 183, 106, 0.18);
  color: #4ade9b;
}
.code {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.status {
  font-size: 11px;
  color: var(--c-text-2);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
  margin-top: 10px;
}
.cell {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.k {
  color: var(--c-text-3);
}
.v {
  font-weight: 600;
}
.foot {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--c-line);
}
.cancel {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--c-line-strong);
  border-radius: 7px;
  color: var(--c-text);
  font-size: 11px;
  padding: 5px 12px;
  cursor: pointer;
}
</style>
