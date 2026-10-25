import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { useAuth } from './stores/auth'
import { setUnauthorizedHandler } from './api/http'

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
