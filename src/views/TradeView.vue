<script setup lang="ts">
/**
 * 交易页：原「资产」与「我的」合并。
 *
 * 为什么合并：
 *  · 两个页面里一大半内容是重复的 —— 都在展示账户身份、持仓入口、委托入口，
 *    用户想看「我的钱」还得先判断该点底栏哪个格子；
 *  · 交易这件事本来就是一体的：账户 → 资产 → 持仓 → 委托，
 *    拆成两页后「我刚下的单成交了吗」要在两页之间来回跳。
 *
 * 结构：自上而下按「我在哪 → 我有多少钱 → 我怎么走的」排
 *   1. 账户条（身份 + 风险等级 + 退出）
 *   2. 资产卡（总资产 / 当日盈亏 / 浮动盈亏 / 可用·冻结·市值）
 *   3. 风险偏好（与资金属性同屏）
 *   4. 持仓列表
 *   5. 快捷入口（委托与成交 / 机构交易台）
 *   6. 页脚声明
 *
 * 两处数据口径修正：
 *  · 「累计已实现」删除 —— 模拟盘里这个数字由成交反推，既不准也没有产品意义，
 *    换成「浮动盈亏」（持仓未兑现部分），是用户真正关心的、服务端能精确结算的量；
 *  · 金额仍走千分位纯数字（fmtMoney），不做「万/亿」压缩 —— 金额是精确量，不是观测量。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { accountApi } from '@/api'
import type { AccountSummary, PositionItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { useAuth } from '@/stores/auth'
import { fmtAgo, fmtDateTime, fmtMoney, fmtPct, fmtPrice, fmtSignedMoney, trendClass } from '@/utils/format'
import { levelLabel, levelTone, useRisk } from '@/stores/risk'

const router = useRouter()
const auth = useAuth()
const risk = useRisk()

const summary = ref<AccountSummary | null>(null)
const positions = ref<PositionItem[]>([])
const error = ref('')
const updatedAt = ref(0)

const asset = computed(() => summary.value?.asset)
const user = computed(() => auth.state.user)

const roleLabel = computed(() => {
  // 交易账户只有零售与机构；管理员是服务端独立表，不会出现在客户端身份里
  const map: Record<string, string> = { retail: '零售', institution: '机构' }
  return map[user.value?.role ?? 'retail'] ?? ''
})

/**
 * 浮动盈亏 = 持仓市值 - 持仓成本合计。
 * 直接由 positions 汇总，而不是取 asset 里的字段 —— 持仓列表已经拿到了明细，
 * 汇总出来与逐行看到的数字天然一致，不会出现「卡片说赚、列表说亏」。
 */
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

// 已登录才轮询；未登录时这里是空壳（页面本身不应该把未登录用户挡在门外）
useIntervalFn(() => {
  if (auth.state.user) void refresh()
}, 4000)

async function doLogout() {
  await auth.logout()
  await router.replace('/login')
}

onMounted(async () => {
  if (!auth.state.user) return
  await Promise.all([refresh(), risk.refresh()])
})
</script>

<template>
  <div class="page">
    <AppBar title="交易">
      <template #actions>
        <span v-if="updatedAt" class="upd-tag">{{ fmtAgo(updatedAt) }}</span>
        <button class="mini-btn" @click="router.push('/orders')">流水</button>
      </template>
    </AppBar>

    <!-- 未登录：给一个明确的登录入口，而不是空白或直接踢走 -->
    <section v-if="!auth.state.user" class="px sect">
      <div class="card guest">
        <div class="guest-t">登录后查看资产与持仓</div>
        <p class="text-xs hint">行情与个股不需要登录即可浏览。</p>
        <button class="btn btn-primary btn-block" @click="router.push('/login')">去登录</button>
      </div>
    </section>

    <template v-else>
      <!-- 1. 账户条 -->
      <section class="px sect">
        <div class="card profile-card">
          <div class="avatar">{{ (user?.display_name ?? 'U').slice(0, 1) }}</div>
          <div class="grow">
            <div class="pname">{{ user?.display_name ?? user?.username }}</div>
            <div class="pmeta">{{ user?.username }} · {{ roleLabel }}账户</div>
          </div>
          <button class="mini-btn" @click="doLogout">退出</button>
        </div>
      </section>

      <!-- 2. 资产卡：纯数字，不带单位 -->
      <section class="px">
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

      <!-- 3. 风险偏好：未测评不显示等级，只给测评入口 -->
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

      <!-- 4. 持仓 -->
      <section class="holdings">
        <div class="hold-head">
          <span class="card-h" style="margin: 0">持仓 {{ positions.length }}</span>
          <span class="text-xs">点击查看详情</span>
        </div>

        <div v-if="error" class="empty">{{ error }}</div>
        <div v-else-if="!positions.length" class="empty">暂无持仓，去首页行情面板挑一支买入吧</div>

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

      <!-- 5. 快捷入口 -->
      <section class="px">
        <div class="card menu">
          <button class="menu-item" @click="router.push('/orders')">
            <span>委托与成交</span><span class="arrow">›</span>
          </button>
          <button v-if="auth.isInstitution.value" class="menu-item" @click="router.push('/institution')">
            <span>机构交易台</span><span class="arrow">›</span>
          </button>
        </div>
      </section>

      <p class="disclaimer px">
        资产与盈亏由服务端账务引擎结算（现金 / 冻结 / 市值三账分离）。
      </p>
      <p class="foot">Stland 股岛 1.0.0 · 账户与标的由服务端后台管理</p>
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
.profile-card {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  width: 46px;
  height: 46px;
  border-radius: 15px;
  background: linear-gradient(135deg, #ff6b6d, #d92b2f);
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}
.pname {
  font-size: 16px;
  font-weight: 700;
}
.pmeta {
  font-size: 11px;
  color: var(--c-text-3);
  margin-top: 2px;
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
  border-bottom: 1px solid var(--c-line);
  color: var(--c-text);
  font-size: 14px;
  padding: 14px;
  cursor: pointer;
}
.menu-item:last-child {
  border-bottom: none;
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
.foot {
  font-size: 10px;
  color: var(--c-text-3);
  text-align: center;
  margin: 4px 0 8px;
}
</style>
