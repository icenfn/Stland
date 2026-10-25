import type { RouteRecordRaw } from 'vue-router'

/** 路由表：三种客户端形态（零售 / 机构 / 管理）共用一套路由，按 meta.role 做能力校验 */
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
    path: '/stock/:code',
    name: 'stock',
    component: () => import('./views/StockView.vue'),
    meta: { title: '详情' },
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
    path: '/assets',
    name: 'assets',
    component: () => import('./views/AssetsView.vue'),
    meta: { title: '资产', tab: 'assets' },
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
    path: '/admin',
    name: 'admin',
    component: () => import('./views/admin/AdminView.vue'),
    meta: { title: '运营管理', role: 'admin.all' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
