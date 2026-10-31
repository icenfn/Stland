<script setup lang="ts">
/**
 * 交易面板：只看「钱」—— 总资产、盈亏、持仓。
 *
 * 从原来的「交易页」搬进首页框架后，这里不再有 AppBar：
 * 品牌与行情状态由外壳统一提供，面板只负责内容，避免一屏两层顶栏。
 *
 * 与「我的」的分工：身份、风险测评、退出登录属于账号，在「我的」里；
 * 这一页只回答「我有多少钱、赚了多少、持了什么仓」。
 *
 * 计算口径（与服务端对齐）：
 *  · 总资产 = 可用 + 冻结 + 持仓市值（服务端 settle_positions 写入）；
 *  · 当日盈亏取服务端结算值 —— 服务端按「昨收 → 最新价」算持仓的日变动，
 *    今日新买入的部分以成交价代替昨收，否则当天买的股票会被算进隔夜涨跌；
 *  · 浮动盈亏这里由持仓明细汇总（价格 - 成本）× 数量，
 *    与列表逐行数字天然一致，不会出现「卡片说赚、列表说亏」。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi } from '@/api'
import type { AccountSummary, PositionItem } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { fmtAgo, fmtMoney, fmtPct, fmtPrice, fmtSignedMoney, trendClass } from '@/utils/format'

const router = useRouter()
const auth = useAuth()

const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const error = ref('')
const updatedAt = ref(0)
const loading = ref(false)

const asset = computed(() => summary.value?.asset)

const floatingPnl = computed(() =>
  positions.value.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0),
)

/**
 * 分别拉取概览与持仓，互不连坐。
 *
 * 之前用 Promise.all：只要其中一个接口报错（本轮修掉的那个持仓 500 就是典型），
 * 整页只剩一句「服务器内部错误」，连本来正常的资产卡片都看不到。
 * 现在两路各取所需，谁失败就只在那块区域给提示，另一块照常显示。
 */
async function refresh() {
  if (!auth.state.user) return
  loading.value = true
  const [s, p] = await Promise.allSettled([accountApi.summary(), accountApi.positions()])

  if (s.status === 'fulfilled') {
    summary.value = s.value
  } else {
    summary.value = null
  }
  if (p.status === 'fulfilled') {
    positions.value = p.value.items ?? []
  } else {
    positions.value = []
  }

  const failed = [s, p].filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  if (failed.length) {
    // 只报第一层的可读原因，不去展开 axios/alova 的完整错误对象
    const reason = failed[0].reason
    error.value = reason?.message ?? '加载失败，请稍后重试'
  } else {
    error.value = ''
    updatedAt.value = Date.now()
  }
  loading.value = false
}

// 未登录时接口必然 401，这里直接跳过，避免无意义的错误提示
useIntervalFn(() => {
  if (auth.state.user) void refresh()
}, 4000)

onMounted(refresh)
</script>

<template>
  <div class="panel">
    <!-- 未登录：给明确入口，行情本身不需要登录 -->
    <div v-if="!auth.state.user" class="px guest-wrap">
      <div class="card guest">
        <div class="guest-t">登录后查看资产与持仓</div>
        <p class="text-xs hint">行情与个股不需要登录即可浏览。</p>
        <button class="btn btn-primary btn-block" @click="router.push('/login')">去登录</button>
      </div>
    </div>

    <template v-else>
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
              <div class="text-xs">浮动盈亏</div>
              <div class="tabular pnl-v" :class="trendClass(floatingPnl)">
                {{ fmtSignedMoney(floatingPnl) }}
              </div>
            </div>
          </div>

          <!-- 三项在服务端是三本账，必须分开看：冻结的钱还没成交，不是亏损 -->
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

      <section class="holdings">
        <div class="hold-head">
          <span class="card-h">持仓 {{ positions.length }}</span>
          <span class="text-xs">{{ updatedAt ? fmtAgo(updatedAt) : '' }}</span>
        </div>

        <div v-if="error" class="empty">{{ error }}</div>
        <div v-else-if="!positions.length && loading" class="empty">加载中…</div>
        <div v-else-if="!positions.length" class="empty">暂无持仓，去行情挑一支买入吧</div>

        <div
          v-for="p in positions"
          :key="p.code"
          class="hold-row"
          @click="router.push(`/stock/${p.code}`)"
        >
          <div class="hl">
            <div class="hname">{{ p.name }}</div>
            <div class="hsub">
              <span>{{ p.code }}</span>
              <span>持仓 {{ p.quantity }}</span>
              <span>可卖 {{ p.available }}</span>
            </div>
            <div class="htime">成本 {{ fmtPrice(p.avg_cost, 4) }}</div>
          </div>
          <div class="hm">
            <div class="tabular hmv" :class="trendClass(p.unrealized_pnl)">
              {{ fmtMoney(p.market_value) }}
            </div>
            <div class="text-xs tabular" :class="trendClass(p.unrealized_pnl)">
              {{ fmtPct(p.unrealized_pct) }}
            </div>
            <div class="text-xs tabular hs" :class="trendClass(p.unrealized_pnl)">
              {{ fmtSignedMoney(p.unrealized_pnl ?? 0) }}
            </div>
          </div>
        </div>
      </section>

      <p class="disclaimer px">
        资产与盈亏由服务端账务引擎结算（可用 / 冻结 / 市值三账分离）。
      </p>
    </template>
  </div>
</template>

<style scoped>
.panel {
  padding-bottom: 16px;
}
.sect {
  padding-top: 10px;
}
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
}
.holdings {
  margin-top: 14px;
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
.hs {
  margin-top: 2px;
}
.menu {
  padding: 0;
  overflow: hidden;
}
.menu-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: none;
  border: none;
  color: var(--c-text);
  font-size: 14px;
  padding: 14px;
  cursor: pointer;
}
.arrow {
  color: var(--c-text-3);
}
.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  padding: 14px;
  line-height: 1.6;
}
</style>
