import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'

/**
 * 系统返回键的统一处理。
 *
 * 背景
 * ----
 * 底栏切页用的是 replace，不会堆历史；可历史为空时 Android 的返回键会直接
 * 结束 Activity —— 用户只想从「自选」退回「首页」，整个 App 却被关掉。
 *
 * 做法：只在框架页栈顶压一条带标记的「哨兵记录」，让返回键先落到我们手里。
 *
 * 上一版为什么还会误弹提示
 * ------------------------
 * 上一版用 `armed` 布尔表示「此刻是否站在哨兵上」，但有两处把它拧坏了：
 *   1) 进详情页时 afterEach 把 armed 置 false，却没有把「详情页这条记录」
 *      和「哨兵」区分开，返回时又是一次 pushState 补哨兵，栈里出现两条
 *      内容相同、标记相同的记录；
 *   2) 判断是否「按掉了哨兵」只看 armed 的前后值，而 afterEach 会在每次
 *      路由变化后无条件补哨兵，于是「详情页 → 首页」这条真实回退，
 *      也满足「前一帧 armed 为真」的条件 —— 提示就这么弹了出来。
 *
 * 现在怎么判
 * ----------
 * 只用浏览器给的事实：这次 popstate 之前栈顶是不是哨兵（`guardOnTop`），
 * 以及落到的这条记录自己带不带哨兵标记（`e.state[GUARD]`）。
 *   · 前真后假 → 消费掉的正是哨兵，这是一次「在框架页上按了返回」；
 *   · 前假   → 一次普通的历史回退（详情页 → 首页），只补哨兵，绝不提示。
 * 并且 afterEach 只在栈顶确实没有哨兵时才补（幂等），不再无脑 push，
 * 从而不会出现「两条同标记记录」这种把两者混为一谈的状态。
 *
 * 返回语义：
 *   框架内非首页 → 回首页；
 *   首页第一次   → 提示「再按一次退出股岛」；
 *   首页第二次   → 退出应用。
 * 从任意框架页跳进详情/登录后，返回一律只是一次正常回退，不参与上面的计数。
 */
const EXIT_HINT = '再按一次退出股岛'
const GUARD = 'stlandGuard'

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

/**
 * 退出应用。
 *
 * Tauri 2 的 Android 上 `getCurrentWindow().close()` 是有效的；
 * 桌面端同理。浏览器里没有退出权限，`window.close()` 多半是空操作 ——
 * 这时候就退一步：停在当前页并不再提示，避免用户以为有东西坏掉了。
 */
async function exitApp(): Promise<boolean> {
  const t = (window as any).__TAURI__
  try {
    const win = t?.window?.getCurrentWindow?.()
    if (win?.close) {
      await win.close()
      return true
    }
    if (t?.process?.exit) {
      await t.process.exit(0)
      return true
    }
  } catch {
    /* 落到下面的兜底 */
  }
  if ((window as any).__TAURI_INTERNALS__) return true
  try {
    window.close()
  } catch {
    /* 浏览器里拿不到权限，忽略 */
  }
  return false
}

export function useBackExit() {
  const router = useRouter()

  /** 首页上的按键次数：0=还没提示，1=已提示（下一次退出） */
  let stage = 0
  /** 栈顶这条记录是否就是我们压的哨兵（唯一判断依据） */
  let guardOnTop = false

  function isShell(path: string): boolean {
    return SHELL_PATHS.includes(path)
  }

  /** 栈顶是否已经是哨兵 —— 以浏览器 state 为准，避免自己记错 */
  function topIsGuard(): boolean {
    const st = window.history.state as Record<string, unknown> | null
    return Boolean(st && st[GUARD])
  }

  /** 补哨兵：幂等，栈顶已有就不再压 */
  function ensureGuard(): void {
    if (!isShell(window.location.pathname)) {
      guardOnTop = false
      return
    }
    if (!topIsGuard()) {
      window.history.pushState({ ...(window.history.state || {}), [GUARD]: true }, '', window.location.href)
    }
    guardOnTop = true
  }

  function onPopState(e: PopStateEvent): void {
    const wasGuard = guardOnTop
    const landedOnGuard = Boolean(e.state && (e.state as Record<string, unknown>)[GUARD])
    guardOnTop = landedOnGuard

    const path = window.location.pathname

    // 这次回退没有消费哨兵 —— 是一次真实的页内回退（详情页 → 首页等）。
    // 这里绝不能提示；只是把哨兵补回去，供「下一次按键」使用。
    if (!wasGuard) {
      if (isShell(path)) {
        stage = 0
        ensureGuard()
      }
      return
    }

    // 消费掉的是哨兵，说明用户是在框架页上按了返回，由我们决定去向
    if (!isShell(path)) return

    if (path !== '/') {
      // 非首页的框架页：先回首页，并把计次清零
      stage = 0
      void router.replace('/')
      // replace 会覆盖当前记录，稍后再补哨兵（等路由把地址落定）
      window.setTimeout(ensureGuard, 0)
      return
    }

    if (stage === 0) {
      stage = 1
      showExitHint()
      ensureGuard()
      return
    }

    // 第二次：退出。退不掉时（浏览器）恢复成「已提示」状态，不再叠加提示。
    void exitApp().then((ok) => {
      if (!ok) stage = 1
    })
  }

  const removeAfterEach = router.afterEach((to) => {
    if (to.meta.tab) {
      // 回到任一框架页都重新计次：从交易页回首页后再按一次仍应先提示
      stage = 0
      // 等本次导航的地址落定再判断栈顶，避免读到上一页的 state
      window.setTimeout(ensureGuard, 0)
      return
    }
    // 离开框架页（详情 / 登录）：栈顶已是普通记录，哨兵被压在下面
    guardOnTop = false
  })

  onMounted(() => {
    ensureGuard()
    window.addEventListener('popstate', onPopState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState)
    removeAfterEach()
  })
}
