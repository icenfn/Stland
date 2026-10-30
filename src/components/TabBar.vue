<script setup lang="ts">
/**
 * 底部导航：首页 / 行情 / 自选 / 交易 / 我的（五个主页面）。
 *
 * 这五个页面不是五条路由切换，而是同一个 swiper 里的五屏，所以这里点一下
 * 既要把轨道滑过去，也要把地址对齐（router.replace）。
 * 用 replace 不 push：用户不希望点十次格子之后要按十次返回才退得出去；
 * 返回键的去向由 useBackExit 统一接管（回首页 → 提示 → 退出）。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

interface TabItem {
  name: string
  label: string
  path: string
  icon: string
}

const tabs: TabItem[] = [
  { name: 'home', label: '首页', path: '/', icon: 'home' },
  { name: 'market', label: '行情', path: '/market', icon: 'chart' },
  { name: 'watch', label: '自选', path: '/watch', icon: 'star' },
  { name: 'trade', label: '交易', path: '/trade', icon: 'wallet' },
  { name: 'profile', label: '我的', path: '/profile', icon: 'user' },
]

const activeName = computed(() => String(route.meta.tab ?? 'home'))

/**
 * 地址变化即切屏。
 * 这里不直接操作 swiper 实例：外壳监听地址（meta.panel）自己会滑过去，
 * 底栏与滑动两条入口最后都收敛到「地址」这一个状态源，不会出现两边各记一份、越切越乱。
 */
function go(item: TabItem) {
  if (route.path === item.path) return
  void router.replace(item.path)
}

/** 线性图标：与全局 1.7 描边、22px 尺寸一致 */
const icons: Record<string, string> = {
  home: 'M3.5 10.6 12 3.8l8.5 6.8V20a1 1 0 0 1-1 1h-4.6v-6.2H9.1V21H4.5a1 1 0 0 1-1-1z',
  chart: 'M4 20V4M4 20h16M7.5 16v-4M11.5 16V8M15.5 16v-6M19.5 16v-9',
  star: 'M12 3.8l2.55 5.35 5.85.78-4.28 4.1 1.05 5.87L12 17.1l-5.17 2.8 1.05-5.87-4.28-4.1 5.85-.78z',
  wallet: 'M3.5 8.2a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v1.3H6.2a2 2 0 0 0 0 4h14.3v2.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  user: 'M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2M4.4 21c0-4 3.5-7.1 7.6-7.1s7.6 3.1 7.6 7.1',
}
</script>

<template>
  <nav class="tabbar">
    <button
      v-for="item in tabs"
      :key="item.name"
      class="tab"
      :class="{ active: activeName === item.name }"
      :aria-label="item.label"
      @click="go(item)"
    >
      <svg
        class="ico"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path :d="icons[item.icon]" />
      </svg>
      <span class="lbl">{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: stretch;
  height: calc(var(--h-tabbar) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: rgba(14, 20, 29, 0.96);
  backdrop-filter: saturate(160%) blur(16px);
  border-top: 1px solid var(--c-line);
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
  font-family: inherit;
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
