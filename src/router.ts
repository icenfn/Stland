import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表：只保留客户端职责内的页面。
 *
 * 说明（对应本轮改造）：
 *  · 删除 /trade：下单不再占一个整页，改为在首页 / 个股页弹出的底部抽屉；
 *  · 删除 /admin：客户端不再管理账户与标的，运营后台由服务端 WebUI（/docs 与 /api/admin）负责；
 *  · 新增 /risk：风险偏好必须通过问卷测评得出，不再是三个按钮随手一点。
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
    path: '/stock/:code',
    name: 'stock',
    component: () => import('./views/StockView.vue'),
    meta: { title: '详情' },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('./views/OrdersView.vue'),
    meta: { title: '委托与成交', tab: 'orders' },
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
    meta: { title: '风险测评' },
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
