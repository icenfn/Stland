/**
 * 风险测评状态：把「风险偏好」从三个按钮升级为一次真正的问卷答题。
 *
 * 为什么要本地记录「是否已评估」：
 * 服务端的 risk_level 字段默认就是 1，无法区分「用户真的选了保守」与
 * 「用户从没评估过」。而产品要求「未评估不显示风险偏好」，所以客户端额外保存
 * 一份带版本号的测评档案（分数、等级、时间）。版本号变更即视为过期，
 * 旧版那种点一下就生效的偏好会自动失效，必须重新答题。
 */
import { computed, reactive } from 'vue'
import { useStorage } from '@vueuse/core'
import { accountApi } from '@/api'
import { useAuth } from '@/stores/auth'

/** 问卷版本：题目或评分口径一变就加一，历史档案自动作废 */
export const RISK_VERSION = 2
const KEY = 'stland.risk_assessment'

export interface RiskRecord {
  version: number
  score: number
  level: 1 | 2 | 3
  assessedAt: number
  answers: number[]
}

export interface RiskQuestion {
  id: string
  title: string
  options: Array<{ label: string; score: number }>
}

/** 5 题 × 0-4 分，满分 20：≤7 保守，8-13 稳健，≥14 进取 */
export const RISK_QUESTIONS: RiskQuestion[] = [
  {
    id: 'horizon',
    title: '你打算把这笔钱放多久？',
    options: [
      { label: '3 个月以内，随时可能要用', score: 0 },
      { label: '半年左右', score: 1 },
      { label: '1—2 年', score: 2 },
      { label: '3 年以上', score: 4 },
    ],
  },
  {
    id: 'drawdown',
    title: '若持仓一个月内浮亏 20%，你会？',
    options: [
      { label: '立刻全部卖出，不想再看到亏损', score: 0 },
      { label: '减掉一半仓位观望', score: 1 },
      { label: '不动，等它涨回来', score: 2 },
      { label: '继续加仓，越跌越买', score: 4 },
    ],
  },
  {
    id: 'experience',
    title: '你的股票/基金投资经验是？',
    options: [
      { label: '几乎没有，只买过货币基金', score: 0 },
      { label: '不到 1 年', score: 1 },
      { label: '1—3 年', score: 2 },
      { label: '3 年以上，经历过完整牛熊', score: 4 },
    ],
  },
  {
    id: 'goal',
    title: '你更看重哪种收益结构？',
    options: [
      { label: '本金安全，跑赢通胀即可', score: 0 },
      { label: '稳中有进，回撤别太大', score: 1 },
      { label: '较高收益，能接受较明显回撤', score: 2 },
      { label: '追求高弹性，愿意承担大幅波动', score: 4 },
    ],
  },
  {
    id: 'ratio',
    title: '这笔投资占你可支配金融资产的比例？',
    options: [
      { label: '超过 70%，几乎全部身家', score: 0 },
      { label: '50% 左右', score: 1 },
      { label: '20%—30%', score: 2 },
      { label: '不足 10%，亏光也不影响生活', score: 4 },
    ],
  },
]

export function levelOf(score: number): 1 | 2 | 3 {
  if (score <= 7) return 1
  if (score <= 13) return 2
  return 3
}

export function levelLabel(level: number | undefined): string {
  if (level === 3) return '进取型'
  if (level === 2) return '稳健型'
  if (level === 1) return '保守型'
  return '未评估'
}

export function levelTone(level: number | undefined): string {
  if (level === 3) return '#ff8b8d'
  if (level === 2) return '#f0a020'
  if (level === 1) return '#7aa9ff'
  return '#6b7789'
}

const stored = useStorage<RiskRecord | null>(KEY, null)

const state = reactive({ saving: false, error: '' })

export function useRisk() {
  const { syncUser } = useAuth()

  /** 档案必须与当前问卷版本一致，否则视为「未评估」 */
  const record = computed<RiskRecord | null>(() => {
    const r = stored.value
    if (!r || r.version !== RISK_VERSION || typeof r.level !== 'number') return null
    return r
  })

  const assessed = computed(() => record.value !== null)
  const level = computed(() => record.value?.level ?? 0)
  const score = computed(() => record.value?.score ?? 0)
  const assessedAt = computed(() => record.value?.assessedAt ?? 0)

  /** 服务端也有 risk_level：以本地有效档案为准，避免旧值冒充已评估 */
  const effectiveLevel = computed(() => (assessed.value ? level.value : 0))

  async function submit(answers: number[]): Promise<RiskRecord> {
    state.saving = true
    state.error = ''
    try {
      const total = RISK_QUESTIONS.reduce((sum, q, i) => {
        const idx = answers[i] ?? 0
        return sum + (q.options[idx]?.score ?? 0)
      }, 0)
      const lv = levelOf(total)
      const rec: RiskRecord = { version: RISK_VERSION, score: total, level: lv, assessedAt: Date.now(), answers }
      // 先落服务端（影响风控画像），成功后再写本地档案，避免「本地显示已评估但服务端没收到」
      await accountApi.setRisk(lv)
      stored.value = rec
      syncUser({ risk_level: lv })
      return rec
    } catch (e: any) {
      state.error = e?.message ?? '提交失败，请稍后重试'
      throw e
    } finally {
      state.saving = false
    }
  }

  function clear() {
    stored.value = null
  }

  return {
    state,
    record,
    assessed,
    level,
    score,
    assessedAt,
    effectiveLevel,
    submit,
    clear,
  }
}
