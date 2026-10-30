<script setup lang="ts">
/**
 * 我的：账户身份、风险偏好、设置类入口。
 *
 * 为什么从「交易」里拆出来：
 *  · 交易页原本把「账户是谁」「有多少钱」「持仓」和「退出登录、风险测评」混在一起，
 *    一屏里既有账户资产又有身份设置，性质完全不同；
 *  · 拆开后：交易页只看钱，我的页只看账号。底栏四个入口刚好对应四种意图。
 *
 * 风险测评放在这里而不是交易页：它是对「人」的评估，不是对「这笔钱」的结算。
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppBar from '@/components/AppBar.vue'
import { useAuth } from '@/stores/auth'
import { levelLabel, levelTone, useRisk } from '@/stores/risk'
import { fmtDateTime } from '@/utils/format'

const router = useRouter()
const auth = useAuth()
const risk = useRisk()

const user = computed(() => auth.state.user)

const roleLabel = computed(() => {
  const map: Record<string, string> = { retail: '零售', institution: '机构' }
  return map[user.value?.role ?? 'retail'] ?? ''
})

async function doLogout() {
  await auth.logout()
  await router.replace('/login')
}

onMounted(async () => {
  if (!auth.state.user) return
  await risk.refresh()
})
</script>

<template>
  <div class="page">
    <AppBar title="我的" />

    <!-- 未登录：只给登录入口，不展示伪造的账户信息 -->
    <section v-if="!auth.state.user" class="px sect">
      <div class="card guest">
        <div class="guest-t">登录后查看账户信息</div>
        <p class="text-xs hint">行情与个股不需要登录即可浏览。</p>
        <button class="btn btn-primary btn-block" @click="router.push('/login')">去登录</button>
      </div>
    </section>

    <template v-else>
      <section class="px sect">
        <div class="card profile-card">
          <div class="avatar">{{ (user?.display_name ?? 'U').slice(0, 1) }}</div>
          <div class="grow">
            <div class="pname">{{ user?.display_name ?? user?.username }}</div>
            <div class="pmeta">{{ user?.username }} · {{ roleLabel }}账户</div>
          </div>
        </div>
      </section>

      <!-- 风险偏好：未测评不显示等级，只给测评入口 -->
      <section class="px">
        <div class="card">
          <div class="row-between">
            <span class="card-h">风险偏好</span>
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

      <section class="px">
        <button class="btn btn-ghost btn-block logout" @click="doLogout">退出登录</button>
      </section>

      <p class="foot">Stland 股岛 1.0.0</p>
    </template>
  </div>
</template>

<style scoped>
.sect {
  padding-top: 10px;
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
.logout {
  font-size: 13px;
  padding: 11px 16px;
  color: var(--c-text-2);
}
.foot {
  font-size: 10px;
  color: var(--c-text-3);
  text-align: center;
  margin: 16px 0 8px;
}
</style>
