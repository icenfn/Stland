import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表：只保留客户端职责内的页面。
 *
 * 本轮三处变化：
 *
 * 1) 个股与指数各自独立成页（StockDetailView / IndexDetailView）。
 *    上一版两者共用一个组件，模板里按路由名分叉，改个股容易碰坏指数。
 *
 * 2) 首页改为 tab & swiper：概览 / 行情 / 自选成为首页里的三个滑动面板，
 *    不再靠路由切换（切路由等于整页重挂载，滚动位置丢失、行情轮询被销毁重建）。
 *    /market、/watch 仍保留为深链入口，渲染同一个首页并定位到对应面板。
 *
 * 3) 「资产」与「我的」合并为「交易」页；旧地址做重定向，旧书签不会 404。
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
    meta: { title: '首页', tab: 'home', panel: 0 },
  },
  {
    // 深链入口：进首页并停在「行情」面板
    path: '/market',
    name: 'market',
    component: () => import('./views/HomeView.vue'),
    meta: { title: '行情', tab: 'home', panel: 1 },
  },
  {
    // 深链入口：进首页并停在「自选」面板
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
    // 独立路由：不挂底部 Tab，从交易页进入后可用返回键回到来源页
    meta: { title: '委托与成交' },
  },
  // 「资产」「我的」已合并为「交易」，保留旧地址做重定向
  { path: '/assets', redirect: '/trade' },
  { path: '/profile', redirect: '/trade' },
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
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
