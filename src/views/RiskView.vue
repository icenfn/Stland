<script setup lang="ts">
/**
 * 风险偏好测评：5 题问卷 → 分数 → 等级（服务端复算并存档）。
 *
 * 关键点（对应「测评后重进软件又显示开始风险测评」）：
 *  · 页面不读写任何本地档案。是否已测评只认服务端 `risk_assessed_at`；
 *  · 进入页面先 `refresh(true)` 强制拉一次服务端状态；
 *  · 提交后以服务端回传的等级/时间为准。
 *
 * 不存储答题情况：答案只存在于本页 `answers` 这个内存 ref 里，离开页面即消失 ——
 * 不落 localStorage、不落服务端、下次进入也不会回填上次的选择。
 * 也不呈现总分：只有「已完成 x/5」与提交后的等级结论。
 *
 * 分档口径与服务端完全一致：满分三等分 → 下三分之一保守、中间稳健、上三分之一进取。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppBar from '@/components/AppBar.vue'
import { RISK_QUESTIONS, levelLabel, levelOf, levelTone, useRisk } from '@/stores/risk'
import { fmtDateTime } from '@/utils/format'

const router = useRouter()
const risk = useRisk()

const answers = ref<number[]>(new Array(RISK_QUESTIONS.length).fill(-1))
const message = ref('')
const done = ref(false)

const answeredCount = computed(() => answers.value.filter((a) => a >= 0).length)
const complete = computed(() => answeredCount.value === RISK_QUESTIONS.length)

/** 实时预期等级：只算档位、不算总分，最终仍以服务端换算结果为准 */
const liveLevel = computed(() =>
  levelOf(
    RISK_QUESTIONS.reduce(
      (sum, q, i) => sum + (answers.value[i] >= 0 ? q.options[answers.value[i]].score : 0),
      0,
    ),
  ),
)

function pick(qi: number, oi: number) {
  answers.value[qi] = oi
  message.value = ''
}

async function submit() {
  if (!complete.value || risk.state.saving) return
  try {
    const rec = await risk.submit(answers.value)
    done.value = true
    // 提交后立刻抹掉答案：本页不留、别处也没有副本
    answers.value = new Array(RISK_QUESTIONS.length).fill(-1)
    message.value = `测评完成：${levelLabel(rec.level)}`
    window.setTimeout(() => router.back(), 1000)
  } catch (e: any) {
    message.value = e?.message ?? '提交失败'
  }
}

onMounted(async () => {
  // 强制从服务端取最新状态：切账号、换设备、重装后都能正确显示
  await risk.refresh(true)
})
</script>

<template>
  <div class="page" style="padding-bottom: 20px">
    <AppBar back title="风险偏好测评" />

    <section class="px" style="padding-top: 10px">
      <div class="card intro">
        <div class="intro-title">先做一次测评，再谈风险偏好</div>
        <p class="intro-text">
          共 {{ RISK_QUESTIONS.length }} 题，约 1 分钟。结果用于展示你适配的风险偏好等级，
          不影响撮合规则。可随时重新测评，以最后一次为准。
        </p>
        <div v-if="risk.assessed.value" class="done-row">
          <span class="done-tag" :style="{ color: levelTone(risk.level.value) }">
            当前：{{ levelLabel(risk.level.value) }}
          </span>
          <span class="text-xs">{{ fmtDateTime(risk.assessedAt.value) }} 完成</span>
        </div>
        <div v-else class="done-row">
          <span class="text-xs" style="color: var(--c-text-3)">尚未测评</span>
        </div>
      </div>
    </section>

    <section v-for="(q, qi) in RISK_QUESTIONS" :key="q.id" class="px">
      <div class="card q-card">
        <div class="q-title"><span class="q-no">{{ qi + 1 }}</span>{{ q.title }}</div>
        <button
          v-for="(opt, oi) in q.options"
          :key="oi"
          class="q-opt"
          :class="{ on: answers[qi] === oi }"
          @click="pick(qi, oi)"
        >
          <span class="dot" />
          <span class="q-label">{{ opt.label }}</span>
        </button>
      </div>
    </section>

    <section class="px">
      <div class="card result">
        <div class="row-between">
          <span class="text-sm">已完成 {{ answeredCount }}/{{ RISK_QUESTIONS.length }}</span>
          <span class="score tabular">当前倾向 {{ levelLabel(liveLevel) }}</span>
        </div>
      </div>
    </section>

    <p v-if="message" class="msg px" :class="{ err: !done && message }">{{ message }}</p>

    <section class="px">
      <button class="btn btn-primary btn-block" :disabled="!complete || risk.state.saving" @click="submit">
        {{ risk.state.saving ? '提交中…' : complete ? '提交测评' : '请完成全部题目' }}
      </button>
    </section>

    <p class="disclaimer px">
      测评结果仅用于产品内风险偏好展示；本系统为模拟交易环境，不构成任何投资建议。
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
.msg.err {
  color: #ff8b8d;
}
.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  margin: 14px 0 8px;
  line-height: 1.6;
}
</style>
