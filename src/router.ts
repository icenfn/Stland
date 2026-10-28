import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表：只保留客户端职责内的页面。
 *
 * 本轮变化：
 *  · 新增 /watch：自选股成为一级入口（底部 Tab），支持分组切换；
 *  · 新增 /index/:code：指数与个股一样有代码，可以点进去看详情；
 *  · /stock/:code 与 /index/:code 分开：两者详情信息结构不同（指数没有盘口、
 *    不可下单），共用一个页面会到处 if/else，不如各自一份清晰的模板。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('./views/HomeView.vue'),
    meta: { title: '首页', tab: 'home' },
  },
  {
    path: '/market',
    name: 'market',
    component: () => import('./views/MarketView.vue'),
    meta: { title: '行情', tab: 'market' },
  },
  {
    path: '/watch',
    name: 'watch',
    component: () => import('./views/WatchView.vue'),
    meta: { title: '自选', tab: 'watch' },
  },
  {
    path: '/stock/:code',
    name: 'stock',
    component: () => import('./views/StockView.vue'),
    meta: { title: '详情' },
  },
  {
    path: '/index/:code',
    name: 'index',
    component: () => import('./views/IndexView.vue'),
    meta: { title: '指数' },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('./views/OrdersView.vue'),
    // 独立路由：不挂底部 Tab，从资产页 / 首页入口进入后可用返回键回到来源页
    meta: { title: '委托与成交' },
  },
  {
    path: '/assets',
    name: 'assets',
    component: () => import('./views/AssetsView.vue'),
    meta: { title: '资产', tab: 'assets' },
  },
  {
    path: '/risk',
    name: 'risk',
    component: () => import('./views/RiskView.vue'),
    meta: { title: '风险偏好测评' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('./views/ProfileView.vue'),
    meta: { title: '我的', tab: 'profile' },
  },
  {
    path: '/institution',
    name: 'institution',
    component: () => import('./views/institution/DeskView.vue'),
    meta: { title: '机构交易台', role: 'inst.desk' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
