import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 系统返回键的统一处理。
 *
 * 为什么需要这一层：
 *  · 底栏切换页面用 replace，不写历史 —— 用户不希望点了十次格子就要按十次返回；
 *  · 但历史一旦为空，Android 返回键会直接结束 Activity（等于退出应用），
 *    用户只是想从「交易」退回「首页」，结果整个 App 被关掉。
 *
 * 做法：在底栏页的栈顶始终压一条「兜底记录」（与当前地址相同）。
 * 这样返回键永远先落到我们手里，由我们决定去哪，而不是交给系统退出。
 *
 * 怎么判断「这次返回是谁弹的」：
 * 浏览器在派发 popstate 之前就已经改好地址栏，所以同步比较一下就够 ——
 *   · 地址没变 → 弹掉的正是那条兜底记录（我们自己压的）；
 *   · 地址变了 → 是一次真实的页面回退（比如从个股详情退回交易页），不干预。
 * 上一版靠「上一条路由是不是底栏页」来猜，结果从详情页返回后，
 * 下一次按键会被误判成「刚从详情页回来」而白白吃掉一次。
 *
 * 返回语义（按约定）：
 *   在底栏页（非首页）→ 回首页；
 *   在首页第一次 → 提示「再按一次退出股岛」；
 *   在首页第二次 → 退出应用。
 */
const EXIT_HINT = '再按一次退出股岛'

/** 底栏常驻页：这些地址上才需要兜底记录 */
const SHELL_PATHS = ['/', '/market', '/watch', '/trade', '/profile']

let toastEl: HTMLElement | null = null
let toastTimer = 0

/** 轻提示：不引 UI 库，避免为一句提示挂一层 Provider */
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
      'background:rgba(20,28,38,0.94)',
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

/** 退出应用：Tauri 壳里关窗口，浏览器里退化为关标签 */
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

  /** 首页上的按键次数：0=未提示，1=已提示（下一次退出） */
  let stage = 0
  /** 栈顶是否已经压了兜底记录 */
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
  }

  function onPopState(): void {
    const href = window.location.href
    const sameUrl = href === lastHref
    lastHref = href
    const path = window.location.pathname

    // 地址变了：真实的页面回退（例如个股详情 → 交易页），不拦截；
    // 落到哪个页面就按哪个页面重新准备兜底记录。
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

    // 地址没变：弹掉的正是兜底记录，这一下由我们决定去向
    guardPushed = false
    if (!isShell(path)) return

    if (path !== '/') {
      // 非首页：先回首页
      stage = 0
      void router.replace('/')
      ensureGuard()
      return
    }

    // 首页
    if (stage === 0) {
      stage = 1
      showExitHint()
      ensureGuard()
      return
    }
    void exitApp()
  }

  const removeAfterEach = router.afterEach((to) => {
    if (to.meta.tab) {
      stage = 0
      lastHref = window.location.href
      guardPushed = false
      ensureGuard()
    } else {
      guardPushed = false
      lastHref = window.location.href
    }
  })

  onMounted(() => {
    lastHref = window.location.href
    // 起步就压一条，保证第一次返回键不会直接退出应用
    if (isShell(window.location.pathname)) ensureGuard()
    window.addEventListener('popstate', onPopState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState)
    removeAfterEach()
    void route
  })
}
