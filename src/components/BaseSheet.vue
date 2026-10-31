<script setup lang="ts">
/**
 * 全局底部抽屉（BaseSheet）。
 *
 * 所有底部抽屉都必须走这里：下单（委托买卖）、副图切换、自选股分组管理。
 * 抽屉的「壳」只在这一处实现，页面只负责往里放内容 —— 圆角、遮罩、手柄、
 * 入场动画、返回键行为、下滑关闭、键盘遮挡，改一次全站生效。
 *
 * 一、返回键关闭（可复用，不需要各页面自己写）
 * ------------------------------------------
 * 打开时压一条「地址不变」的哨兵历史记录：
 *   · 地址不变 → vue-router 认为位置没变，不会触发路由跳转；
 *   · 因此系统返回键 / 手势返回只是退掉这条哨兵，抽屉收到 popstate 后关闭。
 * 关闭时不直接 emit，而是走同一条 history.back() 路径，保证哨兵不会残留在栈里
 * （残留会让下一次返回变成「什么也没发生」）。
 *
 * 抽屉与页面级返回处理（useBackExit）共用同一个 popstate。抽屉会先标记
 * 「这次返回已被消费」，页面级处理器查到标记就跳过 —— 否则关抽屉与退出首页
 * 会同时发生。
 *
 * 二、下滑关闭（重写）
 * -----------------
 * 只在顶部手柄区域起手（内容区的竖向滑动是滚动列表，不能被抢）。
 * 拖动时抽屉跟手位移，遮罩同步变淡；松手时按「距离 + 速度」双条件判定：
 *   · 位移超过抽屉高度的 28%，或
 *   · 下甩速度超过 0.55 px/ms
 * 命中则继续下滑并关闭（不再回弹，避免「先弹回再滑出」的双段动画），
 * 否则带一段弹簧曲线回弹。手指释放时若抽屉内列表处于滚动状态，则不参与拖拽。
 *
 * 三、布局稳定性（避免关闭时图表闪一下）
 * -----------------------------------
 * 抽屉内部滚动交给内容区，外壳尺寸在开关过程中不变；遮罩不使用 backdrop-filter
 * 与整屏变换，避免抽屉消失时上层合成层重建，连带把下面的 Canvas（K 线、五档）
 * 重新栅格化而闪一帧。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { markBackConsumed } from '@/composables/sheetStack'

const props = withDefaults(
  defineProps<{
    show: boolean
    /** 抽屉最大高度（含手柄与内边距），超过则由内容区滚动 */
    maxHeight?: string
    /** 点遮罩是否关闭；有未保存内容时可置 false */
    maskClosable?: boolean
    /** 顶部是否显示拖拽手柄 */
    grabber?: boolean
    /** 是否启用手势下滑关闭 */
    swipeable?: boolean
  }>(),
  { maxHeight: '88vh', maskClosable: true, grabber: true, swipeable: true },
)

const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const sheetEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)

/** 拖动位移（向下为正） */
const dragY = ref(0)
/** 是否正在被手指拖动 */
const dragging = ref(false)
/** 是否处于「松手后继续滑出」的退场阶段 */
const leaving = ref(false)
/** 键盘抬起高度，用于给内容区底部让位 */
const keyboardInset = ref(0)

let startY = 0
let startT = 0
let pointerId: number | null = null
/** 退场动画的定时器，卸载时清理 */
let leaveTimer = 0

/** 拖动进度 0→1：遮罩渐隐、手柄高亮都用它 */
const progress = computed(() => {
  const h = sheetEl.value?.getBoundingClientRect().height || 1
  return Math.min(1, Math.max(0, dragY.value / h))
})

const maskStyle = computed(() => ({
  opacity: dragging.value || leaving.value ? String(1 - progress.value * 0.85) : undefined,
}))

const sheetStyle = computed(() => ({
  maxHeight: props.maxHeight,
  transform: dragY.value ? `translate3d(0, ${dragY.value}px, 0)` : undefined,
  // 拖动过程必须跟手（不能有过渡），回弹/退场才用动画
  transition: dragging.value ? 'none' : undefined,
}))

const bodyStyle = computed(() => ({
  paddingBottom: `calc(16px + var(--safe-bottom) + ${keyboardInset.value}px)`,
}))

/* ---------------- 返回键 ---------------- */
/** 哨兵是否还压着（true 表示栈顶那条记录是本抽屉压的） */
let armed = false
let guardSeq = 0

function onPopState() {
  // 先声明「这次返回由抽屉消费」，页面级处理器随后会跳过
  markBackConsumed()
  disarm()
  emit('update:show', false)
}

function arm() {
  if (armed || typeof window === 'undefined') return
  const prev = (window.history.state || {}) as Record<string, unknown>
  const pos = typeof prev.position === 'number' ? prev.position + 1 : 1
  // 位置显式 +1：复制 state 却不修正位置会造出两条同位置记录，
  // vue-router 算出的位移为 0，返回键就会「按了没反应」。
  window.history.pushState({ ...prev, position: pos, stlandSheet: ++guardSeq }, '', window.location.href)
  armed = true
  window.addEventListener('popstate', onPopState)
}

function disarm() {
  if (!armed) return
  window.removeEventListener('popstate', onPopState)
  armed = false
}

/** 请求关闭：有哨兵时先退历史，由 popstate 统一收敛到一次 emit */
function requestClose() {
  if (armed) {
    window.history.back()
    return
  }
  emit('update:show', false)
}

/* ---------------- 下滑关闭 ---------------- */
function onPointerDown(e: PointerEvent) {
  if (!props.swipeable || leaving.value) return
  const el = sheetEl.value
  if (!el) return
  // 只有从顶部手柄区起手才算拖抽屉；更靠下属于内容滚动
  const fromTop = e.clientY - el.getBoundingClientRect().top
  if (fromTop > 44) return
  // 内容区已经滚动时，下滑先交回给列表
  if ((bodyEl.value?.scrollTop ?? 0) > 0) return

  dragging.value = true
  startY = e.clientY
  startT = Date.now()
  pointerId = e.pointerId
  el.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || e.pointerId !== pointerId) return
  const dy = e.clientY - startY
  // 只允许向下拖；向上给强阻尼，避免整块被提离底部
  dragY.value = dy > 0 ? dy : dy / 6
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value || e.pointerId !== pointerId) return
  dragging.value = false
  pointerId = null

  const h = sheetEl.value?.getBoundingClientRect().height || 1
  const dy = Math.max(0, dragY.value)
  const dt = Math.max(1, Date.now() - startT)
  const velocity = dy / dt

  if (dy > h * 0.28 || velocity > 0.55) {
    // 命中关闭：继续滑出屏幕后再 emit，视觉上是一条连贯的下滑
    leaving.value = true
    dragY.value = h
    window.clearTimeout(leaveTimer)
    leaveTimer = window.setTimeout(() => {
      leaving.value = false
      dragY.value = 0
      requestClose()
    }, 180)
    return
  }
  // 未命中：回弹
  dragY.value = 0
}

/* ---------------- 键盘遮挡 ---------------- */
function syncViewport() {
  if (typeof window === 'undefined' || !window.visualViewport) return
  const vv = window.visualViewport
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  keyboardInset.value = inset > 80 ? inset : 0
  if (keyboardInset.value > 0) void scrollFocusedIntoView()
}

/** 把获得焦点的输入框滚进可视区，避免落在键盘后面 */
async function scrollFocusedIntoView() {
  await nextTick()
  const el = bodyEl.value
  const active = document.activeElement as HTMLElement | null
  if (!el || !active || !el.contains(active)) return
  const rect = active.getBoundingClientRect()
  const visibleBottom = window.innerHeight - keyboardInset.value
  if (rect.bottom > visibleBottom) el.scrollTop += rect.bottom - visibleBottom + 16
}

watch(
  () => props.show,
  (v) => {
    dragY.value = 0
    dragging.value = false
    leaving.value = false
    if (v) {
      arm()
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncViewport)
        window.visualViewport.addEventListener('scroll', syncViewport)
        syncViewport()
      }
      return
    }
    // 父组件直接把 show 置 false：哨兵必须一并退掉，否则栈里留下一条死记录
    if (armed) window.history.back()
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', syncViewport)
      window.visualViewport.removeEventListener('scroll', syncViewport)
    }
    keyboardInset.value = 0
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.clearTimeout(leaveTimer)
  disarm()
  if (typeof window === 'undefined' || !window.visualViewport) return
  window.visualViewport.removeEventListener('resize', syncViewport)
  window.visualViewport.removeEventListener('scroll', syncViewport)
})

defineExpose({ close: requestClose })
</script>

<template>
  <transition name="bsheet">
    <div v-if="show" class="bsheet-mask" :style="maskStyle" @click.self="maskClosable && requestClose()">
      <div ref="sheetEl" class="bsheet" :style="sheetStyle">
        <div
          v-if="grabber"
          class="bsheet-head"
          :class="{ active: dragging || leaving }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <span class="bsheet-grab" />
          <slot name="head" />
        </div>
        <div ref="bodyEl" class="bsheet-body" :style="bodyStyle">
          <slot />
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.bsheet-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.58);
}

.bsheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 88vh;
  background: var(--c-bg-elevated);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  border-top: 1px solid var(--c-line);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
  /* 自身独立合成层：拖动只用 transform，不触发布局 */
  will-change: transform;
}

/* 顶部手柄区：加大可拖区域，手指不必精准落在 4px 的手柄上 */
.bsheet-head {
  position: relative;
  flex: 0 0 auto;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 6px;
  box-sizing: border-box;
  cursor: grab;
  touch-action: none;
}
.bsheet-head.active {
  cursor: grabbing;
}
.bsheet-grab {
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--c-line-strong);
  transition: background 0.2s ease;
}
.bsheet-head.active .bsheet-grab {
  background: var(--c-brand);
}

/* 内容区独立滚动：外壳尺寸不变，开关不会引起页面重排 */
.bsheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0 16px 0;
  touch-action: pan-y;
}

.bsheet-enter-active,
.bsheet-leave-active {
  transition: opacity 0.18s ease;
}
.bsheet-enter-from,
.bsheet-leave-to {
  opacity: 0;
}
.bsheet-enter-from .bsheet,
.bsheet-leave-to .bsheet {
  transform: translate3d(0, 100%, 0);
}
</style>
