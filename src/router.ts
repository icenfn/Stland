import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表：只保留客户端职责内的页面。
 *
 * 首页不再是「一个页面」，而是一个外壳（HomeShell.vue）：
 * 首页 / 行情 / 自选 / 交易 / 我的 五屏并排放在同一个 swiper 里，
 * 共用顶部应用栏与底部导航。它们不是五条独立路由切换，而是同一路由下的五种状态。
 *
 * 为什么仍保留五条地址：
 *  · 深链与刷新后能落回原来那一屏（meta.panel 决定初始屏）；
 *  · 底栏高亮、返回键判断都以 meta.tab 为准，有地址才好判定。
 *
 * 详情页（个股/指数/委托/测评/机构台）仍是独立路由，不挂底栏，
 * 从框架页点进去用返回键回到来源页。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },

  // ---- 首页框架的五屏：同一组件，靠 meta.panel 定位初始屏 ----
  {
    path: '/',
    name: 'home',
    component: () => import('./views/HomeShell.vue'),
    meta: { title: '首页', tab: 'home', panel: 0 },
  },
  {
    path: '/market',
    name: 'market',
    component: () => import('./views/HomeShell.vue'),
    meta: { title: '行情', tab: 'market', panel: 1 },
  },
  {
    path: '/watch',
    name: 'watch',
    component: () => import('./views/HomeShell.vue'),
    meta: { title: '自选', tab: 'watch', panel: 2 },
  },
  {
    path: '/trade',
    name: 'trade',
    component: () => import('./views/HomeShell.vue'),
    meta: { title: '交易', tab: 'trade', panel: 3 },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('./views/HomeShell.vue'),
    meta: { title: '我的', tab: 'profile', panel: 4 },
  },

  // ---- 独立页面：不挂底栏，返回键回到来源 ----
  {
    path: '/stock/:code',
    name: 'stock',
    component: () => import('./views/StockDetailView.vue'),
    meta: { title: '个股详情' },
  },
  {
    path: '/index/:code',
    name: 'index',
    component: () => import('./views/IndexDetailView.vue'),
    meta: { title: '指数详情' },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('./views/OrdersView.vue'),
    meta: { title: '委托与成交' },
  },
  {
    path: '/risk',
    name: 'risk',
    component: () => import('./views/RiskView.vue'),
    meta: { title: '风险偏好测评' },
  },
  {
    path: '/institution',
    name: 'institution',
    component: () => import('./views/institution/DeskView.vue'),
    meta: { title: '机构交易台', role: 'inst.desk' },
  },

  // 「资产」已并入「交易」，旧地址不 404
  { path: '/assets', redirect: '/trade' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
