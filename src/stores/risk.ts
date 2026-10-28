/**
 * 风险偏好状态：**以服务端为唯一事实来源**。
 *
 * 这里修的是一个真实 bug：上一版把「是否已测评」存在 localStorage，
 * 服务端 `risk_level` 默认值又是 1，无法区分「真的选了保守」与「从没测过」，
 * 于是客户端只好靠本地档案兜底。结果是——测评完能显示，但清缓存 / 换设备 /
 * WebView 存储被回收后，重进软件又变成「开始风险测评」，与用户在服务端看到的
 * 已测评状态不一致。
 *
 * 本版口径：服务端在 `user` 行上写 `risk_assessed_at`（时间戳），
 * 客户端每次进入页面都从 `/api/account/risk` 读，`assessed` 由时间戳决定。
 * 本地只保留一份缓存用于首屏不闪，回读后一以服务端为准；不再有版本号失效逻辑
 * （问卷版本变化由服务端复算分数处理，不需要客户端作废旧记录）。
 */
import { computed, reactive } from 'vue'
import { accountApi } from '@/api'
import type { RiskProfile } from '@/api/types'
import { useAuth } from '@/stores/auth'

/** 问卷版本：与题目/评分口径同步，仅用于上报，不再用于作废本地记录 */
export const RISK_VERSION = 3

export interface RiskQuestion {
  id: string
  title: string
  options: Array<{ label: string; score: number }>
}

/** 5 题，选项分值 0/2/4/6，满分 30（与服务端 RISK_OPTION_SCORES 完全对应） */
export const RISK_QUESTIONS: RiskQuestion[] = [
  {
    id: 'horizon',
    title: '这笔钱你打算放多久？',
    options: [
      { label: '3 个月以内，随时可能要用', score: 0 },
      { label: '半年到 1 年', score: 2 },
      { label: '1—3 年', score: 4 },
      { label: '3 年以上，不急用', score: 6 },
    ],
  },
  {
    id: 'drawdown',
    title: '持仓一个月内浮亏 20%，你会怎么做？',
    options: [
      { label: '立刻全部卖出，不想再看到亏损', score: 0 },
      { label: '减掉一半仓位观望', score: 2 },
      { label: '不动，等它涨回来', score: 4 },
      { label: '继续加仓，越跌越买', score: 6 },
    ],
  },
  {
    id: 'experience',
    title: '你的股票投资经验有多久？',
    options: [
      { label: '几乎没有，只买过货币基金', score: 0 },
      { label: '不到 1 年', score: 2 },
      { label: '1—3 年', score: 4 },
      { label: '3 年以上，经历过完整牛熊', score: 6 },
    ],
  },
  {
    id: 'goal',
    title: '你更看重哪种收益结构？',
    options: [
      { label: '本金安全，跑赢通胀即可', score: 0 },
      { label: '稳中有进，回撤别太大', score: 2 },
      { label: '较高收益，能接受明显回撤', score: 4 },
      { label: '追求高弹性，愿意承担大幅波动', score: 6 },
    ],
  },
  {
    id: 'ratio',
    title: '这笔投资占你可支配资产的比例？',
    options: [
      { label: '超过 70%，几乎是全部身家', score: 0 },
      { label: '50% 左右', score: 2 },
      { label: '20%—30%', score: 4 },
      { label: '不足 10%，亏光也不影响生活', score: 6 },
    ],
  },
]

/** 与服务端 score_to_level 一致：按满分三等分切档 */
const HALF = 30 / 3

export function levelOf(score: number): 1 | 2 | 3 {
  if (score < HALF) return 1
  if (score < HALF * 2) return 2
  return 3
}

export function levelLabel(level: number | undefined): string {
  if (level === 3) return '进取型'
  if (level === 2) return '稳健型'
  if (level === 1) return '保守型'
  return '未测评'
}

export function levelTone(level: number | undefined): string {
  if (level === 3) return '#ff8b8d'
  if (level === 2) return '#f0a020'
  if (level === 1) return '#7aa9ff'
  return '#6b7789'
}

const EMPTY: RiskProfile = { assessed: false, level: 0, label: '未测评', score: 0, assessed_at: 0 }

const state = reactive({
  profile: { ...EMPTY } as RiskProfile,
  loading: false,
  saving: false,
  error: '',
  loaded: false,
})

export function useRisk() {
  const { syncUser } = useAuth()

  /** 已测评 = 服务端有测评时间戳。这是唯一判据，客户端不再自行推断 */
  const assessed = computed(() => state.profile.assessed)

  /** 未测评时等级恒为 0，页面据此只显示「开始风险测评」 */
  const level = computed(() => (state.profile.assessed ? state.profile.level : 0))
  const score = computed(() => (state.profile.assessed ? state.profile.score : 0))
  const assessedAt = computed(() => (state.profile.assessed ? state.profile.assessed_at : 0))
  const label = computed(() => levelLabel(level.value))

  /**
   * 从服务端同步。登录后、进入资产页/个人页/测评页时都应调用一次。
   * 失败不清空已有值 —— 网络抖动不该让页面回退成「未测评」误导用户。
   */
  async function refresh(force = false): Promise<RiskProfile> {
    if (state.loading) return state.profile
    if (state.loaded && !force) return state.profile
    state.loading = true
    state.error = ''
    try {
      const res = await accountApi.getRisk()
      state.profile = res
      state.loaded = true
      syncUser({ risk_level: res.assessed ? res.level : 0, risk_assessed: res.assessed, risk_assessed_at: res.assessed_at })
      return res
    } catch (e: any) {
      state.error = e?.message ?? '风险偏好读取失败'
      return state.profile
    } finally {
      state.loading = false
    }
  }

  /** 提交测评：只传答案，分数与等级由服务端复算后回传，以回传值为准 */
  async function submit(answers: number[]): Promise<RiskProfile> {
    state.saving = true
    state.error = ''
    try {
      const res = await accountApi.setRisk({ version: RISK_VERSION, answers: [...answers] })
      state.profile = res.risk
      state.loaded = true
      syncUser({
        risk_level: res.risk.assessed ? res.risk.level : 0,
        risk_assessed: res.risk.assessed,
        risk_assessed_at: res.risk.assessed_at,
      })
      return res.risk
    } catch (e: any) {
      state.error = e?.message ?? '提交失败，请稍后重试'
      throw e
    } finally {
      state.saving = false
    }
  }

  /** 登出时清空内存态，避免下一个账号看到上一个账号的偏好 */
  function reset() {
    state.profile = { ...EMPTY }
    state.loaded = false
    state.error = ''
  }

  return { state, assessed, level, score, assessedAt, label, refresh, submit, reset }
}
