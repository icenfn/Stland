import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { useAuth } from './stores/auth'
import { setUnauthorizedHandler } from './api/http'
import { assertConfig, apiConfig, serverLabel } from './config'

import './styles/global.css'
import './styles/immersive.css'

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

  // 全局 401 处理：清理会话并跳回登录页，避免任何页面卡在"假登录"状态
  setUnauthorizedHandler(() => {
    auth.forceLogout()
    if (router.currentRoute.value.name !== 'login') {
      void router.replace({ name: 'login' })
    }
  })

  // 路由守卫：未登录只能访问登录/注册；管理端路由校验角色
  router.beforeEach((to) => {
    const isPublic = to.meta.public === true
    if (!auth.isLoggedIn.value && !isPublic) {
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
