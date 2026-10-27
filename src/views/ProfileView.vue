<script setup lang="ts">
/**
 * 我的：账户信息、风险测评入口、常用菜单、退出。
 *
 * 本轮三处调整：
 *  · 删除「运营管理后台」入口 —— 账户与标的管理全部迁到服务端 WebUI，客户端不再持管理员能力；
 *  · 风险偏好从三个按钮改为测评结果展示 + 「去测评/重新测评」入口，未测评时不显示等级；
 *  · 菜单与卡片间距统一到全局令牌，避免各页面自成一派。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { feedback } from '@/naive'
import { useAuth } from '@/stores/auth'
import { accountApi } from '@/api'
import { levelLabel, levelTone, useRisk } from '@/stores/risk'
import { fmtDateTime } from '@/utils/format'
import AppBar from '@/components/AppBar.vue'

const router = useRouter()
const auth = useAuth()
const risk = useRisk()
const message = ref('')

const user = computed(() => auth.state.user)
const roleLabel = computed(() => {
  const map: Record<string, string> = { retail: '普通零售', institution: '机构专业', admin: '管理员' }
  return map[user.value?.role ?? 'retail'] ?? ''
})

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

    <section class="px sect">
      <div class="card profile-card">
        <div class="avatar">{{ (user?.display_name ?? 'U').slice(0, 1) }}</div>
        <div class="grow">
          <div class="pname">{{ user?.display_name ?? user?.username }}</div>
          <div class="pmeta">{{ user?.username }} · {{ roleLabel }}</div>
        </div>
        <span v-if="risk.assessed.value" class="tag" :style="{ color: levelTone(risk.level.value) }">
          {{ levelLabel(risk.level.value) }}
        </span>
        <span v-else class="tag">未测评</span>
      </div>
    </section>

    <p v-if="message" class="msg px">{{ message }}</p>

    <!-- 风险偏好：仅展示测评结论，操作统一走测评页 -->
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
            <span class="text-xs tabular">{{ risk.score.value }} 分 · {{ fmtDateTime(risk.assessedAt.value) }}</span>
          </div>
        </template>
        <p v-else class="text-xs hint">尚未完成风险测评，因此不显示风险偏好。先答 5 道题，再得到结论。</p>

        <button class="btn btn-ghost btn-block risk-btn" @click="router.push('/risk')">
          {{ risk.assessed.value ? '重新测评' : '开始风险测评' }}
        </button>
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
        <button class="menu-item" @click="resetAccount">
          <span>重置演示账户</span><span class="arrow">›</span>
        </button>
      </div>
    </section>

    <section class="px">
      <div class="card about">
        <div class="card-h">关于 Stland</div>
        <p class="text-sm about-text">
          Stland 股岛是一套自包含股票交易系统：服务端内置标的池与模拟交易所（撮合、结算、风控、审计），
          客户端为 Tauri + Vue3 移动应用。全部行情由内置引擎生成，不依赖任何外部行情数据源。
        </p>
        <p class="text-xs about-ver">
          版本 1.0.0 · 账户与标的的运营管理在服务端 WebUI 完成，客户端不提供管理入口
        </p>
      </div>
    </section>

    <section class="px">
      <button class="btn btn-ghost btn-block logout" @click="doLogout">退出登录</button>
    </section>
  </div>
</template>

<style scoped>
.sect {
  padding-top: 10px;
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
.about-text {
  line-height: 1.75;
  margin: 0;
}
.about-ver {
  margin: 8px 0 0;
  color: var(--c-text-3);
  line-height: 1.6;
}
.logout {
  color: #ff8b8d;
  border-color: rgba(255, 77, 79, 0.35);
}
</style>
