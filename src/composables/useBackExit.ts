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
 * 做法：在框架页（/, /market, /watch, /trade, /profile）栈顶常驻一条「兜底记录」，
 * 让返回键永远先落到我们手里，由我们决定去哪，而不是交给系统退出。
 *
 * 判断「这次返回是谁弹的」：浏览器派发 popstate 之前就改好了地址栏，
 * 所以同步比较一下即可 ——
 *   地址没变 → 弹掉的正是我们自己压的兜底记录；
 *   地址变了 → 是一次真实回退（如个股详情 → 交易页），不干预。
 * 若用「上一条路由是不是框架页」去猜，从详情页返回后下一次按键会被白吃一次。
 *
 * 返回语义（按约定）：
 *   框架内非首页 → 回首页；
 *   首页第一次   → 提示「再按一次退出股岛」；
 *   首页第二次   → 退出应用。
 */
const EXIT_HINT = '再按一次退出股岛'

/** 框架页：只有这些地址上才需要兜底记录 */
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
  let guardPushed = false
  /** 上一次已知地址，用来判断这次是不是弹掉了兜底记录 */
  let lastHref = ''

  function isShell(path: string): boolean {
    return SHELL_PATHS.includes(path)
  }

  function ensureGuard(): void {
    if (guardPushed) return
    window.history.pushState({ stlandGuard: true }, '', window.location.href)
    guardPushed = true
    // 压完必须同步 lastHref：否则下一次 popstate 会拿「压栈前」的地址去比，
    // 把「弹掉兜底记录」误判成一次真实回退，于是从详情页回首页后
    // 第一下按键被白吃，第二下才出现提示 —— 正是要修的那个现象。
    lastHref = window.location.href
  }

  function onPopState(): void {
    const href = window.location.href
    const sameUrl = href === lastHref
    lastHref = href
    const path = window.location.pathname

    // 地址变了：真实回退（详情页 → 框架页），不拦截；落到框架页后重新备好兜底
    if (!sameUrl) {
      if (isShell(path)) {
        stage = 0
        guardPushed = false
        ensureGuard()
      } else {
        guardPushed = false
      }
      return
    }

    // 地址没变：弹掉的是兜底记录，这一下由我们决定去向
    guardPushed = false
    if (!isShell(path)) return

    if (path !== '/') {
      stage = 0
      void router.replace('/')
      ensureGuard()
      return
    }

    if (stage === 0) {
      stage = 1
      showExitHint()
      ensureGuard()
      return
    }
    void exitApp()
  }

  const removeAfterEach = router.afterEach((to) => {
    lastHref = window.location.href
    if (to.meta.tab) {
      // 回到任一框架页都视为「重新开始计次」：从交易页回首页后
      // 再按一次仍然应该先出现提示，而不是直接退出
      stage = 0
      guardPushed = false
      ensureGuard()
    } else {
      guardPushed = false
    }
  })

  onMounted(() => {
    lastHref = window.location.href
    if (isShell(window.location.pathname)) ensureGuard()
    window.addEventListener('popstate', onPopState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState)
    removeAfterEach()
  })

  // route 仅用于让 afterEach 之外的逻辑保持响应式语境，避免 lint 未使用告警
  void route
}
