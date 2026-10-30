/**
 * zebra-swiper 运行时垫片
 * ------------------------------------------------------------------
 * 为什么需要这个东西
 * @zebra-ui/swiper v3.0.3 是 uni-app 生态的组件，源码里散布着 `uni.getSystemInfoSync()`、
 * `uni.upx2px()`、`uni.createSelectorQuery()` 这类调用。它在 H5 分支（`isWeb()` 为真）
 * 大部分逻辑直接操作真实 DOM，但少数工具函数仍会摸到 `uni.*` 全局对象 —— 在 Tauri 的
 * WebView 里这个对象并不存在，于是会抛 `uni is not defined` 并让整屏白掉。
 *
 * 这里的做法：在 main.ts 里**先** import 这个文件，再 import 组件，往 window.uni 挂一个
 * 最小可用的实现。只补齐组件真正会调到的几个方法，并且全部按浏览器语义实现，
 * 不改动组件自身代码（不 patch node_modules，升级依赖时不会丢补丁）。
 *
 * 另外两个配套点：
 *   1. `<view>` / `<text>` 在小程序里是块级容器，在浏览器里是未知标签（默认 inline）。
 *      样式见 src/styles/zebra-compat.css，把 view 设成 display:block，否则滑轨宽度算不出来；
 *   2. 组件的样式是 scss（@zebra-ui/swiper/index.scss），在 main.ts 里统一引入。
 */

interface UniLike {
  [key: string]: unknown
}

function px(value: number): number {
  return Math.round(value)
}

/** rpx → px：uni-app 以 750 为设计稿宽度基准 */
function upx2px(value: number): number {
  const width = typeof window !== 'undefined' ? window.innerWidth : 375
  return (value * width) / 750
}

function systemInfo() {
  const width = typeof window !== 'undefined' ? window.innerWidth : 375
  const height = typeof window !== 'undefined' ? window.innerHeight : 667
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isAndroid = /Android/i.test(ua)
  const isIOS = /iPhone|iPad|iPod|iOS/i.test(ua)
  return {
    // 本应用只跑在 Android / iOS 的 Tauri WebView 上，桌面浏览器当作普通 web
    platform: isAndroid ? 'android' : isIOS ? 'ios' : 'web',
    osName: isAndroid ? 'android' : isIOS ? 'ios' : 'web',
    system: isAndroid ? 'Android' : isIOS ? 'iOS' : 'web',
    model: 'Stland',
    brand: 'Stland',
    windowWidth: width,
    windowHeight: height,
    screenWidth: typeof screen !== 'undefined' ? screen.width : width,
    screenHeight: typeof screen !== 'undefined' ? screen.height : height,
    screenTop: 0,
    pixelRatio: dpr,
    statusBarHeight: 0,
    safeArea: {
      left: 0,
      right: width,
      top: 0,
      bottom: height,
      width,
      height,
    },
  }
}

/** 极简 storage：把 uni 的同步存储映射到 localStorage */
function storage(kind: 'get' | 'set' | 'remove', key: string, data?: unknown) {
  try {
    if (kind === 'get') {
      const raw = window.localStorage.getItem(key)
      return raw === null ? '' : (JSON.parse(raw) as unknown)
    }
    if (kind === 'set') {
      window.localStorage.setItem(key, JSON.stringify(data))
      return undefined
    }
    window.localStorage.removeItem(key)
  } catch {
    /* 隐私模式下 localStorage 可能不可用，组件不该因此崩掉 */
  }
  return ''
}

/**
 * createSelectorQuery 的兜底实现。
 * 组件用它量滑块尺寸；H5 分支其实走 getRect() 直接读 DOM，
 * 这里仍给一个能用的版本，避免个别分支调用时炸掉。
 */
function createSelectorQuery() {
  const tasks: Array<() => void> = []
  const result: Array<Record<string, number>> = []
  const query = {
    in() {
      return query
    },
    select(selector: string) {
      let el: Element | null = null
      try {
        el = document.querySelector(selector)
      } catch {
        el = null
      }
      const rect = el ? el.getBoundingClientRect() : null
      const payload = {
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        top: rect ? Math.round(rect.top) : 0,
        left: rect ? Math.round(rect.left) : 0,
        right: rect ? Math.round(rect.right) : 0,
        bottom: rect ? Math.round(rect.bottom) : 0,
        dataset: {},
      }
      return {
        boundingClientRect(cb?: (r: typeof payload) => void) {
          if (cb) cb(payload)
          result.push(payload as unknown as Record<string, number>)
          return query
        },
        fields() {
          return query
        },
      }
    },
    selectAll() {
      return {
        boundingClientRect(cb?: (r: unknown[]) => void) {
          if (cb) cb([])
          return query
        },
      }
    },
    exec(cb?: (r: unknown[]) => void) {
      if (cb) cb(result)
      tasks.length = 0
      return query
    },
  }
  return query
}

export function installUniShim(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { uni?: UniLike }
  // 已经存在（例如将来迁回 uni-app）就不要覆盖
  if (w.uni) return

  const win = window as unknown as {
    uni?: UniLike
  }

  win.uni = {
    upx2px,
    rpx2px: upx2px,
    getSystemInfoSync: systemInfo,
    getSystemInfo: (opts?: { success?: (r: unknown) => void }) => {
      opts?.success?.(systemInfo())
    },
    getWindowInfo: () => systemInfo(),
    getDeviceInfo: () => {
      const info = systemInfo()
      return { osName: info.osName, platform: info.platform, model: info.model, brand: info.brand }
    },
    getAppBaseInfo: () => systemInfo(),
    setStorageSync: (key: string, data: unknown) => storage('set', key, data),
    getStorageSync: (key: string) => storage('get', key),
    removeStorageSync: (key: string) => storage('remove', key),
    createSelectorQuery,
    // 窗口尺寸变化：组件用来重算尺寸
    onWindowResize: (cb: () => void) => {
      window.addEventListener('resize', cb)
    },
    offWindowResize: (cb: () => void) => {
      window.removeEventListener('resize', cb)
    },
    // 少数交互反馈，无实现即可
    vibrateShort: () => undefined,
    nextTick: (cb: () => void) => {
      void Promise.resolve().then(cb)
    },
  }

  void px
}

export default installUniShim
