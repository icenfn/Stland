<script setup lang="ts">
/**
 * 底部导航。
 *
 * 本轮变化：
 *  · 「行情」「自选」不再各占一个 Tab —— 它们已经成为首页里的滑动面板
 *    （顶部 tab + 左右滑动切换）。再从底栏点一次只是切面板，
 *    却会让人以为要换页面，语义重复。
 *  · 「资产」「我的」合并为「交易」：这两个页原本互相跳转、内容也互相引用
 *    （资产页要看持仓盈亏，我的页要显示总资产），拆成两页等于把一件事分两处看。
 *    合并后资金、持仓、盈亏、账户设置都在同一页。
 *
 * 因此底栏收敛为：首页 / 交易（机构用户多一个交易台）。
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

/** 首页的三个面板与 /market、/watch 深链都归属「首页」这一个 Tab */
const HOME_ALIASES = ['home', 'market', 'watch']

const activeName = computed(() => {
  const name = String(route.meta.tab ?? route.name ?? 'home')
  return HOME_ALIASES.includes(name) ? 'home' : name
})

function go(item: TabItem) {
  // 已经在首页面板里时，点「首页」回到第一个面板，而不是原地不动
  if (item.name === 'home' && activeName.value === 'home') {
    if (route.path !== '/') void router.push('/')
    return
  }
  if (route.path !== item.path) void router.push(item.path)
}

const icons: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  wallet: 'M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1H5a2 2 0 0 0 0 4h14v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
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
