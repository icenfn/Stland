<script setup lang="ts">
/**
 * 我的面板（重写）。
 *
 * 定位上只回答三件事：「我是谁」「我的风险承受力」「我能去哪里设置」。
 * 钱的事一律归交易页 —— 资产、盈亏、持仓、委托、成交都在那一页的 tab 里，
 * 这里不再重复摆一份，否则两处数字一旦不同步就会互相打脸。
 *
 * 与旧版的三处差别：
 *  1) 顶部换成「身份头图」：头像 + 名称 + 账号 + 账户类型，一眼看完身份；
 *  2) 删掉「委托与成交」入口 —— 该功能已并进交易页 tab，
 *     保留入口会让用户以为还存在一个独立的委托页面；
 *  3) 把「风险偏好」「资金流水」「设置」「关于」拆成标准分组列表，
 *     每项带图标与右侧说明，替换原来一堆孤立的卡片与按钮。
 */
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { levelLabel, levelTone, useRisk } from '@/stores/risk'
import { fmtDateTime, fmtMoney } from '@/utils/format'

const router = useRouter()
const auth = useAuth()
const risk = useRisk()

const user = computed(() => auth.state.user)

const roleLabel = computed(() => {
  // 交易账户只有零售与机构；管理员是服务端独立表，不会出现在客户端身份里
  const map: Record<string, string> = { retail: '零售账户', institution: '机构账户' }
  return map[user.value?.role ?? 'retail'] ?? '账户'
})

const initial = computed(() =>
  (user.value?.display_name || user.value?.username || 'U').slice(0, 1).toUpperCase(),
)

const riskText = computed(() =>
  risk.assessed ? levelLabel(risk.level) : '未测评',
)

function go(path: string) {
  void router.push(path)
}

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
  <div class="page profile">
    <!-- 未登录：只给登录/注册入口 -->
    <div v-if="!user" class="px guest-wrap">
      <div class="card guest">
        <div class="guest-avatar">?</div>
        <div class="guest-t">登录后查看账户</div>
        <p class="text-xs hint">行情与个股无需登录即可浏览；交易、自选、持仓需要账户。</p>
        <button class="btn btn-primary btn-block" @click="go('/login')">立即登录</button>
      </div>
    </div>

    <template v-else>
      <!-- 身份头图 -->
      <section class="hero">
        <div class="hero-inner px">
          <div class="avatar">{{ initial }}</div>
          <div class="grow hero-text">
            <div class="pname">{{ user.display_name || user.username }}</div>
            <div class="pmeta">
              <span class="pm-id">{{ user.username }}</span>
              <span class="pm-tag">{{ roleLabel }}</span>
            </div>
          </div>
        </div>
        <div class="hero-stats">
          <div class="hs-cell">
            <span class="hs-k">总资产</span>
            <span class="hs-v tabular">{{ fmtMoney(user.total_asset) }}</span>
          </div>
          <div class="hs-cell">
            <span class="hs-k">风险偏好</span>
            <span class="hs-v" :style="{ color: risk.assessed ? levelTone(risk.level) : undefined }">
              {{ riskText }}
            </span>
          </div>
        </div>
      </section>

      <!-- 账户与安全 -->
      <section class="px grp">
        <p class="grp-title">账户</p>
        <div class="card menu">
          <button class="menu-item" @click="go('/risk')">
            <span class="mi-icon">◎</span>
            <span class="mi-main">
              <span class="mi-t">风险偏好测评</span>
              <span class="mi-s">
                <template v-if="risk.assessed">
                  {{ riskText }} · {{ fmtDateTime(risk.assessedAt) }}
                </template>
                <template v-else>未测评，用于匹配可承受的仓位波动</template>
              </span>
            </span>
            <span class="arrow">›</span>
          </button>

          <button v-if="auth.isInstitution" class="menu-item" @click="go('/institution')">
            <span class="mi-icon">▤</span>
            <span class="mi-main">
              <span class="mi-t">机构交易台</span>
              <span class="mi-s">大宗与信用额度</span>
            </span>
            <span class="arrow">›</span>
          </button>
        </div>
      </section>

      <!-- 交易相关全部收进交易页，这里只留跳转 -->
      <section class="px grp">
        <p class="grp-title">交易</p>
        <div class="card menu">
          <button class="menu-item" @click="go('/trade')">
            <span class="mi-icon">▦</span>
            <span class="mi-main">
              <span class="mi-t">持仓 · 委托 · 成交</span>
              <span class="mi-s">在交易页用标签切换查看</span>
            </span>
            <span class="arrow">›</span>
          </button>
          <button class="menu-item" @click="go('/watch')">
            <span class="mi-icon">★</span>
            <span class="mi-main">
              <span class="mi-t">我的自选</span>
              <span class="mi-s">分组管理与拖拽排序</span>
            </span>
            <span class="arrow">›</span>
          </button>
        </div>
      </section>

      <!-- 关于 -->
      <section class="px grp">
        <p class="grp-title">关于</p>
        <div class="card menu">
          <div class="menu-item static">
            <span class="mi-icon">ⓘ</span>
            <span class="mi-main">
              <span class="mi-t">版本</span>
              <span class="mi-s">Stland 股岛 · 模拟交易</span>
            </span>
            <span class="ver tabular">1.0.0</span>
          </div>
        </div>
      </section>

      <section class="px grp">
        <button class="btn btn-ghost btn-block logout" @click="doLogout">退出登录</button>
      </section>

      <p class="foot">全部行情由内置引擎生成，不构成任何投资建议</p>
    </template>
  </div>
</template>

<style scoped>
.profile {
  padding-bottom: 18px;
}

/* ---- 身份头图 ---- */
.hero {
  background: linear-gradient(155deg, #223142, #161e29 70%);
  border-bottom: 1px solid var(--c-line);
  padding-bottom: 14px;
}
.hero-inner {
  display: flex;
  align-items: center;
  gap: 13px;
  padding-top: 18px;
}
.avatar {
  width: 52px;
  height: 52px;
  border-radius: 17px;
  background: linear-gradient(135deg, #ff6b6d, #c1272b);
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  flex: 0 0 auto;
}
.hero-text {
  min-width: 0;
}
.pname {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.2px;
}
.pmeta {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 4px;
}
.pm-id {
  font-size: 11px;
  color: var(--c-text-3);
}
.pm-tag {
  font-size: 10px;
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.13);
  padding: 1px 7px;
  border-radius: 5px;
}
.hero-stats {
  display: flex;
  gap: 10px;
  margin: 15px 14px 0;
  padding: 11px 13px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
}
.hs-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.hs-k {
  font-size: 10px;
  color: var(--c-text-3);
}
.hs-v {
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 分组列表 ---- */
.grp {
  margin-top: 16px;
}
.grp-title {
  font-size: 11px;
  color: var(--c-text-3);
  margin: 0 0 7px 3px;
}
.menu {
  padding: 0;
  overflow: hidden;
}
.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--c-line);
  color: var(--c-text);
  padding: 12px 13px;
  text-align: left;
  cursor: pointer;
}
.menu-item:last-child {
  border-bottom: none;
}
.menu-item.static {
  cursor: default;
}
.mi-icon {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--c-bg-elevated);
  color: var(--c-text-2);
  font-size: 13px;
}
.mi-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mi-t {
  font-size: 13.5px;
  font-weight: 500;
}
.mi-s {
  font-size: 10.5px;
  color: var(--c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arrow {
  color: var(--c-text-3);
  font-size: 15px;
  flex: 0 0 auto;
}
.ver {
  font-size: 11px;
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
  margin: 18px 0 6px;
}

/* ---- 未登录 ---- */
.guest-wrap {
  padding-top: 26px;
}
.guest {
  text-align: center;
  padding-top: 22px;
}
.guest-avatar {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: var(--c-bg-elevated);
  display: grid;
  place-items: center;
  font-size: 22px;
  color: var(--c-text-3);
}
.guest-t {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}
.guest .hint {
  margin: 0 0 16px;
}
</style>
