<script setup lang="ts">
/**
 * 底部导航：首页 / 自选 / 交易 / 我的。
 *
 * 位置决定的依据：
 *  · 「首页」承载看盘 —— 概览与行情在首页内部左右滑动，所以不单独占格子；
 *  · 「自选」是高频账户动作（每天开盘先看它），必须一级可达，不能埋在滑动面板第三屏；
 *  · 「交易」只看钱：总资产、盈亏、持仓、委托入口；
 *  · 「我的」只看账号：身份、风险测评、设置与退出。
 *
 * 切换方式：replace，不写历史。
 * 用户不希望在四个格子之间点了十次之后，要按十次返回才退得出去；
 * 返回键的去向由 useBackExit 统一接管（底栏页 → 回首页 → 提示 → 退出）。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const { isInstitution } = useAuth()

interface TabItem {
  name: string
  label: string
  path: string
  icon: string
}

const tabs: TabItem[] = [
  { name: 'home', label: '首页', path: '/', icon: 'home' },
  { name: 'watch', label: '自选', path: '/watch', icon: 'star' },
  { name: 'trade', label: '交易', path: '/trade', icon: 'wallet' },
  { name: 'profile', label: '我的', path: '/profile', icon: 'user' },
]

const activeName = computed(() => {
  // /market 是首页「行情」面板的深链，底栏继续高亮「首页」
  const tab = route.meta.tab
  if (tab) return String(tab)
  if (route.name === 'market') return 'home'
  return 'home'
})

function go(item: TabItem) {
  if (route.path === item.path) return
  void router.replace(item.path)
}

const icons: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  star: 'M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z',
  wallet: 'M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1H5a2 2 0 0 0 0 4h14v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21c0-3.9 3.6-7 8-7s8 3.1 8 7',
}
</script>

<template>
  <nav class="app-tabbar bottom-bar">
    <button
      v-for="item in tabs"
      :key="item.name"
      class="tab"
      :class="{ active: activeName === item.name }"
      @click="go(item)"
    >
      <svg viewBox="0 0 24 24" class="ico" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">
        <path :d="icons[item.icon]" />
      </svg>
      <span class="lbl">{{ item.label }}</span>
    </button>

    <!-- 机构账号多一个交易台入口：它是角色专有页面，不属于零售的四个格子 -->
    <button v-if="isInstitution" class="tab" :class="{ active: route.name === 'institution' }"
      @click="router.push('/institution')">
      <svg viewBox="0 0 24 24" class="ico" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 20h16M6 20V9l6-5 6 5v11M10 20v-5h4v5" />
      </svg>
      <span class="lbl">交易台</span>
    </button>
  </nav>
</template>

<style scoped>
.app-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: stretch;
  height: calc(var(--h-tabbar) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  transition: transform 0.2s ease;
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 10px;
  padding: 6px 0;
  cursor: pointer;
  transition: color 0.15s ease;
}

.tab.active {
  color: var(--c-brand);
}

.ico {
  width: 22px;
  height: 22px;
}

.lbl {
  line-height: 1;
}
</style>
