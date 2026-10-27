<script setup lang="ts">
/**
 * 我的：账户身份 + 快捷跳转 + 退出。
 *
 * 本版相较上一版的三处删减（都对应「去掉演示/冗余概念」）：
 *  · 删除「重置演示账户」：账户本身就是真实账户，由服务端后台管理，客户端不提供自助重置；
 *  · 删除风险偏好卡片：风险偏好属于「资产/风控」语义，已移到资产页，避免同一指标出现在两处；
 *  · 删除「关于」卡片：产品说明不占用户操作路径，版本信息收敛到页脚一行。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { levelLabel, levelTone, useRisk } from '@/stores/risk'
import AppBar from '@/components/AppBar.vue'

const router = useRouter()
const auth = useAuth()
const risk = useRisk()

const user = computed(() => auth.state.user)

const roleLabel = computed(() => {
  const map: Record<string, string> = { retail: '零售', institution: '机构', admin: '管理员' }
  return map[user.value?.role ?? 'retail'] ?? ''
})

async function doLogout() {
  await auth.logout()
  await router.replace('/login')
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
          <div class="pmeta">{{ user?.username }} · {{ roleLabel }}账户</div>
        </div>
        <span v-if="risk.assessed.value" class="tag" :style="{ color: levelTone(risk.level.value) }">
          {{ levelLabel(risk.level.value) }}
        </span>
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
      </div>
    </section>

    <section class="px">
      <button class="btn btn-ghost btn-block logout" @click="doLogout">退出登录</button>
    </section>

    <p class="foot">Stland 股岛 1.0.0 · 账户与标的由服务端后台管理</p>
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
  color: #ff8b8d;
  border-color: rgba(255, 77, 79, 0.35);
}
.foot {
  font-size: 10px;
  color: var(--c-text-3);
  text-align: center;
  margin: 16px 0 8px;
}
</style>
