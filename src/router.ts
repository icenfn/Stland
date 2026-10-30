import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表。
 *
 * 本轮两处结构性变化：
 *
 * 1) 指数与个股拆成两个独立页面。
 *    上一版共用一个 DetailView，模板里到处是「指数这样、个股那样」的分支，
 *    改个股样式容易碰坏指数。现在两页只写各自那条路径，结构对齐但互不牵连。
 *
 * 2) 首页改为 tab & swiper，不再用路由切换。
 *    行情、自选原本是独立路由，切一次等于整页重挂载：滚动位置丢失、
 *    行情轮询被销毁重建、切换有白屏。现在它们成为首页里的三个滑动面板，
 *    左右滑动或点顶部 tab 切换，路由只保留 /market 与 /watch 作为深链入口
 *    （内部渲染同一个首页容器并定位到对应面板）。
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
    meta: { title: '股岛', tab: 'home', panel: 0 },
  },
  {
    // 深链：仍可通过 /market 进入，但渲染的是首页容器并停在「行情」面板
    path: '/market',
    name: 'market',
    component: () => import('./views/HomeView.vue'),
    meta: { title: '行情', tab: 'home', panel: 1 },
  },
  {
    path: '/watch',
    name: 'watch',
    component: () => import('./views/HomeView.vue'),
    meta: { title: '自选', tab: 'home', panel: 2 },
  },
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
    path: '/trade',
    name: 'trade',
    component: () => import('./views/TradeView.vue'),
    meta: { title: '交易', tab: 'trade' },
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
  // 「资产」「我的」已合并为「交易」页，保留旧地址做重定向，避免旧书签/深链 404
  { path: '/assets', redirect: '/trade' },
  { path: '/profile', redirect: '/trade' },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
