import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表：只保留客户端职责内的页面。
 *
 * 本轮变化：/stock/:code 与 /index/:code 共用同一个详情页组件。
 * 上一版为指数单独做了一份精简模板，结果是同一支标的换个入口就换副样子
 * （指数没有指标网格、没有副图、纵向节奏也不一样），用户要重新学一遍布局。
 * 现在两者走同一套结构，差异只在「盘口位放五档还是涨跌分布」「有没有交易条」，
 * 由组件内部按路由名判断 —— 同一模板内两处分支，远比维护两份模板可靠。
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
    component: () => import('./views/DetailView.vue'),
    meta: { title: '详情' },
  },
  {
    path: '/index/:code',
    name: 'index',
    component: () => import('./views/DetailView.vue'),
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
