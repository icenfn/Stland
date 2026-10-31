import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'

/**
 * 系统返回键的统一处理。
 *
 * 为什么需要这层：
 *  · 底栏切页用 replace，不写历史 —— 用户点五个格子不会堆出五条历史；
 *  · 但历史为空时，Android 的返回键会直接结束 Activity（等于退出应用），
 *    用户只是想从「自选」退回「首页」，结果整个 App 被关掉。
 *
 * 做法：在框架页（/, /market, /watch, /trade, /profile）栈顶压一条「哨兵记录」，
 * 返回键永远先落到我们手里，由我们决定去哪，而不是交给系统退出。
 *
 * 本版修正了一个误提示问题：
 *   旧实现靠「地址栏有没有变」来判断这次按键发生在哪，于是
 *   「详情页 → 首页」这一下会误判成首页按键，弹出「再按一次退出股岛」。
 *   现在改用哨兵记录自带的 state 标记 + armed 状态双重判断：
 *     · armed 为 true 且弹回的正是哨兵 → 这一下确实按在框架页上；
 *     · 其它情况都是真实回退（详情/下单/登录 → 框架页），只补哨兵、不提示。
 *
 * 返回语义（按约定）：
 *   框架内非首页 → 回首页；
 *   首页第一次   → 提示「再按一次退出股岛」；
 *   首页第二次   → 退出应用。
 */
const EXIT_HINT = '再按一次退出股岛'

/** 框架页：只有这些地址上才需要哨兵记录 */
const SHELL_PATHS = ['/', '/market', '/watch', '/trade', '/profile']

let toastEl: HTMLElement | null = null
let toastTimer = 0

/** 轻提示：为一句提示不值得挂一层 Provider */
export function showExitHint(text = EXIT_HINT): void {
  if (typeof document === 'undefined') return
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.setAttribute('role', 'status')
    toastEl.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:calc(var(--h-tabbar, 56px) + 44px)',
      'transform:translateX(-50%)',
      'max-width:78vw',
      'padding:9px 16px',
      'border-radius:20px',
      'background:rgba(20,28,38,0.95)',
      'border:1px solid rgba(255,255,255,0.12)',
      'color:#eaf0f8',
      'font-size:13px',
      'line-height:1.4',
      'text-align:center',
      'z-index:9999',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 0.18s ease',
    ].join(';')
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = text
  toastEl.style.opacity = '1'
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.style.opacity = '0'
  }, 1800)
}

/** 退出应用：Tauri 壳里关窗口；浏览器里退化为关标签（拿不到权限时就是空操作） */
async function exitApp(): Promise<void> {
  const t = (window as any).__TAURI__
  try {
    const win = t?.window?.getCurrentWindow?.()
    if (win?.close) {
      await win.close()
      return
    }
    if (t?.app?.exit) {
      await t.app.exit(0)
      return
    }
  } catch {
    /* 落到下面的兜底 */
  }
  window.close()
}

export function useBackExit() {
  const router = useRouter()

  /** 首页上的按键次数：0=还没提示，1=已提示（下一次退出） */
  let stage = 0
  /** 栈顶那条记录是不是我们自己压的哨兵 */
  let armed = false
  /** 正在处理 popstate：这期间的 afterEach 不要抢着补哨兵，否则会把真实回退误判成按键 */
  let inPop = false

  function isShell(path: string): boolean {
    return SHELL_PATHS.includes(path)
  }

  function ensureGuard(): void {
    if (armed) return
    window.history.pushState({ stlandGuard: true }, '', window.location.href)
    armed = true
  }

  function onPopState(ev: PopStateEvent): void {
    inPop = true
    window.setTimeout(() => {
      inPop = false
    }, 0)

    const state = (ev.state ?? {}) as { stlandGuard?: boolean }
    const path = window.location.pathname
    const destShell = isShell(path)
    // 弹回的是哨兵，且我们确实压过一条 → 这次按键发生在框架页上
    const backOnShell = state.stlandGuard === true && armed

    if (!backOnShell) {
      // 真实回退：详情 / 下单 / 登录页 → 框架页。不提示，只把哨兵补回去
      armed = false
      if (destShell) {
        if (path !== '/') stage = 0
        ensureGuard()
      }
      return
    }

    if (path !== '/') {
      // 框架内非首页：回首页，并重新压哨兵
      stage = 0
      armed = false
      void router.replace('/').then(() => ensureGuard())
      return
    }

    if (stage === 0) {
      stage = 1
      showExitHint()
      armed = false
      ensureGuard()
      return
    }

    void exitApp()
  }

  const removeAfterEach = router.afterEach((to) => {
    if (inPop) {
      // popstate 自己会补哨兵；这里只做计次复位，避免「回首页第一下就提示」
      if (!to.meta.tab) {
        armed = false
        stage = 0
      }
      return
    }
    if (to.meta.tab) {
      // 正常（非返回）进入框架页：重新开始计次并压哨兵
      stage = 0
      armed = false
      ensureGuard()
    } else {
      // 进入非框架页：哨兵已经压在脚下，下一次返回由系统处理
      armed = false
      stage = 0
    }
  })

  onMounted(() => {
    if (isShell(window.location.pathname)) ensureGuard()
    window.addEventListener('popstate', onPopState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState)
    removeAfterEach()
  })
}
