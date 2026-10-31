<script setup lang="ts">
/**
 * 共用底部抽屉。
 *
 * 为什么抽出来：
 *   之前「下单」抽屉自己写了一套遮罩 + 圆角 + 顶部手柄 + 出入场动画，
 *   「委托详情」「分组管理」等另外几处又各写一遍。样式稍有差异就出现
 *   「这个抽屉能拖、那个不能拖」「这个圆角大、那个小」的不一致；
 *   改一处圆角要改三个文件。这里把「外壳」统一：谁用谁只管放内容。
 *
 * 手势拖动关闭（本次新增）：
 *   从手柄/顶部区域按下往下拖，抽屉跟手位移；松手时按两个条件决定去留 ——
 *     · 拖过 1/3 高度，或
 *     · 快速下甩（速度 > 0.5 px/ms，即使距离不长）
 *   满足则关闭，否则回弹复位。这个双条件与主流移动端抽屉一致：
 *   单看距离会让「轻快一甩」被误判为取消，单看速度会让「慢慢拖到底」关不掉。
 *
 * 键盘遮挡：
 *   抽屉里有输入框时，软键盘弹出会顶起 visualViewport 而布局视口不变，
 *   内容被键盘盖住。这里监听 visualViewport 的 resize/scroll，
 *   把抽屉底部 padding 抬到键盘高度，并把获得焦点的输入框滚进可视区。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    show: boolean
    /** 抽屉最大高度，超过则内部滚动 */
    maxHeight?: string
    /** 点遮罩是否关闭；有未保存内容时可置 false */
    maskClosable?: boolean
    /** 顶部是否显示拖拽手柄 */
    grabber?: boolean
    /** 是否启用手势下滑关闭 */
    swipeable?: boolean
  }>(),
  { maxHeight: '90vh', maskClosable: true, grabber: true, swipeable: true },
)

const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const sheetEl = ref<HTMLElement | null>(null)
const dragY = ref(0)
const dragging = ref(false)
let startY = 0
let startT = 0
let pointerId: number | null = null

/** 键盘抬升的高度（px），用于给抽屉底部让位 */
const keyboardInset = ref(0)

const sheetStyle = computed(() => ({
  maxHeight: props.maxHeight,
  transform: dragY.value ? `translateY(${dragY.value}px)` : undefined,
  transition: dragging.value ? 'none' : undefined,
  paddingBottom: `calc(16px + var(--safe-bottom) + ${keyboardInset.value}px)`,
}))

function close() {
  emit('update:show', false)
}

function onMaskClick() {
  if (props.maskClosable) close()
}

/* ---------------- 手势 ---------------- */
function onPointerDown(e: PointerEvent) {
  if (!props.swipeable) return
  // 只有从顶部区域起手才算「拖抽屉」：内容区里滑动是滚动列表，不能抢
  const el = sheetEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const fromTop = e.clientY - rect.top
  if (fromTop > 64) return
  // 抽屉内部正在滚动且不在顶部时，下滑应交给滚动容器
  if (el.scrollTop > 0) return

  dragging.value = true
  startY = e.clientY
  startT = Date.now()
  pointerId = e.pointerId
  el.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || e.pointerId !== pointerId) return
  const dy = e.clientY - startY
  // 只允许向下拖；向上给一点阻尼感（除以 4），避免整块被提上去
  dragY.value = dy > 0 ? dy : dy / 4
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value || e.pointerId !== pointerId) return
  dragging.value = false
  pointerId = null
  const el = sheetEl.value
  const h = el?.getBoundingClientRect().height || 1
  const dy = Math.max(0, dragY.value)
  const dt = Math.max(1, Date.now() - startT)
  const velocity = dy / dt

  // 距离过 1/3 高度，或下甩速度快 —— 任一成立即关闭
  if (dy > h / 3 || velocity > 0.5) {
    dragY.value = 0
    close()
    return
  }
  dragY.value = 0
}

/* ---------------- 键盘遮挡 ---------------- */
function syncViewport() {
  if (typeof window === 'undefined' || !window.visualViewport) return
  const vv = window.visualViewport
  // 布局视口高度 - 可视视口高度 = 被键盘（或浏览器 UI）占掉的部分
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  keyboardInset.value = inset > 80 ? inset : 0
  if (keyboardInset.value > 0) void scrollFocusedIntoView()
}

/** 把当前获得焦点的输入框滚到可视区内，避免它正好落在键盘后面 */
async function scrollFocusedIntoView() {
  await nextTick()
  const el = sheetEl.value
  const active = document.activeElement as HTMLElement | null
  if (!el || !active || !el.contains(active)) return
  const rect = active.getBoundingClientRect()
  const visibleBottom = window.innerHeight - keyboardInset.value
  if (rect.bottom > visibleBottom) {
    el.scrollTop += rect.bottom - visibleBottom + 16
  }
}

watch(
  () => props.show,
  (v) => {
    dragY.value = 0
    dragging.value = false
    if (typeof window === 'undefined' || !window.visualViewport) return
    if (v) {
      window.visualViewport.addEventListener('resize', syncViewport)
      window.visualViewport.addEventListener('scroll', syncViewport)
      syncViewport()
    } else {
      window.visualViewport.removeEventListener('resize', syncViewport)
      window.visualViewport.removeEventListener('scroll', syncViewport)
      keyboardInset.value = 0
    }
  },
)

onBeforeUnmount(() => {
  if (typeof window === 'undefined' || !window.visualViewport) return
  window.visualViewport.removeEventListener('resize', syncViewport)
  window.visualViewport.removeEventListener('scroll', syncViewport)
})

defineExpose({ close })
</script>

<template>
  <transition name="bsheet">
    <div v-if="show" class="bsheet-mask" @click.self="onMaskClick">
      <div
        ref="sheetEl"
        class="bsheet"
        :style="sheetStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div v-if="grabber" class="bsheet-top">
          <span class="bsheet-grab" :class="{ active: dragging }" />
        </div>
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
  padding: 8px 16px calc(16px + var(--safe-bottom));
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
  transition: transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
  touch-action: pan-y;
}
.bsheet-top {
  position: relative;
  height: 18px;
  /* 加大可拖区域，手指不必精准落在 4px 的手柄上 */
  margin: -6px -16px 0;
  padding-top: 6px;
  cursor: grab;
}
.bsheet-grab {
  position: absolute;
  left: 50%;
  top: 6px;
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--c-line-strong);
  transform: translateX(-50%);
  transition: background 0.2s ease;
}
.bsheet-grab.active {
  background: var(--c-brand);
}

.bsheet-enter-active,
.bsheet-leave-active {
  transition: opacity 0.2s ease;
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
