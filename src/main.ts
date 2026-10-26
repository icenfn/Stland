import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { useAuth } from './stores/auth'
import { setUnauthorizedHandler } from './api/http'
import { apiConfig, appMeta } from './config'

import './styles/global.css'
import './styles/immersive.css'

const router = createRouter({
  // 使用 hash 路由：Tauri WebView 加载本地资源时无需服务端重写规则
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

const app = createApp(App)

/**
 * 兜底渲染：任何未捕获的挂载期错误都不应该表现为「一片黑」。
 *
 * 移动端 WebView 没有控制台可看，黑屏是不可诊断的最终形态。
 * 这里把错误直接渲染到页面上，同时暴露服务器地址与版本，
 * 让「连不上」和「前端崩了」这两种完全不同的故障一眼可分。
 */
function renderFatal(detail: string) {
  const el = document.getElementById('app')
  if (!el || el.dataset.fatal === '1') return
  el.dataset.fatal = '1'
  el.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;justify-content:center;gap:14px;
                padding:28px;background:#0b0f16;color:#eaf0f8;
                font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;">
      <div style="font-size:19px;font-weight:600;">Stland 启动失败</div>
      <div style="font-size:13px;line-height:1.75;color:#a6b2c4;word-break:break-all;">${detail}</div>
      <div style="font-size:12px;color:#6b7789;">
        ${appMeta.name} v${appMeta.version} · 服务端 ${apiConfig.baseUrl}
      </div>
    </div>`
}

app.config.errorHandler = (err, _instance, info) => {
  console.error('[stland] 渲染错误', info, err)
  renderFatal(`${info}：${(err as Error)?.message ?? String(err)}`)
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

// 挂载也可能同步抛错（例如组件 setup 异常）。捕获后降级为可读页面而不是黑屏。
try {
  app.mount('#app')
} catch (e) {
  console.error('[stland] 挂载失败', e)
  renderFatal(`挂载失败：${(e as Error)?.message ?? String(e)}`)
}
