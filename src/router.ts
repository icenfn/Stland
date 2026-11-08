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
    meta: { title: '自选', tab: 'watch', panel: 2, capability: 'account.own' },
  },
  {
    path: '/trade',
    name: 'trade',
    component: () => import('./views/HomeShell.vue'),
    meta: { title: '交易', tab: 'trade', panel: 3, capability: 'trade.own' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('./views/HomeShell.vue'),
    meta: { title: '我的', tab: 'profile', panel: 4, capability: 'account.own' },
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
  // 「委托与成交」已并入交易页的 tab（持仓 / 委托 / 成交），
  // 独立页面与其入口一并删除；旧地址重定向到交易页，外部链接不会 404。
  { path: '/orders', redirect: '/trade' },
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
    meta: { title: '机构交易台', capability: 'inst.desk' },
  },

  // 「资产」已并入「交易」，旧地址不 404
  { path: '/assets', redirect: '/trade' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/**
 * 路由元信息的类型声明（P1-22）。
 *
 * 拆分前后 meta 里混着三种东西：`public` 是访问控制、`tab/panel` 是外壳定位、
 * `title` 是文档标题。以前它们都是 `any`，拼错 `capabilty` 这种键不会报错，
 * 只会静默失效 —— 权限就悄悄丢了。这里显式声明，让类型系统兜住这类错误。
 */
declare module 'vue-router' {
  interface RouteMeta {
    /** 文档标题 */
    title?: string
    /** 无需登录即可访问（登录页、公开行情页） */
    public?: boolean
    /** 底栏标识（外壳五屏） */
    tab?: string
    /** 初始屏序号（外壳五屏） */
    panel?: number
    /** 访问所需能力；由 auth store 的 can() 判定，未登录不放行 */
    capability?: string
  }
}
