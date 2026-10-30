<script setup lang="ts">
/**
 * 交易页：由原「资产」与「我的」合并而来。
 *
 * 为什么要合并：这两页本来就在互相引用 —— 资产页要显示持仓浮盈，我的页要显示总资产，
 * 用户为了看「我这账号现在什么情况」需要在两个页面来回跳。拆成两页只是把一件事分两处看。
 * 合并后一页给完整答案：总资产 → 今日与浮动盈亏 → 持仓明细 → 委托与成交 → 账户与设置。
 *
 * 同时按反馈删掉「累计已实现」：
 *  · 模拟盘里「已实现盈亏」必须靠成交记录反推，而分红、送股、费用调整都会让它失真；
 *    一个算不准的数字放在总资产旁边，比不显示更糟 —— 用户会拿它当账户表现的结论。
 *  · 真正每天要看的是「今天赚了多少」（当日盈亏）和「手上的仓现在赚多少」（浮动盈亏），
 *    这两个都能用当前持仓直接算准，所以本轮把它们提到最显眼的位置。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi, tradeApi } from '@/api'
import type { AccountSummary, OrderItem, PositionItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtMoney, fmtPct, fmtPrice, trendClass } from '@/utils/format'

const router = useRouter()

const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const orders = ref<OrderItem[]>([])
const loading = ref(true)
const error = ref('')
const tab = ref<'position' | 'order'>('position')

const asset = computed(() => summary.value?.asset ?? null)

const totalFloating = computed(() =>
  positions.value.reduce((s, p) => s + (p.unrealized_pnl || 0), 0),
)

/** 持仓成本合计，用于算浮动盈亏百分比（接口已给则优先用接口口径） */
const floatingPct = computed(() => {
  const a = asset.value
  if (a?.floating_pct != null) return a.floating_pct
  const cost = positions.value.reduce((s, p) => s + p.avg_cost * p.quantity, 0)
  return cost > 0 ? (totalFloating.value / cost) * 100 : 0
})

const pendingOrders = computed(() =>
  orders.value.filter((o) => o.status === 'pending' || o.status === 'partial'),
)

function statusText(o: OrderItem) {
  switch (o.status) {
    case 'filled':
      return '已成交'
    case 'partial':
      return '部分成交'
    case 'pending':
      return '待成交'
    case 'cancelled':
      return '已撤单'
    case 'rejected':
      return '已拒绝'
    default:
      return o.status
  }
}

function fmtTime(ts: number) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  try {
    const [s, p, o] = await Promise.all([
      accountApi.summary(),
      accountApi.positions(),
      tradeApi.orders(),
    ])
    summary.value = s
    positions.value = p.items
    orders.value = o.items
    error.value = ''
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  } finally {
    loading.value = false
  }
}

async function cancel(o: OrderItem) {
  try {
    await tradeApi.cancel(o.id)
    await load()
  } catch (e: any) {
    error.value = e?.message ?? '撤单失败'
  }
}

const { pause, resume } = useIntervalFn(
  () => {
    if (document.visibilityState === 'visible') void load()
  },
  5000,
  { immediate: false },
)

onMounted(async () => {
  await load()
  resume()
})
onBeforeUnmount(pause)
</script>

<template>
  <div class="page trade-page">
    <AppBar title="交易" />

    <div v-if="error" class="empty">{{ error }}</div>
    <div v-else-if="loading" class="empty">加载中…</div>

    <template v-else-if="asset">
      <!-- 总资产 -->
      <section class="hero">
        <div class="hero-label">总资产（元）</div>
        <div class="hero-value tabular">{{ fmtMoney(asset.total_asset) }}</div>
        <div class="hero-sub">
          <span>可用 {{ fmtMoney(asset.cash) }}</span>
          <span v-if="asset.frozen_cash > 0" class="frozen">冻结 {{ fmtMoney(asset.frozen_cash) }}</span>
          <span>市值 {{ fmtMoney(asset.market_value) }}</span>
        </div>
      </section>

      <!-- 今日 / 浮动：这两个才是每天要看的数字 -->
      <section class="pnl-cards">
        <div class="pnl">
          <span class="pk">当日盈亏</span>
          <span class="pv tabular" :class="trendClass(asset.day_pnl)">{{ fmtMoney(asset.day_pnl) }}</span>
        </div>
        <div class="pnl">
          <span class="pk">浮动盈亏</span>
          <span class="pv tabular" :class="trendClass(asset.floating_pnl ?? totalFloating)">
            {{ fmtMoney(asset.floating_pnl ?? totalFloating) }}
          </span>
          <span class="pp tabular" :class="trendClass(floatingPct)">{{ fmtPct(floatingPct) }}</span>
        </div>
      </section>

      <!-- 切换：持仓 / 委托 -->
      <div class="seg">
        <button class="seg-btn" :class="{ on: tab === 'position' }" @click="tab = 'position'">
          持仓 <em>{{ positions.length }}</em>
        </button>
        <button class="seg-btn" :class="{ on: tab === 'order' }" @click="tab = 'order'">
          委托 <em>{{ pendingOrders.length }}</em>
        </button>
      </div>

      <!-- 持仓 -->
      <section v-if="tab === 'position'">
        <div v-if="!positions.length" class="empty-box">
          <div class="etitle">还没有持仓</div>
          <p class="text-xs">在行情里挑一只，从详情页底栏买入。</p>
          <button class="btn btn-ghost" @click="router.push('/')">去看行情</button>
        </div>
        <div v-else class="plist">
          <div v-for="p in positions" :key="p.code" class="prow" @click="router.push(`/stock/${p.code}`)">
            <div class="pname">
              <div class="pn">{{ p.name }}</div>
              <div class="pc">{{ p.code }} · 成本 {{ fmtPrice(p.avg_cost) }}</div>
            </div>
            <div class="pnum">
              <div class="pq tabular">{{ p.quantity }}<em>股</em></div>
              <div class="pa text-xs">可用 {{ p.available }}</div>
            </div>
            <div class="ppnl">
              <div class="pv tabular" :class="trendClass(p.unrealized_pnl)">{{ fmtMoney(p.unrealized_pnl) }}</div>
              <div class="pp tabular" :class="trendClass(p.unrealized_pct)">{{ fmtPct(p.unrealized_pct) }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 委托 -->
      <section v-else>
        <div v-if="!orders.length" class="empty-box">
          <div class="etitle">还没有委托</div>
          <p class="text-xs">下单后这里会显示委托状态与成交进度。</p>
        </div>
        <div v-else class="olist">
          <div v-for="o in orders" :key="o.id" class="orow">
            <div class="oleft">
              <span class="oside" :class="o.side">{{ o.side === 'buy' ? '买' : '卖' }}</span>
              <div class="oname">
                <div class="on">{{ o.code }}</div>
                <div class="ot">{{ fmtTime(o.created_at) }} · {{ o.order_type === 'limit' ? '限价委托' : '市价委托' }}</div>
              </div>
            </div>
            <div class="omid">
              <div class="op tabular">{{ o.order_type === 'limit' ? fmtPrice(o.price) : '市价' }}</div>
              <div class="oq text-xs">{{ o.filled_quantity }}/{{ o.quantity }}</div>
            </div>
            <div class="oright">
              <span class="ostat" :class="o.status">{{ statusText(o) }}</span>
              <button
                v-if="o.status === 'pending' || o.status === 'partial'"
                class="ocancel"
                @click="cancel(o)"
              >
                撤单
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 账户 -->
      <section class="account">
        <div class="arow">
          <span class="ak">账户</span>
          <span class="av">{{ summary?.user.display_name || summary?.user.username }}</span>
        </div>
        <div class="arow">
          <span class="ak">风险等级</span>
          <span class="av">R{{ summary?.risk.level ?? '—' }}</span>
        </div>
        <div class="arow">
          <span class="ak">累计费用</span>
          <span class="av tabular">{{ fmtAmount(asset.fee_paid) }}</span>
        </div>
        <button class="arow link" @click="router.push('/risk')">
          <span class="ak">风险偏好测评</span>
          <span class="av">›</span>
        </button>
        <button class="arow link" @click="router.push('/orders')">
          <span class="ak">全部委托与成交</span>
          <span class="av">›</span>
        </button>
      </section>
    </template>
  </div>
</template>

<style scoped>
.trade-page {
  padding-bottom: calc(var(--h-tabbar) + var(--safe-bottom) + 12px);
}

.hero {
  padding: 14px 16px 16px;
  background: linear-gradient(160deg, rgba(232, 56, 61, 0.16), transparent 70%);
}
.hero-label {
  font-size: 11px;
  color: var(--c-text-3);
}
.hero-value {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.6px;
  margin-top: 4px;
  line-height: 1.15;
}
.hero-sub {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--c-text-3);
  flex-wrap: wrap;
}
.hero-sub .frozen {
  color: #e8b339;
}

.pnl-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--c-line);
  border-top: 1px solid var(--c-line);
  border-bottom: 1px solid var(--c-line);
}
.pnl {
  background: var(--c-card);
  padding: 11px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pk {
  font-size: 10px;
  color: var(--c-text-3);
}
.pv {
  font-size: 17px;
  font-weight: 700;
}
.pp {
  font-size: 11px;
}

.seg {
  display: flex;
  gap: 6px;
  padding: 10px 14px 6px;
}
.seg-btn {
  flex: 1;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 9px;
  color: var(--c-text-2);
  font-size: 13px;
  padding: 8px 0;
  cursor: pointer;
}
.seg-btn em {
  font-style: normal;
  font-size: 11px;
  color: var(--c-text-3);
  margin-left: 3px;
}
.seg-btn.on {
  border-color: rgba(232, 56, 61, 0.45);
  color: #ff8b8d;
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}

.plist,
.olist {
  margin-top: 4px;
}
.prow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-top: 1px solid var(--c-line);
  background: var(--c-card);
  cursor: pointer;
}
.pname {
  flex: 1;
  min-width: 0;
}
.pn {
  font-size: 14px;
  font-weight: 600;
}
.pc {
  font-size: 10px;
  color: var(--c-text-3);
  margin-top: 2px;
}
.pnum {
  flex: 0 0 64px;
  text-align: right;
}
.pq {
  font-size: 13px;
  font-weight: 600;
}
.pq em {
  font-style: normal;
  font-size: 10px;
  color: var(--c-text-3);
  margin-left: 1px;
}
.ppnl {
  flex: 0 0 88px;
  text-align: right;
}
.ppnl .pv {
  font-size: 14px;
}
.ppnl .pp {
  font-size: 11px;
  margin-top: 1px;
}

.orow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--c-line);
  background: var(--c-card);
}
.oleft {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.oside {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
}
.oside.buy {
  background: var(--c-up);
}
.oside.sell {
  background: var(--c-down);
}
.on {
  font-size: 13px;
  font-weight: 600;
}
.ot {
  font-size: 10px;
  color: var(--c-text-3);
  margin-top: 2px;
}
.omid {
  flex: 0 0 66px;
  text-align: right;
}
.op {
  font-size: 12px;
  font-weight: 600;
}
.oq {
  font-size: 10px;
  color: var(--c-text-3);
}
.oright {
  flex: 0 0 58px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.ostat {
  font-size: 11px;
  color: var(--c-text-2);
}
.ostat.pending {
  color: #e8b339;
}
.ostat.filled {
  color: var(--c-text-3);
}
.ocancel {
  background: none;
  border: 1px solid var(--c-line-strong);
  border-radius: 6px;
  color: var(--c-text-2);
  font-size: 10px;
  padding: 3px 7px;
  cursor: pointer;
}

.account {
  margin-top: 10px;
  border-top: 1px solid var(--c-line);
  background: var(--c-card);
}
.arow {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--c-line);
  background: none;
  color: var(--c-text);
  font-size: 13px;
}
.arow:last-child {
  border-bottom: none;
}
.arow.link {
  cursor: pointer;
}
.ak {
  color: var(--c-text-2);
}
.av {
  color: var(--c-text-3);
  font-size: 12px;
}

.empty-box {
  margin: 30px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.etitle {
  font-size: 14px;
  font-weight: 600;
}
.empty-box .btn {
  margin-top: 4px;
  font-size: 13px;
  padding: 9px 18px;
}
</style>
