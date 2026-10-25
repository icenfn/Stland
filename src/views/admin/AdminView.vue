<script setup lang="ts">
import { feedback } from '@/naive'
/** 管理端：运营总览、用户管理、撮合质量、审计日志、日终结算，仅 admin 可见 */
import { computed, onMounted, ref } from 'vue'
import { adminApi } from '@/api'
import { useAuth } from '@/stores/auth'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtDateTime, fmtPrice } from '@/utils/format'

const auth = useAuth()
const tab = ref<'overview' | 'users' | 'audit'>('overview')
const dash = ref<any>(null)
const users = ref<any[]>([])
const audit = ref<any[]>([])
const matching = ref<any>(null)
const events = ref<any[]>([])
const keyword = ref('')
const message = ref('')
const busy = ref(false)

const kpi = computed(() => dash.value?.kpi ?? {})

async function loadOverview() {
  try {
    const [d, m, e] = await Promise.all([adminApi.dashboard(), adminApi.matching(), adminApi.events(20)])
    dash.value = d
    matching.value = m
    events.value = e.items
  } catch (err: any) {
    message.value = err?.message ?? '加载失败'
  }
}

async function loadUsers() {
  try {
    const res = await adminApi.users(keyword.value.trim())
    users.value = res.items
  } catch (err: any) {
    message.value = err?.message ?? '加载失败'
  }
}

async function loadAudit() {
  try {
    const res = await adminApi.audit(120)
    audit.value = res.items
  } catch (err: any) {
    message.value = err?.message ?? '加载失败'
  }
}

async function switchTab(t: typeof tab.value) {
  tab.value = t
  if (t === 'overview') await loadOverview()
  else if (t === 'users') await loadUsers()
  else await loadAudit()
}

async function toggleStatus(u: any) {
  const next = u.status === 'active' ? 'frozen' : 'active'
  try {
    await adminApi.setUserStatus(u.id, next)
    u.status = next
    message.value = `${u.username} 状态已更新为 ${next}`
  } catch (err: any) {
    message.value = err?.message ?? '操作失败'
  }
}

async function adjust(u: any) {
  const input = window.prompt(`为 ${u.username} 调整资金（正数入金 / 负数出金）`, '10000')
  if (!input) return
  const amount = Number(input)
  if (!Number.isFinite(amount) || amount === 0) {
    message.value = '请输入有效金额'
    return
  }
  try {
    const res = await adminApi.adjustCash(u.id, amount, '管理端调整')
    u.cash = res.cash
    message.value = `${u.username} 资金已调整，当前可用 ${fmtPrice(res.cash)}`
  } catch (err: any) {
    message.value = err?.message ?? '调整失败'
  }
}

async function settle() {
  const ok = await feedback.confirm({
    title: '日终结转',
    content: '执行后当日买入持仓将解锁为可卖（T+1）。',
    positiveText: '执行结转',
  })
  if (!ok) return
  busy.value = true
  try {
    await adminApi.settle()
    message.value = '日终结转已完成'
    await loadOverview()
  } catch (err: any) {
    message.value = err?.message ?? '结转失败'
  } finally {
    busy.value = false
  }
}

onMounted(loadOverview)
</script>

<template>
  <div class="page">
    <AppBar back title="运营管理">
      <template #actions>
        <span class="tag tag-blue">{{ auth.state.user?.display_name }}</span>
      </template>
    </AppBar>

    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'overview' }" @click="switchTab('overview')">总览</button>
      <button class="tab" :class="{ on: tab === 'users' }" @click="switchTab('users')">用户</button>
      <button class="tab" :class="{ on: tab === 'audit' }" @click="switchTab('audit')">审计</button>
    </div>

    <p v-if="message" class="msg">{{ message }}</p>

    <!-- 总览 -->
    <template v-if="tab === 'overview'">
      <section class="px">
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-v tabular">{{ kpi.user_count ?? 0 }}</span>
            <span class="kpi-k">账户总数</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-v tabular">{{ kpi.active_users ?? 0 }}</span>
            <span class="kpi-k">活跃账户</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-v tabular">{{ kpi.today_orders ?? 0 }}</span>
            <span class="kpi-k">今日委托</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-v tabular">{{ kpi.open_orders ?? 0 }}</span>
            <span class="kpi-k">在途委托</span>
          </div>
        </div>
      </section>

      <section class="px">
        <div class="card">
          <div class="card-h">平台资产与成交</div>
          <div class="line"><span>账户总资产</span><span class="tabular">{{ fmtAmount(kpi.total_asset ?? 0) }}</span></div>
          <div class="line"><span>今日成交额</span><span class="tabular">{{ fmtAmount(kpi.today_turnover ?? 0) }}</span></div>
          <div class="line"><span>今日成交笔数</span><span class="tabular">{{ kpi.today_trades ?? 0 }}</span></div>
          <div class="line"><span>持仓记录数</span><span class="tabular">{{ kpi.position_rows ?? 0 }}</span></div>
        </div>
      </section>

      <section v-if="matching" class="px">
        <div class="card">
          <div class="card-h">撮合质量</div>
          <div class="line"><span>委托笔数</span><span class="tabular">{{ matching.order_count }}</span></div>
          <div class="line"><span>成交笔数</span><span class="tabular">{{ matching.trade_count }}</span></div>
          <div class="line"><span>撮成率</span><span class="tabular up">{{ matching.fill_rate_pct }}%</span></div>
          <div class="line"><span>撤单率</span><span class="tabular">{{ matching.cancel_rate_pct }}%</span></div>
          <div class="line"><span>平均单笔成交额</span><span class="tabular">{{ fmtAmount(matching.avg_trade_amount) }}</span></div>
        </div>
      </section>

      <section class="px">
        <div class="card">
          <div class="card-h">系统事件</div>
          <div v-if="!events.length" class="text-xs">暂无事件</div>
          <div v-for="(e, i) in events" :key="i" class="line">
            <span class="text-xs">{{ fmtDateTime(e.created_at) }} · {{ e.kind }}</span>
            <span class="text-xs muted ellipsis" style="max-width: 55%; text-align: right">{{ e.message }}</span>
          </div>
        </div>
      </section>

      <section class="px">
        <button class="btn btn-primary btn-block" :disabled="busy" @click="settle">
          {{ busy ? '执行中…' : '执行日终结转（T+1 解锁）' }}
        </button>
      </section>
    </template>

    <!-- 用户 -->
    <template v-else-if="tab === 'users'">
      <section class="px">
        <div class="row" style="gap: 8px">
          <input v-model="keyword" class="input" style="flex: 1" placeholder="搜索用户名 / 昵称"
            @keyup.enter="loadUsers" />
          <button class="btn btn-primary" style="padding: 11px 16px" @click="loadUsers">搜索</button>
        </div>
      </section>

      <div v-for="u in users" :key="u.id" class="card user-card">
        <div class="row-between">
          <div>
            <div class="uname">{{ u.display_name }}<span class="ucode">@{{ u.username }}</span></div>
            <div class="text-xs">{{ u.role }} · {{ u.status }} · 风控等级 {{ u.risk_level }}</div>
          </div>
          <span class="tag" :class="u.status === 'active' ? 'tag-blue' : 'tag-hot'">{{ u.status }}</span>
        </div>
        <div class="uasset">
          <div><span class="k">可用</span><span class="tabular">{{ fmtAmount(u.cash) }}</span></div>
          <div><span class="k">市值</span><span class="tabular">{{ fmtAmount(u.market_value) }}</span></div>
          <div><span class="k">总资产</span><span class="tabular">{{ fmtAmount(u.total_asset) }}</span></div>
        </div>
        <div class="row" style="gap: 8px; margin-top: 10px">
          <button class="mini" @click="toggleStatus(u)">
            {{ u.status === 'active' ? '冻结账户' : '解冻账户' }}
          </button>
          <button class="mini" @click="adjust(u)">调整资金</button>
        </div>
      </div>
    </template>

    <!-- 审计 -->
    <template v-else>
      <div v-if="!audit.length" class="empty">暂无审计记录</div>
      <div v-for="a in audit" :key="a.id" class="card audit-card">
        <div class="row-between">
          <span class="audit-action">{{ a.action }}</span>
          <span class="text-xs">{{ fmtDateTime(a.created_at) }}</span>
        </div>
        <div class="text-xs muted" style="margin-top: 4px">
          {{ a.username || '匿名' }} · {{ a.detail }} · {{ a.ip || '-' }}
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
  color: #7aa9ff;
  border-color: var(--c-accent);
  background: rgba(47, 123, 255, 0.12);
}
.msg {
  font-size: 12px;
  color: #69e2a5;
  padding: 0 14px 6px;
}
.kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.kpi-card {
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.kpi-v {
  font-size: 20px;
  font-weight: 700;
}
.kpi-k {
  font-size: 10px;
  color: var(--c-text-3);
}
.card-h {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--c-text-2);
  padding: 6px 0;
  border-bottom: 1px dashed var(--c-line);
  gap: 10px;
}
.line:last-child {
  border-bottom: none;
}
.user-card {
  margin: 8px 14px;
}
.uname {
  font-size: 14px;
  font-weight: 600;
}
.ucode {
  font-size: 11px;
  color: var(--c-text-3);
  margin-left: 6px;
  font-weight: 400;
}
.uasset {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--c-line);
}
.uasset > div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.uasset .k {
  font-size: 10px;
  color: var(--c-text-3);
}
.mini {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 7px 0;
  cursor: pointer;
}
.audit-card {
  margin: 8px 14px;
  padding: 12px;
}
.audit-action {
  font-size: 12px;
  font-weight: 600;
  color: #7aa9ff;
}
</style>
