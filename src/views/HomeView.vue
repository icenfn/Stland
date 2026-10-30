<script setup lang="ts">
/**
 * 首页容器：顶部 tab + 左右滑动切换三个面板（概览 / 行情 / 自选）。
 *
 * 为什么不再用路由切换：
 *  · 行情、自选原本是独立路由，切一次等于整页重挂载 —— 滚动位置丢失、
 *    行情轮询被销毁重建、切换瞬间白屏；
 *  · 三者本来就属于「看盘」这一件事，来回切换时用户期待的是「翻页」，
 *    而不是「换页面」。滑动切换能保留每个面板自己的滚动位置与已加载数据。
 *
 * /market、/watch 仍保留为深链入口，进来后直接停到对应面板，不改变 URL 语义。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Reel } from '@reelkit/vue'
import OverviewPanel from './panels/OverviewPanel.vue'
import MarketPanel from './panels/MarketPanel.vue'
import WatchPanel from './panels/WatchPanel.vue'

const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'market', label: '行情' },
  { key: 'watch', label: '自选' },
] as const

const reelRef = ref<any>(null)
const active = ref(0)

/** 深链进入时按 meta.panel 定位；之后滑动手势会自己维护 active */
function panelFromRoute(): number {
  const p = Number(route.meta.panel ?? 0)
  return Number.isFinite(p) ? Math.min(Math.max(p, 0), TABS.length - 1) : 0
}

/** 点了顶部 tab：先动画面板，再同步 URL，保证刷新后还是这一屏 */
async function goPanel(i: number, syncUrl = true) {
  if (i === active.value) return
  active.value = i
  try {
    await reelRef.value?.goTo?.(i)
  } catch {
    /* goTo 不可用时不阻塞切换（首次挂载前可能存在） */
  }
  if (syncUrl) {
    const path = ['/', '/market', '/watch'][i]
    if (route.path !== path) void router.replace(path)
  }
}

/** 滑动手势落定：只同步索引与 URL，不再回头调用 goTo，避免和动画打架 */
function onAfterChange(index: number) {
  if (typeof index !== 'number' || index === active.value) return
  active.value = index
  const path = ['/', '/market', '/watch'][index]
  if (route.path !== path) void router.replace(path)
}

const initialIndex = computed(panelFromRoute)

watch(
  () => route.meta.panel,
  () => {
    const target = panelFromRoute()
    if (target !== active.value) void goPanel(target, false)
  },
)

onMounted(() => {
  active.value = panelFromRoute()
})
</script>

<template>
  <div class="home-shell">
    <!-- 顶部 tab：与滑动手势双向联动 -->
    <header class="top-tabs">
      <button
        v-for="(t, i) in TABS"
        :key="t.key"
        class="ttab"
        :class="{ on: active === i }"
        @click="goPanel(i)"
      >
        {{ t.label }}
        <i class="ink" />
      </button>
    </header>

    <div class="reel-host">
      <Reel
        ref="reelRef"
        :count="TABS.length"
        :initial-index="initialIndex"
        direction="horizontal"
        :enable-wheel="false"
        @after-change="onAfterChange"
      >
        <template #item="{ index }: { index: number }">
          <div class="panel">
            <OverviewPanel v-if="index === 0" />
            <MarketPanel v-else-if="index === 1" />
            <WatchPanel v-else />
          </div>
        </template>
      </Reel>
    </div>
  </div>
</template>

<style scoped>
.home-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.top-tabs {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: calc(var(--safe-top)) 12px 0;
  height: calc(42px + var(--safe-top));
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-line);
  z-index: 10;
}

.ttab {
  position: relative;
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 15px;
  padding: 0 10px;
  height: 42px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.ttab.on {
  color: var(--c-text);
  font-weight: 700;
}

.ink {
  position: absolute;
  left: 50%;
  bottom: 6px;
  width: 0;
  height: 2.5px;
  border-radius: 2px;
  background: var(--c-brand);
  transform: translateX(-50%);
  transition: width 0.2s ease;
}

.ttab.on .ink {
  width: 18px;
}

/* 给固定底栏让位，避免面板底部内容被遮住 */
.reel-host {
  flex: 1;
  min-height: 0;
  position: relative;
  padding-bottom: calc(var(--h-tabbar) + var(--safe-bottom));
  box-sizing: border-box;
}

.panel {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
</style>
