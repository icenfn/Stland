<script setup lang="ts">
/**
 * 五档买卖盘。
 *
 * 为什么从详情页挪进图表组件：五档必须和 K 线同屏对照才有意义 ——
 * 看盘的人是在「价位 + 盘口挂单」之间来回扫的，两者拆成两个卡片、
 * 或者被挤到图表下方的窄条里，视线就得来回跳。现在它以固定窄栏
 * 贴在图表右侧，跟随图表一起上下滚动。
 *
 * 指数没有委托簿，因此由调用方（K 线组件）决定是否渲染本组件：
 * 指数位置改为涨跌家数分布（见 KLineChart 的 side 插槽）。
 */
import { computed } from 'vue'
import type { Depth, DepthLevel } from '@/api/types'
import { fmtPrice, fmtVolume } from '@/utils/format'

const props = defineProps<{
  /** 盘口数据；为空表示尚未加载到 */
  depth?: Depth | null
  /** 加载中提示语，与「无数据」区分开 */
  loading?: boolean
}>()

/** 卖档倒序：卖5→卖1 从上到下，与常见行情软件一致 */
const asks = computed<DepthLevel[]>(() => [...(props.depth?.asks ?? [])].reverse())
const bids = computed<DepthLevel[]>(() => props.depth?.bids ?? [])

/** 挂单量越大，背景条越长 —— 用相对本档最大值归一，一眼看出厚薄 */
const maxVol = computed(() => {
  const all = [...asks.value, ...bids.value].map((d) => d.volume || 0)
  return Math.max(1, ...all)
})
function barWidth(d: DepthLevel): string {
  return `${Math.min(100, ((d.volume || 0) / maxVol.value) * 100)}%`
}
</script>

<template>
  <div class="depth">
    <template v-if="depth">
      <div v-for="(a, i) in asks" :key="'a' + i" class="drow">
        <i class="dbar up" :style="{ width: barWidth(a) }"></i>
        <span class="dlabel">卖{{ asks.length - i }}</span>
        <span class="dprice up tabular">{{ fmtPrice(a.price) }}</span>
        <span class="dvol tabular">{{ fmtVolume(a.volume) }}</span>
      </div>
      <div class="dsep"></div>
      <div v-for="(b, i) in bids" :key="'b' + i" class="drow">
        <i class="dbar down" :style="{ width: barWidth(b) }"></i>
        <span class="dlabel">买{{ i + 1 }}</span>
        <span class="dprice down tabular">{{ fmtPrice(b.price) }}</span>
        <span class="dvol tabular">{{ fmtVolume(b.volume) }}</span>
      </div>
    </template>
    <div v-else class="dempty">{{ loading ? '盘口加载中…' : '暂无盘口' }}</div>
  </div>
</template>

<style scoped>
.depth {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 一行一档：标签 · 价格 · 挂单量（手） */
.drow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 17px;
  font-size: 11px;
  line-height: 17px;
  overflow: hidden;
}

/* 挂单量背景条：从右侧生长，作为「量能厚度」的视觉提示 */
.dbar {
  position: absolute;
  right: 0;
  top: 1px;
  bottom: 1px;
  border-radius: 2px;
  opacity: 0.16;
  pointer-events: none;
}
.dbar.up {
  background: #ff4d4f;
}
.dbar.down {
  background: #12b76a;
}

.dlabel {
  position: relative;
  flex: 0 0 24px;
  color: var(--c-text-3, #8b96a5);
}
.dprice {
  position: relative;
  flex: 1;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dvol {
  position: relative;
  flex: 0 0 34px;
  text-align: right;
  color: var(--c-text-2, #aab4c2);
  font-variant-numeric: tabular-nums;
}

/* 卖买分界：一条细线，比留白更明确 */
.dsep {
  height: 1px;
  margin: 3px 0;
  background: rgba(255, 255, 255, 0.1);
}

.dempty {
  padding: 10px 0;
  font-size: 11px;
  color: var(--c-text-3, #8b96a5);
  text-align: center;
}

.tabular {
  font-variant-numeric: tabular-nums;
}
.up {
  color: #ff4d4f;
}
.down {
  color: #12b76a;
}
</style>
