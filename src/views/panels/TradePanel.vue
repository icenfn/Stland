<script setup lang="ts">
/**
 * 交易面板（重写）。
 *
 * 结构上把「持仓 / 委托 / 成交」三件事收进同一页的 tab：
 *  · 旧版是「交易页看资产 + 独立的委托与成交页」两条路径，
 *    用户想确认「我这笔委托成交了没」要跨页跳转，回来还要重新找持仓，
 *    而且在底部导航里多占一个位置。
 *  · 现在三者共用同一份账户上下文，切 tab 不重新加载页面、不失位置，
 *    底部导航也腾出一个位置。
 *
 * 委托列表的重点改造（针对原来「一行塞不下、状态看不出、撤单找不到」）：
 *  1) 行内两段式：上排「代码 名称 + 方向标记 + 状态胶囊」，下排「委托价 × 数量 + 已成交进度」；
 *  2) 已成交量用细进度条表示，部成/全成一眼可辨，不靠读两个数字相减；
 *  3) 未成交与部成的委托直接给「撤单」按钮，撤单后原位刷新，不必再进详情页；
 *  4) 时间用相对表述（刚刚 / 3 分钟前），今日盘中的新鲜度比绝对时间更有用。
 *
 * 刷新策略：进入页面取一次，下拉手动刷新；不做整页轮询 ——
 * 委托变化由下单/撤单动作直接触发重取，比定时轮询更省电也更准。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { vAutoAnimate } from '@formkit/auto-animate/vue'
import { accountApi, tradeApi } from '@/api'
import type { AccountSummary, OrderItem, PositionItem, TradeItem } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useMarket } from '@/stores/market'
import {
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtRelative,
  fmtSignedMoney,
  sideLabel,
  statusLabel,
  trendClass,
} from '@/utils/format'

const router = useRouter()
const auth = useAuth()
const market = useMarket()

type TabKey = 'positions' | 'orders' | 'trades'

const tab = ref<TabKey>('positions')
const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const orders = ref<OrderItem[]>([])
const trades = ref<TradeItem[]>([])
const loading = ref(false)
const ordersLoading = ref(false)
const err = ref('')
/** 正在撤单的委托 id：按钮置灰 + 文案变化，避免重复点 */
const cancelling = ref<number | null>(null)

const TABS: Array<{ key: TabKey; label: string; count: () => number }> = [
  { key: 'positions', label: '持仓', count: () => positions.value.length },
  { key: 'orders', label: '委托', count: () => orders.value.length },
  { key: 'trades', label: '成交', count: () => trades.value.length },
]

const asset = computed(() => summary.value?.asset)
const user = computed(() => auth.state.user)

/** 未成交 / 部成的委托可以撤；已成交或已撤的不能再动 */
const canCancel = (o: OrderItem) => o.status === 'pending' || o.status === 'partial'

/** 成交进度：已成交 / 委托量 */
function fillPct(o: OrderItem): number {
  if (!o.quantity) return 0
  return Math.min(100, (o.filled_quantity / o.quantity) * 100)
}

/** 撤单可以点的时候，优先看「可撤」这一类，让用户先看到能操作的东西 */
const openOrders = computed(() => orders.value.filter(canCancel))

async function loadSummaryAndPositions() {
  if (!user.value) return
  loading.value = true
  err.value = ''
  try {
    const [s, p] = await Promise.all([accountApi.summary(), accountApi.positions()])
    summary.value = s
    positions.value = p.items
  } catch (e: any) {
    err.value = e?.message ?? '账户数据加载失败'
  } finally {
    loading.value = false
  }
}

async function loadOrders() {
  if (!user.value) return
  ordersLoading.value = true
  try {
    const r = await tradeApi.orders('all', 60)
    orders.value = r.items
  } catch (e: any) {
    err.value = e?.message ?? '委托加载失败'
  } finally {
    ordersLoading.value = false
  }
}

async function loadTrades() {
  if (!user.value) return
  try {
    const r = await tradeApi.trades(60)
    trades.value = r.items
  } catch (e: any) {
    err.value = e?.message ?? '成交加载失败'
  }
}

/** 切 tab 时按需拉取，避免一次性发三个请求 */
async function ensureTab(key: TabKey) {
  if (key === 'orders' && !orders.value.length) await loadOrders()
  if (key === 'trades' && !trades.value.length) await loadTrades()
}

function onTab(key: TabKey) {
  tab.value = key
  void ensureTab(key)
}

async function refreshAll() {
  await loadSummaryAndPositions()
  if (tab.value === 'orders') await loadOrders()
  if (tab.value === 'trades') await loadTrades()
}

async function cancelOrder(o: OrderItem) {
  if (!canCancel(o) || cancelling.value !== null) return
  cancelling.value = o.id
  try {
    await tradeApi.cancel(o.id)
    // 撤单后原位刷新：委托列表与持仓（冻结资金/可卖数量都会变）一起重取
    await Promise.all([loadOrders(), loadSummaryAndPositions()])
  } catch (e: any) {
    err.value = e?.message ?? '撤单失败'
  } finally {
    cancelling.value = null
  }
}

function openStock(code: string) {
  void router.push(`/stock/${code}`)
}

onMounted(() => {
  if (user.value) void refreshAll()
})

// 登录状态变化时重新拉一遍：首页账户卡与本页共用同一份登录态
watch(
  () => user.value?.id,
  (id) => {
    if (id) void refreshAll()
    else {
      summary.value = null
      positions.value = []
      orders.value = []
      trades.value = []
    }
  },
)
</script>

<template>
  <div class="page trade">
    <!-- 未登录：只给登录入口，不展示空表 -->
    <div v-if="!user" class="px guest-wrap">
      <div class="card guest">
        <div class="guest-t">登录后查看持仓与委托</div>
        <p class="text-xs hint">行情浏览无需登录，交易与资产需要账户。</p>
        <button class="btn btn-primary btn-block" @click="router.push('/login')">去登录</button>
      </div>
    </div>

    <template v-else>
      <!-- 资产总览：总资产给完整数字，盈亏分「当日」与「浮动」两栏 -->
      <section class="px sect">
        <div class="card asset-card">
          <div class="row-between">
            <span class="a-label">总资产（元）</span>
            <div class="a-actions">
              <span v-if="market.session.value?.label" class="sess-tag">
                {{ market.session.value.label }}
              </span>
              <button class="mini-btn" :disabled="loading" @click="refreshAll">
                {{ loading ? '刷新中' : '刷新' }}
              </button>
            </div>
          </div>

          <div class="a-total tabular">{{ asset ? fmtMoney(asset.total_asset) : '--' }}</div>

          <div class="a-grid">
            <div class="a-cell">
              <span class="ak">当日盈亏</span>
              <span class="av tabular" :class="trendClass(asset?.day_pnl ?? 0)">
                {{ asset ? fmtSignedMoney(asset.day_pnl) : '--' }}
              </span>
            </div>
            <div class="a-cell">
              <span class="ak">浮动盈亏</span>
              <span class="av tabular" :class="trendClass(asset?.floating_pnl ?? 0)">
                {{ asset ? fmtSignedMoney(asset.floating_pnl ?? 0) : '--' }}
              </span>
            </div>
            <div class="a-cell">
              <span class="ak">持仓市值</span>
              <span class="av tabular">{{ asset ? fmtMoney(asset.market_value) : '--' }}</span>
            </div>
            <div class="a-cell">
              <span class="ak">可用资金</span>
              <span class="av tabular">{{ asset ? fmtMoney(asset.cash) : '--' }}</span>
            </div>
          </div>
        </div>

        <p v-if="err" class="err-line">{{ err }}</p>
      </section>

      <!-- 三档 tab：持仓 / 委托 / 成交 合并于此 -->
      <div class="seg-tabs" data-hscroll>
        <button
          v-for="t in TABS"
          :key="t.key"
          class="seg-tab"
          :class="{ on: tab === t.key }"
          @click="onTab(t.key)"
        >
          {{ t.label }}
          <span v-if="t.count()" class="tab-num tabular">{{ t.count() }}</span>
        </button>
      </div>

      <!-- ---------- 持仓 ---------- -->
      <div v-if="tab === 'positions'" class="list-wrap">
        <div v-if="!positions.length && !loading" class="empty">
          <p class="empty-t">暂无持仓</p>
          <p class="empty-s">在行情里选一只股票，点「买入」开始模拟交易。</p>
          <button class="btn btn-ghost" @click="router.push('/market')">去看行情</button>
        </div>

        <div v-else v-auto-animate>
          <button
            v-for="p in positions"
            :key="p.code"
            class="card pos-row"
            @click="openStock(p.code)"
          >
            <div class="row-top">
              <div class="name-box">
                <span class="nm">{{ p.name }}</span>
                <span class="cd tabular">{{ p.code }}</span>
              </div>
              <div class="val-box">
                <span class="mv tabular">{{ fmtMoney(p.market_value) }}</span>
                <span class="upnl tabular" :class="trendClass(p.unrealized_pnl)">
                  {{ fmtSignedMoney(p.unrealized_pnl) }}
                  <em>{{ fmtPct(p.unrealized_pct) }}</em>
                </span>
              </div>
            </div>
            <div class="row-bot">
              <span>持仓 <b class="tabular">{{ fmtMoney(p.quantity, 0) }}</b></span>
              <span>可卖 <b class="tabular">{{ fmtMoney(p.available, 0) }}</b></span>
              <span>成本 <b class="tabular">{{ fmtPrice(p.avg_cost) }}</b></span>
              <span>现价 <b class="tabular" :class="trendClass(p.day_change_pct)">{{ fmtPrice(p.last_price) }}</b></span>
            </div>
          </button>
        </div>
      </div>

      <!-- ---------- 委托 ---------- -->
      <div v-else-if="tab === 'orders'" class="list-wrap">
        <div v-if="ordersLoading && !orders.length" class="list-loading">
          <div v-for="i in 4" :key="i" class="skeleton" style="height: 58px; border-radius: 12px; margin-bottom: 8px" />
        </div>

        <div v-else-if="!orders.length" class="empty">
          <p class="empty-t">暂无委托</p>
          <p class="empty-s">下单后会在这里显示，未成交的可直接撤单。</p>
        </div>

        <template v-else>
          <p v-if="openOrders.length" class="grp-h">待处理 {{ openOrders.length }} 笔</p>
          <div v-auto-animate>
            <div v-for="o in orders" :key="o.id" class="card ord-row">
              <!-- 上排：身份 + 方向 + 状态 -->
              <div class="ord-head">
                <span class="side-tag" :class="o.side === 'buy' ? 'buy' : 'sell'">
                  {{ sideLabel(o.side) }}
                </span>
                <span class="ord-nm">{{ o.code }}</span>
                <span class="st-chip" :class="o.status">{{ statusLabel(o.status) }}</span>
                <span class="ord-time">{{ fmtRelative(o.created_at) }}</span>
              </div>

              <!-- 中排：价格 × 数量 -->
              <div class="ord-body">
                <div class="ord-price">
                  <span class="tabular">{{ fmtPrice(o.price) }}</span>
                  <em class="text-xs">× {{ o.quantity }}</em>
                </div>
                <div class="ord-fill">
                  <span class="text-xs">
                    已成交 <b class="tabular">{{ o.filled_quantity }}</b> / {{ o.quantity }}
                  </span>
                  <div class="fill-bar">
                    <span class="fill-in" :style="{ width: fillPct(o) + '%' }" />
                  </div>
                </div>
              </div>

              <!-- 下排：成交均价 + 操作 -->
              <div class="ord-foot">
                <span class="text-xs">
                  <template v-if="o.filled_quantity">
                    均价 <b class="tabular">{{ fmtPrice(o.avg_fill_price) }}</b>
                  </template>
                  <template v-else-if="o.reject_reason">
                    废单原因：{{ o.reject_reason }}
                  </template>
                  <template v-else>等待成交</template>
                </span>
                <button
                  v-if="canCancel(o)"
                  class="cancel-btn"
                  :disabled="cancelling === o.id"
                  @click="cancelOrder(o)"
                >
                  {{ cancelling === o.id ? '撤销中' : '撤单' }}
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ---------- 成交 ---------- -->
      <div v-else class="list-wrap">
        <div v-if="!trades.length" class="empty">
          <p class="empty-t">暂无成交</p>
          <p class="empty-s">委托撮合成交后会在这里留档。</p>
        </div>

        <div v-else v-auto-animate>
          <div v-for="t in trades" :key="t.trade_no" class="card trd-row">
            <div class="ord-head">
              <span class="side-tag" :class="t.side === 'buy' ? 'buy' : 'sell'">
                {{ sideLabel(t.side) }}
              </span>
              <span class="ord-nm">{{ t.code }}</span>
              <span class="ord-time">{{ fmtRelative(t.created_at) }}</span>
            </div>
            <div class="trd-body">
              <div class="trd-cell">
                <span class="ak">成交价</span>
                <b class="tabular">{{ fmtPrice(t.price) }}</b>
              </div>
              <div class="trd-cell">
                <span class="ak">数量</span>
                <b class="tabular">{{ t.quantity }}</b>
              </div>
              <div class="trd-cell">
                <span class="ak">金额</span>
                <b class="tabular">{{ fmtMoney(t.amount) }}</b>
              </div>
              <div class="trd-cell">
                <span class="ak">费用</span>
                <b class="tabular">{{ fmtMoney(t.fee) }}</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sect {
  padding-top: 10px;
}

/* ---- 资产卡 ---- */
.asset-card {
  background: linear-gradient(150deg, #21313f, #161f2a);
}
.a-label {
  font-size: 11px;
  color: var(--c-text-2);
}
.a-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sess-tag {
  font-size: 10px;
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.13);
  padding: 2px 7px;
  border-radius: 6px;
}
.mini-btn {
  background: none;
  border: 1px solid var(--c-line);
  color: var(--c-text-2);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.mini-btn:disabled {
  opacity: 0.5;
}
.a-total {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -0.5px;
  margin: 3px 0 10px;
}
.a-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px 10px;
  padding-top: 10px;
  border-top: 1px solid var(--c-line);
}
.a-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ak {
  font-size: 10px;
  color: var(--c-text-3);
}
.av {
  font-size: 13px;
  font-weight: 600;
}
.err-line {
  margin: 8px 0 0;
  font-size: 11px;
  color: #ff8b8d;
}

/* ---- 分段 tab ---- */
.seg-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 14px 8px;
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--c-bg);
}
.seg-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  color: var(--c-text-2);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 0;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.16s ease;
}
.seg-tab.on {
  color: #fff;
  background: linear-gradient(135deg, #e8383d, #c1272b);
  border-color: transparent;
}
.tab-num {
  font-size: 10px;
  opacity: 0.75;
}

/* ---- 持仓 ---- */
.list-wrap {
  padding: 0 14px 16px;
}
.pos-row {
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--c-line);
}
.pos-row + .pos-row {
  margin-top: 8px;
}
.row-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.name-box {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.nm {
  font-size: 14px;
  font-weight: 600;
}
.cd {
  font-size: 10px;
  color: var(--c-text-3);
  margin-top: 1px;
}
.val-box {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.mv {
  font-size: 14px;
  font-weight: 700;
}
.upnl {
  font-size: 11px;
  margin-top: 1px;
}
.upnl em {
  font-style: normal;
  opacity: 0.85;
  margin-left: 4px;
}
.row-bot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--c-line);
  font-size: 10px;
  color: var(--c-text-3);
}
.row-bot b {
  color: var(--c-text-2);
  font-weight: 600;
}

/* ---- 委托 ---- */
.grp-h {
  font-size: 11px;
  color: var(--c-text-3);
  margin: 2px 2px 7px;
}
.ord-row {
  border: 1px solid var(--c-line);
  padding: 11px 12px;
}
.ord-row + .ord-row {
  margin-top: 8px;
}
.ord-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.side-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 5px;
  flex: 0 0 auto;
}
.side-tag.buy {
  color: #fff;
  background: var(--c-up);
}
.side-tag.sell {
  color: #fff;
  background: var(--c-down);
}
.ord-nm {
  font-size: 13px;
  font-weight: 600;
}
.st-chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--c-bg-elevated);
  color: var(--c-text-3);
}
.st-chip.pending,
.st-chip.partial {
  color: #ffb44d;
  background: rgba(255, 180, 77, 0.13);
}
.st-chip.filled {
  color: #3ddc84;
  background: rgba(61, 220, 132, 0.13);
}
.st-chip.cancelled,
.st-chip.rejected {
  color: var(--c-text-3);
}
.ord-time {
  margin-left: auto;
  font-size: 10px;
  color: var(--c-text-3);
}
.ord-body {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.ord-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 15px;
  font-weight: 700;
  flex: 0 0 auto;
}
.ord-price em {
  font-style: normal;
  color: var(--c-text-3);
  font-weight: 500;
}
.ord-fill {
  flex: 1;
  min-width: 0;
}
.ord-fill .text-xs {
  display: block;
  color: var(--c-text-3);
  margin-bottom: 3px;
}
.ord-fill b {
  color: var(--c-text-2);
}
.fill-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--c-bg-elevated);
  overflow: hidden;
}
.fill-in {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #ffb44d, #e8383d);
  transition: width 0.3s ease;
}
.ord-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--c-line);
}
.ord-foot .text-xs {
  color: var(--c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ord-foot b {
  color: var(--c-text-2);
}
.cancel-btn {
  flex: 0 0 auto;
  background: none;
  border: 1px solid var(--c-line);
  color: var(--c-text-2);
  font-size: 11px;
  padding: 4px 11px;
  border-radius: 8px;
  cursor: pointer;
}
.cancel-btn:disabled {
  opacity: 0.45;
}

/* ---- 成交 ---- */
.trd-row {
  border: 1px solid var(--c-line);
  padding: 11px 12px;
}
.trd-row + .trd-row {
  margin-top: 8px;
}
.trd-body {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--c-line);
}
.trd-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.trd-cell b {
  font-size: 12px;
  font-weight: 600;
}

/* ---- 空态 / 骨架 ---- */
.empty {
  text-align: center;
  padding: 34px 16px;
}
.empty-t {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 5px;
}
.empty-s {
  font-size: 11px;
  color: var(--c-text-3);
  margin: 0 0 14px;
  line-height: 1.6;
}
.list-loading {
  padding: 4px 0;
}

/* ---- 未登录 ---- */
.guest-wrap {
  padding-top: 18px;
}
.guest {
  text-align: center;
}
.guest-t {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}
.guest .hint {
  margin: 0 0 14px;
}
</style>
