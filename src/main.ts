import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { useAuth } from './stores/auth'
import { setUnauthorizedHandler, TOKEN_KEY } from './api/http'
import { assertConfig, apiConfig, serverLabel } from './config'

// zebra-swiper 是 uni-app 生态组件，会摸 window.uni 上的几个方法。
// 必须在任何引用到它的组件被求值之前装好垫片，所以这两行放在最前面，
// 且要早于 App.vue / router 的组件树挂载（import 顺序即执行顺序）。
import { installUniShim } from './shims/uni'

installUniShim()

import './styles/global.css'
import './styles/immersive.css'
// zebra-swiper 的样式是 scss，且模板用小程序标签，需要配套的标签样式补齐
import '@zebra-ui/swiper/index.scss'
import './styles/zebra-compat.css'

/**
 * 兜底错误界面。
 *
 * 上一次「打开黑屏」之所以难查，是因为组件树挂载失败后页面上什么都没留下：
 * 用户只看到一片背景色，连「出错了」都不知道。这里在挂载前后各设一道防线，
 * 把错误直接显示在屏幕上，并带上当前服务端地址，便于判断是配置问题还是渲染问题。
 */
function renderFatal(title: string, detail: string): void {
  const el = document.getElementById('app') ?? document.body
  el.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
                box-sizing:border-box;background:#0b0f16;color:#e6ecf5;
                font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:520px;width:100%;">
        <div style="font-size:19px;font-weight:600;margin-bottom:10px;">${title}</div>
        <div style="font-size:13px;line-height:1.7;color:#93a2b8;white-space:pre-wrap;word-break:break-word;">${detail}</div>
        <div style="margin-top:18px;font-size:12px;color:#5f6f85;">
          服务端：${serverLabel}<br/>版本：${apiConfig ? '1.0.0' : '-'}
        </div>
      </div>
    </div>`
}

// 捕获未处理的 Promise 拒绝与全局错误，避免静默失败
window.addEventListener('unhandledrejection', (e) => {
  console.error('[stland] 未处理的 Promise 拒绝', e.reason)
})
window.addEventListener('error', (e) => {
  console.error('[stland] 全局错误', e.error ?? e.message)
})

const router = createRouter({
  // 使用 hash 路由：Tauri WebView 加载本地资源时无需服务端重写规则
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

try {
  // 配置自检：地址写错时立刻给出可读提示，而不是等第一次请求才报奇怪错误
  assertConfig()

  const app = createApp(App)

  // 组件级异常的兜底：任何组件的渲染错误都不会再把整页打黑
  app.config.errorHandler = (err, _instance, info) => {
    console.error('[stland] 组件异常', err, info)
  }

  const auth = useAuth()
  auth.bootstrap()

  /**
   * 全局 401 处理：清理会话并跳回登录页，避免页面卡在"假登录"状态。
   *
   * 但必须区分两种 401：
   *   · 本来带着令牌，却被告知令牌无效 —— 会话真的失效了，才清会话并回登录页；
   *   · 本来就没登录 —— 这是浏览公开行情时请求了需要账户的接口（例如首页的
   *     资产概览）。这种情况下把人踢到登录页是错的：他只想看看行情，
   *     不该连行情都看不到。交给发起方自己降级处理即可。
   */
  setUnauthorizedHandler(() => {
    const hadSession = Boolean(localStorage.getItem(TOKEN_KEY))
    if (!hadSession) return
    auth.forceLogout()
    if (router.currentRoute.value.name !== 'login') {
      void router.replace({ name: 'login' })
    }
  })

  /**
   * 允许未登录浏览的页面。
   *
   * 行情、个股、指数都是公开信息，不该因为没账号就打不开。
   * 自选、交易、委托这些属于账户数据，仍然要求登录。
   */
  const BROWSE_WITHOUT_LOGIN = new Set(['home', 'market', 'stock', 'index'])

  // 路由守卫：未登录可浏览公开行情；账户类页面仍需登录；管理端路由校验角色
  router.beforeEach((to) => {
    const isPublic = to.meta.public === true
    const browseOk = BROWSE_WITHOUT_LOGIN.has(String(to.name ?? ''))
    if (!auth.isLoggedIn.value && !isPublic && !browseOk) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }
    if (to.meta.role && auth.isLoggedIn.value && !auth.can(String(to.meta.role))) {
      return { name: 'home' }
    }
    if (auth.isLoggedIn.value && isPublic) {
      return { name: 'home' }
    }
    return true
  })

  app.use(router)
  app.mount('#app')
} catch (err) {
  console.error('[stland] 启动失败', err)
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)
  renderFatal('应用启动失败', msg)
}
