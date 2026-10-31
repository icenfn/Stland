<script setup lang="ts">
/**
 * 通用底部抽屉。
 *
 * 抽这一层的目的：下单、分组管理、筛选面板都想「从底部滑上来 + 点遮罩关闭 +
 * 手势下滑关闭」，原先每处各写一份遮罩、动画和返回键哨兵，改一次要改三处。
 *
 * 三件事由本组件统一负责：
 *  1. 遮罩与滑入/滑出动画（transform 动画，不改 max-height，避免内容跳动）；
 *  2. 手势下滑关闭：竖向位移超过阈值（或快速下甩）就关，位移不足则回弹；
 *  3. 返回键哨兵：抽屉打开时压一条历史记录，系统返回只收抽屉、不退页面。
 *
 * 抽屉高度默认按内容自适应（max-height 封顶），也可以传 height 固定高度。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 是否显示（配合 v-model:show 使用） */
    show: boolean
    /** 抽屉最大高度占视口比例，0~1 */
    maxHeight?: number
    /** 点遮罩/手势下滑是否允许关闭 */
    closable?: boolean
  }>(),
  { maxHeight: 0.9, closable: true },
)

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'closed'): void
}>()

/** 手势拖动位移（px），仅向下为正 */
const dragY = ref(0)
/** 是否正在拖动：动画要短暂关掉，否则手指跟不动 */
const dragging = ref(false)
/** 拖动起点 */
let startY = 0
let startT = 0
/** 当前手势是否被判为「纵向拖抽屉」；横向手势（如副图滑动）不参与 */
let vertical = false

/** 判定关闭的距离阈值：抽屉高度的 22%，且不少于 90px */
const closeThreshold = computed(() => Math.max(90, (window.innerHeight * props.maxHeight || 600) * 0.22))

function setShow(v: boolean) {
  if (props.show === v) return
  emit('update:show', v)
  if (!v) emit('closed')
}

function requestClose() {
  if (!props.closable) return
  setShow(false)
}

/** 只在抽屉头部（手柄那条）接管手势，正文里的输入框与滚动不受影响 */
function onTouchStart(e: TouchEvent) {
  if (!props.closable) return
  const t = e.touches[0]
  if (!t) return
  startY = t.clientY
  startT = Date.now()
  dragging.value = true
  vertical = false
  dragY.value = 0
}

function onTouchMove(e: TouchEvent) {
  if (!dragging.value) return
  const t = e.touches[0]
  if (!t) return
  const dy = t.clientY - startY
  // 先给 6px 的判断余量，避免手指刚动就误判方向
  if (!vertical && Math.abs(dy) > 6) vertical = dy > 0
  if (!vertical) {
    dragging.value = false
    dragY.value = 0
    return
  }
  // 只跟手向下，向上拖不拉长（抽屉没有比 100% 更高的状态）
  dragY.value = Math.max(0, dy)
  if (dragY.value > 6) e.preventDefault()
}

function onTouchEnd() {
  if (!dragging.value) {
    dragY.value = 0
    return
  }
  dragging.value = false
  const dy = dragY.value
  const dt = Date.now() - startT
  // 距离够，或「下甩」够快（>0.55px/ms 且位移过 40px）都算关闭意图
  const flung = dt > 0 && dy / dt > 0.55 && dy > 40
  if (dy > closeThreshold.value || flung) {
    dragY.value = 0
    requestClose()
    return
  }
  // 没到阈值就弹回去，交给 CSS transition
  dragY.value = 0
}

/** 抽屉打开期间的返回键哨兵 */
let guarded = false

function guardOn() {
  if (guarded || typeof window === 'undefined') return
  window.history.pushState({ stlandSheet: true }, '')
  guarded = true
  window.addEventListener('popstate', onPopState)
}

function guardOff() {
  window.removeEventListener('popstate', onPopState)
  guarded = false
}

function onPopState() {
  guarded = false
  window.removeEventListener('popstate', onPopState)
  if (props.show) {
    emit('update:show', false)
    emit('closed')
  }
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      dragY.value = 0
      guardOn()
    } else {
      guardOff()
    }
  },
)

onBeforeUnmount(guardOff)

/** 拖动中的内联样式：跟手位移 + 关掉过渡 */
const sheetStyle = computed(() => {
  if (!dragging.value && dragY.value === 0) return {}
  return {
    transform: `translateY(${dragY.value}px)`,
    transition: dragging.value ? 'none' : undefined,
  }
})

defineExpose({ close: requestClose })
</script>

<template>
  <transition name="bsheet">
    <div v-if="show" class="bsheet-mask" @click.self="requestClose">
      <div class="bsheet" :style="{ maxHeight: `calc(var(--vh, 1vh) * ${maxHeight * 100})`, ...sheetStyle }">
        <!-- 手柄区：手势只在这里接管，正文输入与滚动不受影响 -->
        <div
          class="bsheet-grab-area"
          @touchstart.passive="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
          @touchcancel="onTouchEnd"
        >
          <span class="bsheet-grab" />
        </div>
        <slot name="head" />
        <slot />
      </div>
    </div>
  </transition>
</template>

<style scoped>
.bsheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 70;
  display: flex;
  align-items: flex-end;
}

.bsheet {
  width: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--c-bg-elevated);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  border-top: 1px solid var(--c-line);
  padding: 0 16px calc(16px + var(--safe-bottom));
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
  transition: transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
  /* 让浏览器把手势交给我们处理，才能跟手拖动 */
  touch-action: pan-y;
}

/* 手柄热区：比视觉横条大一圈，手指更容易按住 */
.bsheet-grab-area {
  height: 22px;
  margin: 0 -16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bsheet-grab {
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--c-line-strong);
}

.bsheet-enter-active .bsheet,
.bsheet-leave-active .bsheet {
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.bsheet-enter-from,
.bsheet-leave-to {
  opacity: 0;
}
.bsheet-enter-from .bsheet,
.bsheet-leave-to .bsheet {
  transform: translateY(100%);
}
</style>
