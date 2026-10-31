/**
 * 长按手势（用于「长按加自选」）。
 *
 * 为什么要单独抽出来：长按与点击是两个互斥结果，如果直接写 pointerdown + setTimeout，
 * 很容易出现「长按之后又触发一次 click」—— 结果就是既打开了分组抽屉，
 * 又把股票按默认分组加了一遍。这里的做法：
 *  · 手指按住超过 500ms 且没有明显移动（>10px）才算长按；
 *  · 一旦判定为长按，就置 fired，随后的 pointerup 会主动吞掉这次点击；
 *  · 手指移动超过阈值立即取消计时（那是滑动，不是长按）。
 *
 * 不依赖任何渲染环境，个股页与指数页共用。
 */
import { onBeforeUnmount, ref } from 'vue'

export interface LongPressOptions {
  /** 触发时长，默认 500ms */
  delay?: number
  /** 允许的手指抖动半径，默认 10px */
  tolerance?: number
}

export function useLongPress(onLongPress: () => void, options: LongPressOptions = {}) {
  const delay = options.delay ?? 500
  const tolerance = options.tolerance ?? 10

  /** 是否已判定为长按（用于吞掉后续的 click） */
  const fired = ref(false)
  let timer = 0
  let startX = 0
  let startY = 0
  let pointer: number | null = null

  function clear() {
    window.clearTimeout(timer)
    timer = 0
  }

  function onPointerDown(e: PointerEvent) {
    // 只响应主键/单指，右键与多指不参与
    if (e.button !== 0 && e.pointerType === 'mouse') return
    fired.value = false
    startX = e.clientX
    startY = e.clientY
    pointer = e.pointerId
    clear()
    timer = window.setTimeout(() => {
      fired.value = true
      // 触发长按震动反馈（不支持的平台静默忽略）
      navigator.vibrate?.(12)
      onLongPress()
    }, delay)
  }

  function onPointerMove(e: PointerEvent) {
    if (pointer === null || e.pointerId !== pointer) return
    if (Math.abs(e.clientX - startX) > tolerance || Math.abs(e.clientY - startY) > tolerance) {
      clear()
    }
  }

  function onPointerUp() {
    clear()
    pointer = null
  }

  /**
   * 包在 @click 上：长按过的这一下点击不再执行普通点击逻辑。
   * 返回值说明「是否应继续执行点击」。
   */
  function guardClick(fn: () => void) {
    return () => {
      if (fired.value) {
        fired.value = false
        return
      }
      fn()
    }
  }

  onBeforeUnmount(clear)

  return {
    fired,
    handlers: {
      onPointerdown: onPointerDown,
      onPointermove: onPointerMove,
      onPointerup: onPointerUp,
      onPointercancel: onPointerUp,
      onPointerleave: onPointerUp,
    },
    guardClick,
  }
}
