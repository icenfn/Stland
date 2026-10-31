/**
 * 系统返回键与页面返回的统一处理。
 *
 * 一、为什么上一版会「卡在详情页出不来」
 * ------------------------------------
 * 上一版为了防止「返回键直接退出 App」，在框架页上手压了一条哨兵记录
 * （pushState）。但 pushState 复制的是当前记录的 state —— 里面带着 vue-router
 * 自己的位置计数（position / back / current / forward）。于是栈里出现了两条
 * 位置相同的记录，路由再按「目标位置 − 当前位置」算该退几步时得到 0，
 * router.back() 于是什么都不做。
 * 表现就是：进了详情页之后，系统返回键、应用栏返回键都像被按掉，页面停在原地。
 *
 * 二、现在怎么做
 * -------------
 * 1) 哨兵仍然要（否则 Android 上框架页按返回会直接结束进程），但插入时把位置
 *    显式改成「当前 + 1」，记录数变了而位置不重复，位移计算重新成立。
 * 2) 应用栏返回不再依赖浏览器历史，改走 `goBack()`：直接 replace 回最近停留过的
 *    框架页。历史深浅不再影响按钮可用性，这条路径天然不会卡。
 * 3) 退出提示用「上一次按下的时间戳」而非布尔开关：只有 3 秒内的第二次按下
 *    才退出，过期即失效，不会出现「按一次就直接退出」或「再按一次没反应」。
 *
 * 三、框架页但在别的 tab
 * --------------------
 * HomeShell 挂载时通过 `setHomeHandler()` 把「滑回首页」交给这里。切 tab 走的是
 * replace，本来不产生历史，所以这一步只做横向滚动，不动路由。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { Router, RouteLocationNormalized } from 'vue-router'

const EXIT_HINT = '再按一次退出股岛'
/** 二次确认窗口：3 秒 */
const CONFIRM_MS = 3000
/** 哨兵标记：仅用来识别「栈顶这条是我压的」 */
const GUARD = 'stlandGuard'

/** 框架页 tab 序号（0 是首页），与 router 的 meta.panel 一致 */
const TAB_ORDER: Record<string, number> = { home: 0, market: 1, watch: 2, trade: 3, profile: 4 }
const HOME_PATH = '/'

let toastEl: HTMLElement | null = null
let toastTimer = 0

/** 最近一次停留的框架页地址：详情页返回时回到这里 */
let lastShellPath = HOME_PATH
/** HomeShell 注册的「滑回首页」方法 */
let homeHandler: (() => void) | null = null
/** 由 useBackExit 注入的 router 实例，供 goBack() 使用 */
let routerRef: Router | null = null

export function setHomeHandler(fn: (() => void) | null): void {
  homeHandler = fn
}

export function getLastShellPath(): string {
  return lastShellPath
}

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
      'transition:opacity .18s ease',
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
 * Tauri 2 里 `getCurrentWindow().close()` 有效，桌面端同理。浏览器没有退出权限，
 * `window.close()` 基本是空操作 —— 此时返回 false，调用方把状态退回「已提示」，
 * 用户再按一次也不会误以为已经退出。
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
    /* 落到兜底 */
  }
  if ((window as any).__TAURI_INTERNALS__) return true
  try {
    window.close()
  } catch {
    /* 浏览器无权限 */
  }
  return false
}

/** 这条路由是不是框架页 */
export function isShellRoute(r: RouteLocationNormalized): boolean {
  const tab = r.meta?.tab
  return typeof tab === 'string' && tab in TAB_ORDER
}

/** 框架页当前在第几屏 */
function shellIndex(r: RouteLocationNormalized): number {
  const tab = r.meta?.tab
  return typeof tab === 'string' ? (TAB_ORDER[tab] ?? 0) : 0
}

/**
 * 页面返回（应用栏返回按钮统一走这里）。
 *
 * 不用 router.back()：它依赖浏览器历史深浅，历史一旦被外部改动（哨兵、深链直达），
 * back() 就没有目标可退，按钮会「按了没反应」。详情页的来源本来就是框架页，
 * 显式 replace 回去语义更准确，也不受历史状态影响。
 */
export function goBack(fallback = ''): void {
  if (!routerRef) {
    // router 尚未注入（极早期调用）：退回一次历史回退，至少不静默
    window.history.back()
    return
  }
  const target = fallback || lastShellPath || HOME_PATH
  const cur = routerRef.currentRoute.value
  if (cur.path === target) return
  void routerRef.replace(target)
}

/** 从路径反查 tab 名（popstate 时可能拿不到 route 对象，只能靠地址） */
function pathTab(path: string): string {
  const p = path.replace(/^#/, '').split('?')[0]
  if (p === '/' || p === '') return 'home'
  const seg = p.replace(/^\//, '')
  return seg in TAB_ORDER ? seg : ''
}

export function useBackExit() {
  const router = useRouter()
  routerRef = router

  /** 上一次在首页按下返回的时间戳；0 表示没有待确认的退出 */
  let armedAt = 0

  function isShellPath(path: string): boolean {
    return pathTab(path) !== ''
  }

  function topIsGuard(): boolean {
    const st = window.history.state as Record<string, unknown> | null
    return Boolean(st && st[GUARD])
  }

  /**
   * 补哨兵：幂等，且位置显式 +1。
   *
   * 这一步是本轮修复的关键 —— 复制 state 却不修正 position，会造出两条同位置
   * 记录，路由随后算出的位移为 0，返回键于是「失灵」。
   */
  function ensureGuard(): void {
    const path = window.location.hash.replace(/^#/, '') || '/'
    if (!isShellPath(path)) return
    if (topIsGuard()) return
    const prev = (window.history.state || {}) as Record<string, any>
    const nextPos = typeof prev.position === 'number' ? prev.position + 1 : 1
    window.history.pushState({ ...prev, position: nextPos, [GUARD]: true }, '', window.location.href)
  }

  function onPopState(): void {
    // 路由处理 popstate 与这里谁先谁后不固定，统一等一拍再读当前路由
    window.setTimeout(() => {
      const cur = router.currentRoute.value

      if (!isShellRoute(cur)) {
        // 退回详情/登录页之间切换：都不属于「要退出」的场景
        armedAt = 0
        return
      }

      // 落在框架页上：记下它，供详情页返回使用
      lastShellPath = cur.path

      const idx = shellIndex(cur)
      if (idx !== 0) {
        // 非首页：滚回首页，不计入退出
        armedAt = 0
        if (homeHandler) homeHandler()
        else void router.replace(HOME_PATH)
        window.setTimeout(ensureGuard, 0)
        return
      }

      // 首页：3 秒内第二次才退出
      const now = Date.now()
      if (armedAt && now - armedAt <= CONFIRM_MS) {
        armedAt = 0
        void exitApp().then((ok) => {
          // 退不掉（浏览器）时恢复成「已提示」，避免误以为已退出
          if (!ok) armedAt = Date.now()
        })
        return
      }
      armedAt = now
      showExitHint()
      ensureGuard()
    }, 0)
  }

  const removeAfterEach = router.afterEach((to) => {
    if (isShellRoute(to)) {
      lastShellPath = to.path
      armedAt = 0
      window.setTimeout(ensureGuard, 0)
    }
    // 离开框架页：栈顶已变成详情页记录，哨兵被压在下面
  })

  onMounted(() => {
    const cur = router.currentRoute.value
    lastShellPath = isShellRoute(cur) ? cur.path : HOME_PATH
    ensureGuard()
    window.addEventListener('popstate', onPopState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState)
    removeAfterEach()
  })
}
