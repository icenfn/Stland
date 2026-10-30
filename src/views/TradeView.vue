<script setup lang="ts">
/**
 * 交易页：只看「钱」。
 *
 * 与「我的」的分工：
 *  · 这一页只回答「我有多少资产、赚了多少、持了什么仓」；
 *  · 身份、风险测评、退出登录属于账号，已移到「我的」。
 *    上一版把两者混在一屏，既有资产卡又有退出按钮，性质不同还挤；
 *  · 「委托与成交」保留入口：看完持仓最常问的下一句就是「我的单成交了吗」。
 *
 * 数据口径：
 *  · 「浮动盈亏」由持仓明细汇总，和列表里逐行看到的数字天然一致，
 *    不会出现「卡片说赚、列表说亏」；
 *  · 金额走千分位纯数字，不做「万/亿」压缩 —— 金额是精确量，不是观测量。
 *
 * 未登录：不挡页面，只在原位给一个登录入口（行情本就不需要登录）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi } from '@/api'
import type { AccountSummary, PositionItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { useAuth } from '@/stores/auth'
import { fmtAgo, fmtDateTime, fmtMoney, fmtPct, fmtPrice, fmtSignedMoney, trendClass } from '@/utils/format'

const router = useRouter()
const auth = useAuth()

const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const error = ref('')
const updatedAt = ref(0)

const asset = computed(() => summary.value?.asset)

const floatingPnl = computed(() =>
  positions.value.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0),
)

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

// 已登录才轮询：未登录时这里只是空壳，不必反复打接口
useIntervalFn(() => {
  if (auth.state.user) void refresh()
}, 4000)

onMounted(async () => {
  if (!auth.state.user) return
  await refresh()
})
</script>

<template>
  <div class="page">
    <AppBar title="交易">
      <template #actions>
        <span v-if="updatedAt" class="upd-tag">{{ fmtAgo(updatedAt) }}</span>
        <button class="mini-btn" @click="router.push('/orders')">委托</button>
      </template>
    </AppBar>

    <!-- 未登录：给明确入口，而不是空白或直接踢走 -->
    <section v-if="!auth.state.user" class="px sect">
      <div class="card guest">
        <div class="guest-t">登录后查看资产与持仓</div>
        <p class="text-xs hint">行情与个股不需要登录即可浏览。</p>
        <button class="btn btn-primary btn-block" @click="router.push('/login')">去登录</button>
      </div>
    </section>

    <template v-else>
      <!-- 资产卡 -->
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

      <!-- 持仓 -->
      <section class="holdings">
        <div class="hold-head">
          <span class="card-h">持仓 {{ positions.length }}</span>
          <span class="text-xs">点击查看详情</span>
        </div>

        <div v-if="error" class="empty">{{ error }}</div>
        <div v-else-if="!positions.length" class="empty">暂无持仓，去首页挑一支买入吧</div>

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

      <!-- 委托入口：看完持仓最常问的下一句是「我的单成交了吗」 -->
      <section class="px">
        <div class="card menu">
          <button class="menu-item" @click="router.push('/orders')">
            <span>委托与成交</span><span class="arrow">›</span>
          </button>
        </div>
      </section>

      <p class="disclaimer px">
        资产与盈亏由服务端账务引擎结算（现金 / 冻结 / 市值三账分离）。
      </p>
    </template>
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
