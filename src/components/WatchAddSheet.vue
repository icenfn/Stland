<script setup lang="ts">
/**
 * 长按「加自选」弹出的分组多选抽屉（个股页与指数页共用）。
 *
 * 为什么要有这个抽屉
 * ----------------
 * 单击加自选 = 「先存起来」，默认进第一个分组，一步到位不用思考；
 * 偶尔用户想一次放进好几个分组（比如「今天盯的」和「新能源」都要），
 * 那就长按 —— 长按是移动端通行的手势约定，不会与单击冲突，也不必在底栏
 * 再挤一个「选择分组」的按钮出来。
 *
 * 交互要点
 * -------
 *  · 已经在的分组默认勾上并标「已加入」，点它不会产生请求（服务端本来也幂等，
 *    但在界面上先把状态说清楚，用户不会以为漏加了）；
 *  · 至少选一个才能提交，按钮在未选中时禁用并给出原因；
 *  · 只提交「本次新选中的分组」，避免把已经加入的又请求一遍；
 *  · 提交成功后才关闭，失败则留在原地并显示原因 —— 用户能直接重试。
 */
import { computed, ref, watch } from 'vue'
import { watchApi } from '@/api'
import type { WatchGroup } from '@/api/types'
import BaseSheet from '@/components/BaseSheet.vue'

const props = defineProps<{
  show: boolean
  /** 标的代码 */
  code: string
  /** 标的名，抽屉标题里显示，避免用户忘了自己在给哪只股票分组 */
  name?: string
  /** 已知的分组列表；为空时自己拉一次 */
  groups?: WatchGroup[]
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'added'): void
}>()

const list = ref<WatchGroup[]>([])
const picked = ref<number[]>([])
/** 已在自选里的分组 */
const existing = ref<number[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')

const canSubmit = computed(() => picked.value.some((id) => !existing.value.includes(id)))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [g, st] = await Promise.all([
      props.groups?.length ? Promise.resolve({ items: props.groups }) : watchApi.groups(),
      watchApi.status(props.code).catch(() => ({ group_ids: [] as number[] })),
    ])
    list.value = g.items
    existing.value = st.group_ids ?? []
    // 已加入的分组默认勾上：用户看到的是「这只股票现在在哪」的真实状态
    picked.value = [...existing.value]
  } catch (e: any) {
    error.value = e?.message ?? '加载分组失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (v) => {
    if (!v) {
      error.value = ''
      return
    }
    void load()
  },
  { immediate: true },
)

function toggle(id: number) {
  // 已加入的分组不允许通过这个抽屉取消 —— 取消自选是另一个明确动作
  if (existing.value.includes(id)) return
  picked.value = picked.value.includes(id)
    ? picked.value.filter((x) => x !== id)
    : [...picked.value, id]
}

async function submit() {
  if (!canSubmit.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const ids = picked.value.filter((id) => !existing.value.includes(id))
    await watchApi.addBatch(props.code, ids.length ? ids : [list.value[0]?.id ?? 0])
    emit('added')
    emit('update:show', false)
  } catch (e: any) {
    error.value = e?.message ?? '加入自选失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseSheet :show="show" max-height="72vh" @update:show="emit('update:show', $event)">
    <div class="wa-head">
      <span class="wa-title">加入分组</span>
      <span v-if="name" class="wa-sub">{{ name }}</span>
    </div>

    <p class="wa-tip">选择要加入的分组，可多选。</p>

    <div v-if="loading" class="wa-empty">加载中…</div>
    <div v-else-if="!list.length" class="wa-empty">还没有分组</div>
    <div v-else class="wa-list">
      <button
        v-for="g in list"
        :key="g.id"
        class="wa-row"
        :class="{ on: picked.includes(g.id), locked: existing.includes(g.id) }"
        @click="toggle(g.id)"
      >
        <span class="wa-check">
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path
              d="M4 12.5l5 5L20 6.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="wa-name">{{ g.name }}</span>
        <span v-if="existing.includes(g.id)" class="wa-tag">已加入</span>
      </button>
    </div>

    <p v-if="error" class="wa-error">{{ error }}</p>

    <button class="wa-submit" :disabled="!canSubmit || busy" @click="submit">
      {{ busy ? '提交中…' : canSubmit ? '确认加入' : '请选择分组' }}
    </button>
  </BaseSheet>
</template>

<style scoped>
.wa-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0 4px;
}
.wa-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text);
}
.wa-sub {
  font-size: 12px;
  color: var(--c-text-3);
}
.wa-tip {
  margin: 0 0 10px;
  font-size: 11px;
  color: var(--c-text-3);
}
.wa-empty {
  padding: 18px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-text-3);
}
.wa-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wa-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--c-line);
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 14px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.wa-row.on {
  border-color: rgba(232, 56, 61, 0.5);
  background: rgba(232, 56, 61, 0.1);
  color: var(--c-text);
}
.wa-row.locked {
  cursor: default;
  opacity: 0.72;
}
.wa-check {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid var(--c-line-strong);
  color: transparent;
}
.wa-row.on .wa-check {
  border-color: transparent;
  background: var(--c-brand);
  color: #fff;
}
.wa-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-tag {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--c-text-3);
  border: 1px solid var(--c-line);
  border-radius: 6px;
  padding: 1px 5px;
}
.wa-error {
  margin: 10px 0 0;
  font-size: 11px;
  color: #ff8b8d;
}
.wa-submit {
  width: 100%;
  margin-top: 14px;
  padding: 12px;
  border: 0;
  border-radius: 10px;
  background: var(--c-brand);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.wa-submit:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
