<script setup lang="ts">
/**
 * 首页容器：顶部 tab + 左右滑动切换三个面板（概览 / 行情 / 自选）。
 *
 * 为什么改成滑动而不是路由切换：
 *  · 行情、自选原本是独立路由，切一次等于整页重挂载 —— 滚动位置丢失、
 *    行情轮询被销毁重建、切换瞬间还会白屏；
 *  · 这三者本来就属于「看盘」这一件事，用户期待的是翻页，不是换页面。
 *
 * 面板本身保持原样（各自的标题栏、列表、卡片都沿用原有样式），
 * 这一层只负责「把三个已有的页面并排放在一起，并让它们能滑动切换」。
 */
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Reel } from '@reelkit/vue'
import OverviewPanel from './panels/OverviewPanel.vue'
import MarketPanel from './panels/MarketPanel.vue'
import WatchPanel from './panels/WatchPanel.vue'

const route = useRoute()
const router = useRouter()

const TABS = ['概览', '行情', '自选'] as const
const PATHS = ['/', '/market', '/watch'] as const

const reelRef = ref<any>(null)
const active = ref(0)
/** goTo 不可用时的兜底：改 key 让 Reel 以新的 initial-index 重建 */
const reelKey = ref(0)

function clampIndex(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(n, 0), TABS.length - 1)
}

/** 点顶部 tab：优先动画过渡，拿不到 goTo 就重建，保证一定切得过去 */
async function goPanel(i: number) {
  if (i === active.value) return
  const go = reelRef.value?.goTo
  if (typeof go === 'function') {
    active.value = i
    try {
      await go.call(reelRef.value, i)
    } catch {
      /* 动画失败不影响状态 */
    }
  } else {
    active.value = i
    reelKey.value += 1
  }
  if (route.path !== PATHS[i]) void router.replace(PATHS[i])
}

/** 滑动落定：同步索引与地址，不再回头调用 goTo，避免与动画互相打断 */
function onAfterChange(index: number) {
  const i = clampIndex(index)
  if (i === active.value) return
  active.value = i
  if (route.path !== PATHS[i]) void router.replace(PATHS[i])
}

watch(
  () => route.meta.panel,
  (v) => {
    const i = clampIndex(v)
    if (i !== active.value) void goPanel(i)
  },
)

onMounted(() => {
  active.value = clampIndex(route.meta.panel)
})
</script>

<template>
  <div class="home-shell">
    <!-- 顶部 tab：与左右滑动双向联动 -->
    <header class="tabs-bar">
      <button
        v-for="(t, i) in TABS"
        :key="t"
        class="tab"
        :class="{ on: active === i }"
        @click="goPanel(i)"
      >
        {{ t }}
        <i class="ink" />
      </button>
    </header>

    <div class="reel-host">
      <Reel
        ref="reelRef"
        :key="reelKey"
        :count="TABS.length"
        :initial-index="active"
        direction="horizontal"
        :enable-wheel="false"
        @after-change="onAfterChange"
      >
        <template #item="{ index }: { index: number }">
          <div class="panel-scroll">
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

.tabs-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 2px;
  /* 状态栏留白只在这一层做一次（用项目统一的 --status-bar-height，
     它由 useImmersive 按真机状态栏像素写入），面板内的顶栏不再重复留白 */
  padding: var(--status-bar-height) 12px 0;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-line);
  z-index: 10;
}

.tab {
  position: relative;
  background: none;
  border: none;
  color: var(--c-text-3);
  font-family: inherit;
  font-size: 15px;
  padding: 0 12px;
  height: 44px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.tab.on {
  color: var(--c-text);
  font-weight: 700;
}

.ink {
  position: absolute;
  left: 50%;
  bottom: 7px;
  width: 0;
  height: 2.5px;
  border-radius: 2px;
  background: var(--c-brand);
  transform: translateX(-50%);
  transition: width 0.18s ease;
}

.tab.on .ink {
  width: 18px;
}

.reel-host {
  flex: 1;
  min-height: 0;
  position: relative;
  /* 底部给固定 TabBar 留位，避免面板最后一行被遮住 */
  padding-bottom: calc(var(--h-tabbar) + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.panel-scroll {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/*
 * 面板内部本来各自带一条 .app-bar（概览的品牌行、行情的搜索框、自选的刷新/分组）。
 * 这条顶栏的职责是「本面板自己的工具条」，状态栏留白已由上面的 tabs-bar 统一做掉，
 * 所以这里必须去掉它自带的 status-bar 留白，否则顶部会出现两条空白叠在一起。
 * 同时取消 sticky —— 外层 .panel-scroll 已是滚动容器，两层 sticky 会互相打架。
 */
.panel-scroll :deep(.app-bar) {
  padding-top: 0;
  position: static;
}
</style>
