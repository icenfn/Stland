<script setup lang="ts">
/**
 * 风险测评：5 题问卷 → 分数 → 等级。
 *
 * 为什么要有独立页面：此前「我的」页把风险偏好做成三个按钮，点一下就把
 * risk_level 写进服务端，既没有依据也无法复核。现在按监管惯例做成答题式测评：
 * 每题选项带分值，累计分数映射到保守/稳健/进取三档并存档（含时间与版本）。
 * 未完成测评时，资产页与个人页都不展示风险偏好，只给「去测评」入口。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppBar from '@/components/AppBar.vue'
import { RISK_QUESTIONS, levelLabel, levelTone, useRisk } from '@/stores/risk'
import { fmtDateTime } from '@/utils/format'

const router = useRouter()
const risk = useRisk()

const answers = ref<number[]>(new Array(RISK_QUESTIONS.length).fill(-1))
const message = ref('')

const answeredCount = computed(() => answers.value.filter((a) => a >= 0).length)
const complete = computed(() => answeredCount.value === RISK_QUESTIONS.length)

/** 实时试算分数，让用户在提交前就能看到「答到哪一档」 */
const liveScore = computed(() =>
  RISK_QUESTIONS.reduce((sum, q, i) => sum + (answers.value[i] >= 0 ? q.options[answers.value[i]].score : 0), 0),
)
const liveLevel = computed(() => {
  const s = liveScore.value
  return s <= 7 ? 1 : s <= 13 ? 2 : 3
})

function pick(qi: number, oi: number) {
  answers.value[qi] = oi
  message.value = ''
}

async function submit() {
  if (!complete.value) {
    message.value = '请先完成全部题目'
    return
  }
  try {
    const rec = await risk.submit(answers.value)
    message.value = `测评完成：${rec.score} 分 → ${levelLabel(rec.level)}`
    // 稍作停留让用户看到结果，再回到上一页
    window.setTimeout(() => router.back(), 900)
  } catch (e: any) {
    message.value = e?.message ?? '提交失败'
  }
}

onMounted(() => {
  // 已有档案时回填答案，方便用户复核每题的选择
  const r = risk.record.value
  if (r && Array.isArray(r.answers) && r.answers.length === RISK_QUESTIONS.length) {
    answers.value = [...r.answers]
  }
})
</script>

<template>
  <div class="page">
    <AppBar back title="风险承受能力测评" />

    <section class="px" style="padding-top: 10px">
      <div class="card intro">
        <div class="intro-title">先做一次测评，再谈风险偏好</div>
        <p class="intro-text">
          共 {{ RISK_QUESTIONS.length }} 题，约 1 分钟。测评结果用于为你展示适配的风险画像指标，
          不影响撮合规则。题目口径变化后旧结果会失效，需要重新作答。
        </p>
        <div v-if="risk.assessed.value" class="done-row">
          <span class="done-tag" :style="{ color: levelTone(risk.level.value) }">
            当前：{{ levelLabel(risk.level.value) }}
          </span>
          <span class="text-xs">{{ fmtDateTime(risk.assessedAt.value) }} 完成</span>
        </div>
      </div>
    </section>

    <section v-for="(q, qi) in RISK_QUESTIONS" :key="q.id" class="px">
      <div class="card q-card">
        <div class="q-title"><span class="q-no">{{ qi + 1 }}</span>{{ q.title }}</div>
        <button v-for="(opt, oi) in q.options" :key="oi" class="q-opt" :class="{ on: answers[qi] === oi }"
          @click="pick(qi, oi)">
          <span class="dot" />
          <span class="q-label">{{ opt.label }}</span>
        </button>
      </div>
    </section>

    <section class="px">
      <div class="card result">
        <div class="row-between">
          <span class="text-sm">已完成 {{ answeredCount }}/{{ RISK_QUESTIONS.length }}</span>
          <span class="score tabular">试算 {{ liveScore }} 分 · {{ levelLabel(liveLevel) }}</span>
        </div>
      </div>
    </section>

    <p v-if="message" class="msg px">{{ message }}</p>

    <section class="px">
      <button class="btn btn-primary btn-block" :disabled="!complete || risk.state.saving" @click="submit">
        {{ risk.state.saving ? '提交中…' : complete ? '提交测评' : '请完成全部题目' }}
      </button>
    </section>

    <p class="disclaimer px">
      测评结果仅用于产品内风险画像展示；本系统为模拟交易环境，不构成任何投资建议。
    </p>
  </div>
</template>

<style scoped>
.intro-title {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 6px;
}
.intro-text {
  font-size: 12px;
  color: var(--c-text-2);
  line-height: 1.75;
  margin: 0;
}
.done-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--c-line);
}
.done-tag {
  font-size: 13px;
  font-weight: 700;
}
.q-card {
  margin-top: 10px;
}
.q-title {
  display: flex;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 10px;
}
.q-no {
  flex: 0 0 18px;
  height: 18px;
  border-radius: 5px;
  background: rgba(232, 56, 61, 0.16);
  color: #ff8b8d;
  font-size: 11px;
  display: grid;
  place-items: center;
  margin-top: 1px;
}
.q-opt {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  text-align: left;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: 10px;
  color: var(--c-text-2);
  font-size: 13px;
  line-height: 1.5;
  padding: 10px 12px;
  margin-bottom: 7px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.q-opt:last-child {
  margin-bottom: 0;
}
.q-opt.on {
  border-color: var(--c-brand);
  background: rgba(232, 56, 61, 0.1);
  color: var(--c-text);
}
.dot {
  flex: 0 0 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--c-line-strong);
  margin-top: 2px;
  position: relative;
}
.q-opt.on .dot {
  border-color: var(--c-brand);
}
.q-opt.on .dot::after {
  content: '';
  position: absolute;
  inset: 2.5px;
  border-radius: 50%;
  background: var(--c-brand);
}
.result {
  margin-top: 10px;
}
.score {
  font-size: 12px;
  font-weight: 700;
  color: #ff8b8d;
}
.msg {
  font-size: 12px;
  color: #69e2a5;
  margin: 10px 0 0;
}
.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  margin: 14px 0 8px;
  line-height: 1.6;
}
</style>
