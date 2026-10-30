<script setup lang="ts">
/**
 * 底部导航：三个主入口（首页 / 交易）。
 *
 * 设计取舍（相对上一版的收敛）：
 *  · 「行情」「自选」不再是独立的底部 Tab —— 它们已成为首页里的左右滑动面板，
 *    再从底栏放两个入口，等于同一件事有两个入口，底栏也被挤成五个格子；
 *  · 「资产」「我的」合并为「交易」—— 两个页面里一大半内容是重复的（持仓、委托入口、
 *    账户设置），分开放让用户在两页之间来回跳；
 *  · 「委托」仍不作为 Tab：委托/成交是「查看历史」的低频动作，独立路由（/orders），
 *    带返回键回到来源页面。
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
  { name: 'trade', label: '交易', path: '/trade', icon: 'wallet' },
]

const activeName = computed(() => {
  // /market、/watch 是首页的深链面板，底栏应继续高亮「首页」
  const tab = route.meta.tab
  if (tab) return String(tab)
  const name = String(route.name ?? '')
  if (name === 'market' || name === 'watch') return 'home'
  return name || 'home'
})

function go(item: TabItem) {
  if (route.path !== item.path) void router.push(item.path)
}

const icons: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  chart: 'M4 20V6M4 20h16M8 20v-6M12 20V9M16 20v-9',
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
