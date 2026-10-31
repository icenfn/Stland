<script setup lang="ts">
/**
 * 自选股：按分组管理，一屏看到全部自选的最新涨跌。
 *
 * 信息架构（本版调整）：
 *  · 顶部分组条只做「切换」—— 原来把「＋ 分组」的输入框塞在横向滚动条里，
 *    点开一个输入框会把后面的分组挤出屏幕，而且新建、删除这种低频且需要确认的操作
 *    挤在行情列表的顶部，误触成本很高；
 *  · 新建 / 重命名 / 删除统一收进「分组管理」弹窗：一屏看清所有分组和各自股票数，
 *    重命名就地编辑，删除有明确提示（股票不会被删，回到默认分组）；
 *  · 列表项直接展示服务端拼好的实时行情（价格/涨跌/成交额），
 *    不在客户端按代码逐个拉详情 —— 移动端 N+1 请求会让首屏明显卡顿；
 *  · 行内右侧「×」移出自选；空态给出「去行情挑一只」的出口。
 *
 * 分组的语义（与服务端一致）：一支股票只属于一个分组；把它加到别的分组
 * 等于「移动」；删除分组不会删股票，成分会回到默认分组。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { watchApi } from '@/api'
import type { WatchGroup, WatchItem } from '@/api/types'
import { fmtAmount, fmtPct, fmtPrice, trendClass } from '@/utils/format'
import BaseSheet from '@/components/BaseSheet.vue'

const router = useRouter()

const groups = ref<WatchGroup[]>([])
const activeId = ref<number>(0)
const items = ref<WatchItem[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref(false)

/** 分组管理弹窗 */
const manageOpen = ref(false)
const newName = ref('')
/** 正在重命名的分组 id（就地编辑），0 表示没有 */
const editingId = ref<number>(0)
const editName = ref('')

const activeGroup = computed(() => groups.value.find((g) => g.id === activeId.value) ?? null)
/** 至少要留一个分组，最后一个不允许删 */
const canDelete = computed(() => groups.value.length > 1)

async function loadGroups() {
  const res = await watchApi.groups()
  groups.value = res.items
  if (!groups.value.some((g) => g.id === activeId.value)) {
    activeId.value = groups.value[0]?.id ?? 0
  }
}

async function loadItems() {
  loading.value = true
  error.value = ''
  try {
    const res = await watchApi.items(activeId.value || undefined)
    items.value = res.items
    // 分组内数量可能变化，顺手刷新分组条上的计数
    const g = groups.value.find((x) => x.id === activeId.value)
    if (g) g.count = res.total
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
    items.value = []
  } finally {
    loading.value = false
  }
}

async function refresh() {
  try {
    await loadGroups()
    await loadItems()
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  }
}

async function switchGroup(id: number) {
  if (activeId.value === id) return
  activeId.value = id
  await loadItems()
}

function openManage() {
  editingId.value = 0
  editName.value = ''
  newName.value = ''
  manageOpen.value = true
}

async function createGroup() {
  const name = newName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const res = await watchApi.createGroup(name)
    newName.value = ''
    await loadGroups()
    // 新建后直接切过去：用户的下一步必然是往里加股票
    activeId.value = res.group.id
    await loadItems()
  } catch (e: any) {
    error.value = e?.message ?? '新建分组失败'
  } finally {
    busy.value = false
  }
}

function startRename(g: WatchGroup) {
  editingId.value = g.id
  editName.value = g.name
}

function cancelRename() {
  editingId.value = 0
  editName.value = ''
}

async function commitRename() {
  const id = editingId.value
  const name = editName.value.trim()
  if (!id || !name || busy.value) return
  const target = groups.value.find((g) => g.id === id)
  // 没改名就直接收起，不必打一次空请求
  if (target && target.name === name) return cancelRename()
  busy.value = true
  try {
    await watchApi.renameGroup(id, name)
    cancelRename()
    await loadGroups()
  } catch (e: any) {
    error.value = e?.message ?? '重命名失败'
  } finally {
    busy.value = false
  }
}

async function removeGroup(g: WatchGroup) {
  if (!canDelete.value || busy.value) return
  busy.value = true
  try {
    await watchApi.deleteGroup(g.id)
    // 删的正好是当前分组，回到默认分组
    if (activeId.value === g.id) activeId.value = 0
    await refresh()
  } catch (e: any) {
    error.value = e?.message ?? '删除分组失败'
  } finally {
    busy.value = false
  }
}

async function removeItem(code: string) {
  if (busy.value) return
  busy.value = true
  try {
    await watchApi.remove(code)
    items.value = items.value.filter((i) => i.code !== code)
    const g = groups.value.find((x) => x.id === activeId.value)
    if (g && g.count > 0) g.count -= 1
  } catch (e: any) {
    error.value = e?.message ?? '移出自选失败'
  } finally {
    busy.value = false
  }
}

function openDetail(item: WatchItem) {
  router.push(`/stock/${item.code}`)
}

/** 去行情面板挑股票（/market 已是首页里的面板，不再跳整页） */
function goMarket() {
  router.push('/market')
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <!-- 本页不再自带标题栏：页名由外壳顶栏统一显示，
         刷新由行情推送自动完成，分组管理收进分组条末尾的「＋」，三个按钮一并撤掉 -->

    <!-- 分组条：只做切换 -->
    <div class="group-bar" data-hscroll>
      <button
        v-for="g in groups"
        :key="g.id"
        class="gchip"
        :class="{ on: g.id === activeId }"
        @click="switchGroup(g.id)"
      >
        {{ g.name }}<span class="gcount">{{ g.count }}</span>
      </button>
      <!-- 分组管理：用铅笔表示「编辑」，比「＋」更贴近它的真实作用
           （点开是管理已有分组，包括重命名与删除，不只是新增） -->
      <button class="gchip add" aria-label="分组管理" @click="openManage">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3z" />
          <path d="M14.5 6.5l3 3" />
        </svg>
      </button>
    </div>

    <div v-if="error" class="empty">{{ error }}</div>
    <div v-else-if="loading && !items.length" class="empty">加载中…</div>
    <div v-else-if="!items.length" class="empty-box">
      <div class="empty-title">这个分组还没有自选</div>
      <p class="text-xs">在个股详情页点「加自选」，它就会出现在这里。</p>
      <button class="btn btn-ghost" @click="goMarket">去行情挑一只</button>
    </div>

    <div v-else class="wlist">
      <!-- 表头 -->
      <div class="wrow whead">
        <span class="wname">名称 / 代码</span>
        <span class="wprice">最新价</span>
        <span class="wchg">涨跌幅</span>
        <span class="wop" />
      </div>
      <div v-for="it in items" :key="it.code" class="wrow" @click="openDetail(it)">
        <div class="wname">
          <div class="wn-title">{{ it.name }}</div>
          <div class="wn-sub">
            {{ it.code }}
            <span v-if="it.industry" class="wn-ind">{{ it.industry }}</span>
          </div>
        </div>
        <div class="wprice tabular" :class="trendClass(it.change_pct)">
          {{ fmtPrice(it.price) }}
          <span class="wamount">{{ fmtAmount(it.amount) }}</span>
        </div>
        <div class="wchg tabular chg-pill" :class="trendClass(it.change_pct)">
          {{ fmtPct(it.change_pct) }}
        </div>
        <button class="wop" :disabled="busy" @click.stop="removeItem(it.code)">×</button>
      </div>
    </div>

    <!-- 分组管理：走共用底部抽屉，手势下滑即可关闭，外壳与下单抽屉保持一致 -->
    <BaseSheet v-model:show="manageOpen" max-height="80vh">
      <div class="m-head">
        <span class="m-title">分组管理</span>
        <button class="m-close" aria-label="关闭" @click="manageOpen = false">✕</button>
      </div>
      <p class="m-tip">删除分组不会删除其中的股票，它们会回到默认分组。</p>

      <div class="m-list">
        <div v-for="g in groups" :key="g.id" class="m-row">
          <template v-if="editingId === g.id">
            <input
              v-model="editName"
              class="m-input"
              maxlength="12"
              placeholder="分组名"
              @keyup.enter="commitRename"
            />
            <button class="m-ok" :disabled="busy" @click="commitRename">保存</button>
            <button class="m-cancel" @click="cancelRename">取消</button>
          </template>
          <template v-else>
            <span class="m-name">{{ g.name }}</span>
            <span class="m-count">{{ g.count }} 只</span>
            <button class="m-act" :disabled="busy" @click="startRename(g)">重命名</button>
            <button
              v-if="canDelete"
              class="m-act danger"
              :disabled="busy"
              @click="removeGroup(g)"
            >
              删除
            </button>
          </template>
        </div>
      </div>

      <div class="m-new">
        <input
          v-model="newName"
          class="m-input grow"
          maxlength="12"
          placeholder="新分组名称"
          @keyup.enter="createGroup"
        />
        <button class="btn btn-primary m-add" :disabled="busy || !newName.trim()" @click="createGroup">
          新建
        </button>
      </div>
    </BaseSheet>
  </div>
</template>

<style scoped>
.self-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 0;
}
.self-title {
  font-size: 15px;
  font-weight: 700;
}
.mini-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 5px 10px;
  cursor: pointer;
  margin-left: 6px;
}
.group-bar {
  display: flex;
  gap: 8px;
  padding: 8px 14px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.group-bar::-webkit-scrollbar {
  display: none;
}
.gchip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: 999px;
  color: var(--c-text-2);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.gchip.on {
  color: var(--c-brand);
  border-color: rgba(232, 56, 61, 0.45);
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}
.gchip.add {
  color: var(--c-text-3);
  border-style: dashed;
  padding: 6px 11px;
}
.gcount {
  font-size: 10px;
  opacity: 0.7;
}
.wlist {
  margin-top: 2px;
}
.wrow {
  display: flex;
  align-items: center;
  padding: 11px 14px;
  border-top: 1px solid var(--c-line);
  background: var(--c-card);
  cursor: pointer;
}
.whead {
  border-top: none;
  background: transparent;
  font-size: 10px;
  color: var(--c-text-3);
  padding: 6px 14px;
  cursor: default;
}
.wname {
  flex: 1;
  min-width: 0;
}
.whead .wname,
.whead .wprice,
.whead .wchg {
  font-size: 10px;
}
.wn-title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wn-sub {
  font-size: 10px;
  color: var(--c-text-3);
  margin-top: 2px;
  display: flex;
  gap: 6px;
}
.wn-ind {
  color: var(--c-text-2);
}
.wprice {
  flex: 0 0 74px;
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-weight: 600;
  font-size: 14px;
}
.wamount {
  font-size: 9px;
  color: var(--c-text-3);
  font-weight: 400;
}
.wchg {
  flex: 0 0 76px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}
.chg-pill {
  padding: 5px 0;
  border-radius: 7px;
  margin-left: 6px;
}
.chg-pill.up {
  background: rgba(232, 56, 61, 0.14);
}
.chg-pill.down {
  background: rgba(45, 176, 122, 0.14);
}
.wop {
  flex: 0 0 26px;
  text-align: right;
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.empty-box {
  margin: 40px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.empty-title {
  font-size: 14px;
  font-weight: 600;
}
.empty-box .btn {
  margin-top: 6px;
  font-size: 13px;
  padding: 9px 18px;
}

/* 分组管理弹窗 */
.m-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.m-title {
  font-size: 15px;
  font-weight: 700;
}
.m-close {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 14px;
  cursor: pointer;
}
.m-tip {
  font-size: 10px;
  color: var(--c-text-3);
  margin: 6px 0 10px;
  line-height: 1.6;
}
.m-list {
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.m-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--c-line);
  background: var(--c-card);
}
.m-row:last-child {
  border-bottom: none;
}
.m-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-count {
  font-size: 11px;
  color: var(--c-text-3);
}
.m-act {
  background: none;
  border: none;
  color: var(--c-brand);
  font-size: 12px;
  padding: 2px 4px;
  cursor: pointer;
}
.m-act.danger {
  color: #ff8b8d;
}
.m-act:disabled {
  opacity: 0.4;
  cursor: default;
}
.m-input {
  flex: 1;
  min-width: 0;
  background: var(--c-bg);
  border: 1px solid var(--c-line-strong);
  border-radius: 8px;
  color: var(--c-text);
  font-family: inherit;
  font-size: 14px;
  padding: 8px 10px;
  box-sizing: border-box;
}
.m-ok,
.m-cancel {
  background: none;
  border: none;
  font-size: 12px;
  cursor: pointer;
}
.m-ok {
  color: var(--c-brand);
  font-weight: 600;
}
.m-cancel {
  color: var(--c-text-3);
}
.m-new {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.m-input.grow {
  flex: 1;
}
.m-add {
  flex: 0 0 auto;
  font-size: 13px;
  padding: 9px 18px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
