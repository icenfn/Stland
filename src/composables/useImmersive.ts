/**
 * 沉浸式状态栏 + 输入法防遮挡。
 *
 * 实现策略（与 astrbot-plus 同思路，但零额外依赖）：
 * 1) 状态栏：Android 端由原生插件 `stland-systembar` 返回状态栏真实高度（dp）与
 *    是否启用 edge-to-edge；Web 端用 CSS env() 兜底。
 * 2) 键盘：监听 window.visualViewport 的 resize/scroll，用
 *    `window.innerHeight - (visualViewport.height + visualViewport.offsetTop)`
 *    计算被软键盘遮挡的高度，写入 CSS 变量 --keyboard-inset。
 * 3) 焦点：输入框聚焦且被遮挡时，用 scrollIntoView 把输入框滚到可视区域。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface SystemBarInfo {
  height: number
  enabled: boolean
}

const statusBarHeight = ref(0)
const keyboardInset = ref(0)
const keyboardOpen = ref(false)

function applyCssVars() {
  const root = document.documentElement
  root.style.setProperty('--status-bar-height', `${statusBarHeight.value}px`)
  root.style.setProperty('--keyboard-inset', `${keyboardInset.value}px`)
  document.body.classList.toggle('keyboard-open', keyboardOpen.value)
}

/** 尝试调用 Tauri 原生插件；Web 环境静默降级 */
async function queryNativeStatusBar(): Promise<SystemBarInfo | null> {
  try {
    // 动态引入，避免 Web 构建时硬依赖 Tauri 运行时
    const mod = await import('@tauri-apps/api/core')
    const info = await mod.invoke<SystemBarInfo>('plugin:stland-systembar|status_bar_height')
    return info
  } catch {
    return null
  }
}

function setupKeyboardWatcher() {
  const vv = window.visualViewport
  if (!vv) return () => {}

  const onResize = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    // 小于 80px 的多半是浏览器工具栏变化，不算键盘
    keyboardInset.value = inset > 80 ? inset : 0
    keyboardOpen.value = keyboardInset.value > 0
    applyCssVars()

    // 聚焦元素被键盘遮挡时，滚动到可视区
    if (keyboardOpen.value) {
      const el = document.activeElement as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
  }

  vv.addEventListener('resize', onResize)
  vv.addEventListener('scroll', onResize)
  return () => {
    vv.removeEventListener('resize', onResize)
    vv.removeEventListener('scroll', onResize)
  }
}

let cleanupKeyboard: (() => void) | null = null
let initialized = false

export function useImmersiveBar() {
  onMounted(async () => {
    if (initialized) return
    initialized = true

    const native = await queryNativeStatusBar()
    if (native && native.height > 0) {
      statusBarHeight.value = Math.round(native.height)
    } else {
      // 兜底：读取 CSS env() 计算值（iOS 刘海屏/Android 手势导航均有效）
      const probe = document.createElement('div')
      probe.style.cssText =
        'position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);width:1px;pointer-events:none;'
      document.body.appendChild(probe)
      statusBarHeight.value = probe.getBoundingClientRect().height
      document.body.removeChild(probe)
    }
    applyCssVars()
    cleanupKeyboard = setupKeyboardWatcher()
  })

  onBeforeUnmount(() => {
    cleanupKeyboard?.()
    cleanupKeyboard = null
  })

  return { statusBarHeight, keyboardInset, keyboardOpen }
}

export { statusBarHeight, keyboardInset, keyboardOpen }
