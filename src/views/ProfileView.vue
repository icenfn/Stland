<script setup lang="ts">
import { feedback } from '@/naive'
/** 我的：账户信息、角色能力、风控等级、退出登录 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { accountApi } from '@/api'
import AppBar from '@/components/AppBar.vue'

const router = useRouter()
const auth = useAuth()
const message = ref('')
const riskOptions = [
  { v: 1, label: '保守' },
  { v: 2, label: '稳健' },
  { v: 3, label: '进取' },
]

const user = computed(() => auth.state.user)
const roleLabel = computed(() => {
  const map: Record<string, string> = { retail: '普通零售', institution: '机构专业', admin: '管理端' }
  return map[user.value?.role ?? 'retail'] ?? ''
})

async function setRisk(v: number) {
  try {
    await accountApi.setRisk(v)
    auth.syncUser({ risk_level: v })
    message.value = '风险偏好已更新'
  } catch (e: any) {
    message.value = e?.message ?? '更新失败'
  }
}

async function doLogout() {
  await auth.logout()
  await router.replace('/login')
}

async function resetAccount() {
  const ok = await feedback.confirm({
    title: '重置账户',
    content: '将清空持仓、委托与流水，并恢复初始资金。此操作不可撤销。',
    positiveText: '确认重置',
    danger: true,
  })
  if (!ok) return
  try {
    const res = await accountApi.reset()
    message.value = `账户已重置，可用资金 ${res.cash.toFixed(2)} 元`
    await auth.hydrate()
  } catch (e: any) {
    message.value = e?.message ?? '重置失败'
  }
}
</script>

<template>
  <div class="page">
    <AppBar title="我的" />

    <section class="px" style="padding-top: 12px">
      <div class="card profile-card">
        <div class="avatar">{{ (user?.display_name ?? 'U').slice(0, 1) }}</div>
        <div class="grow">
          <div class="pname">{{ user?.display_name ?? user?.username }}</div>
          <div class="pmeta">{{ user?.username }} · {{ roleLabel }}</div>
        </div>
        <span class="tag tag-blue">{{ user?.risk_level === 3 ? '进取型' : user?.risk_level === 2 ? '稳健型' : '保守型' }}</span>
      </div>
    </section>

    <p v-if="message" class="msg px">{{ message }}</p>

    <section class="px">
      <div class="card">
        <div class="card-h">风险偏好</div>
        <div class="risk-row">
          <button v-for="r in riskOptions" :key="r.v" class="risk-btn"
            :class="{ on: user?.risk_level === r.v }" @click="setRisk(r.v)">
            {{ r.label }}
          </button>
        </div>
        <p class="text-xs" style="margin-top: 8px; line-height: 1.6">
          风险偏好用于展示适配的风险画像指标，不影响撮合规则。
        </p>
      </div>
    </section>

    <section class="px">
      <div class="card menu">
        <button class="menu-item" @click="router.push('/orders')">
          <span>委托与成交</span><span class="arrow">›</span>
        </button>
        <button class="menu-item" @click="router.push('/assets')">
          <span>资产与持仓</span><span class="arrow">›</span>
        </button>
        <button v-if="auth.isInstitution.value" class="menu-item" @click="router.push('/institution')">
          <span>机构交易台</span><span class="arrow">›</span>
        </button>
        <button v-if="auth.isAdmin.value" class="menu-item" @click="router.push('/admin')">
          <span>运营管理后台</span><span class="arrow">›</span>
        </button>
        <button class="menu-item" @click="resetAccount">
          <span>重置演示账户</span><span class="arrow">›</span>
        </button>
      </div>
    </section>

    <section class="px">
      <div class="card about">
        <div class="card-h">关于 Stland</div>
        <p class="text-sm" style="line-height: 1.75">
          Stland 股岛是一套自包含股票交易系统：服务端内置 28 支标的与模拟交易所（撮合、结算、风控、审计），
          客户端为 Tauri + Vue3 移动应用。全部行情由内置引擎生成，不依赖任何外部行情数据源。
        </p>
        <p class="text-xs" style="margin-top: 8px; color: var(--c-text-3)">
          版本 1.0.0 · 仅用于学习与演示，不构成投资建议
        </p>
      </div>
    </section>

    <section class="px">
      <button class="btn btn-ghost btn-block" style="color: #ff8b8d; border-color: rgba(255,77,79,0.35)"
        @click="doLogout">
        退出登录
      </button>
    </section>
  </div>
</template>

<style scoped>
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
.msg {
  font-size: 12px;
  color: #69e2a5;
  margin: 10px 0 0;
}
.card-h {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.risk-row {
  display: flex;
  gap: 8px;
}
.risk-btn {
  flex: 1;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: 10px;
  color: var(--c-text-2);
  font-size: 13px;
  padding: 10px 0;
  cursor: pointer;
}
.risk-btn.on {
  border-color: var(--c-brand);
  color: #ff8b8d;
  background: rgba(232, 56, 61, 0.1);
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
.about {
  line-height: 1.6;
}
</style>
