import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 系统返回键的统一处理。
 *
 * 为什么需要这层：
 *  · 底栏切页用 replace，不写历史 —— 用户点五个格子不会堆出五条历史；
 *  · 但历史为空时，Android 的返回键会直接结束 Activity（等于退出应用），
 *    用户只是想从「自选」退回「首页」，结果整个 App 被关掉。
 *
 * 做法：在框架页（/, /market, /watch, /trade, /profile）栈顶常驻一条「哨兵记录」，
 * 让返回键永远先落到我们手里，由我们决定去哪，而不是交给系统退出。
 *
 * 为什么不再比 URL：
 *   上一版靠「popstate 后地址有没有变」判断这次返回是谁弹的。
 *   可 router 在详情页 → 首页这一跳里会再次压哨兵，栈里出现两条同 URL 的记录，
 *   于是「弹掉哨兵」与「从详情页回首页」长得一模一样，URL 比不出来 ——
 *   表现就是刚退回首页、手还没动，提示就先弹了出来。
 *
 *   现在改为给哨兵打 state 标记，并维护 `armed`：它表示「此刻站在哨兵记录上」。
 *   判断一次返回是否弹掉了哨兵，只看 popstate 触发前 armed 是否为真，
 *   与地址是否重复无关，因此「详情页 → 首页」不会被误判成「首页按键」。
 *
 * 返回语义（按约定）：
 *   框架内非首页 → 回首页；
 *   首页第一次   → 提示「再按一次退出股岛」；
 *   首页第二次   → 退出应用。
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
  const route = useRoute()
  const router = useRouter()

  /** 首页上的按键次数：0=还没提示，1=已提示（下一次退出） */
  let stage = 0
  /** 当前历史记录是否就是自己压的哨兵 */
  let armed = false

  function isShell(path: string): boolean {
    return SHELL_PATHS.includes(path)
  }

  /** 在当前地址之上压一条带头标记的哨兵记录 */
  function pushGuard(): void {
    window.history.pushState({ [GUARD]: true }, '', window.location.href)
    armed = true
  }

  function onPopState(e: PopStateEvent): void {
    const wasArmed = armed
    // 落到的那条记录若自己带标记，说明它就是哨兵（可能有多条同 URL 的）
    armed = !!(e.state && e.state[GUARD])
    const path = window.location.pathname

    // 这次返回没触及哨兵：是一次真实的页内回退（详情页 → 上一页），
    // 绝不能当成「首页按键」去弹退出提示 —— 正是要修的那个现象。
    if (!wasArmed) {
      if (isShell(path)) {
        stage = 0
        armed = false
        pushGuard()
      }
      return
    }

    // 弹掉的正是哨兵，这一下由我们决定去向
    if (!isShell(path)) return

    if (path !== '/') {
      stage = 0
      void router.replace('/')
      pushGuard()
      return
    }

    if (stage === 0) {
      stage = 1
      showExitHint()
      pushGuard()
      return
    }
    void exitApp()
  }

  const removeAfterEach = router.afterEach((to) => {
    if (to.meta.tab) {
      // 回到任一框架页都视为「重新开始计次」：从交易页回首页后
      // 再按一次仍然应该先出现提示，而不是直接退出
      stage = 0
      if (!armed) pushGuard()
      return
    }
    // 离开框架页（进详情、登录等）：当前记录已不是哨兵
    armed = false
  })

  onMounted(() => {
    if (isShell(window.location.pathname)) {
      armed = false
      pushGuard()
    }
    window.addEventListener('popstate', onPopState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState)
    removeAfterEach()
  })

  void route
}
