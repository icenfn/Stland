<script setup lang="ts">
/**
 * 自选股：按分组管理，一屏看到全部自选的最新涨跌。
 *
 * 信息架构：
 *  · 顶部分组条横向滚动，「+」新建分组，长按/删除按钮移除当前分组；
 *  · 列表项直接展示服务端拼好的实时行情（价格/涨跌/成交额），
 *    不在客户端按代码逐个拉详情 —— 移动端 N+1 请求会让首屏明显卡顿；
 *  · 行内右侧「×」移出自选，左滑不是必需的，先给显式按钮更稳；
 *  · 空态给出「去行情挑一只」的出口，而不是一句干瘪的「暂无数据」。
 *
 * 分组的语义（与服务端一致）：一支股票只属于一个分组；把它加到别的分组
 * 等于「移动」；删除分组不会删股票，成分会回到默认分组。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { watchApi } from '@/api'
import type { WatchGroup, WatchItem } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtPct, fmtPrice, trendClass } from '@/utils/format'

const router = useRouter()

const groups = ref<WatchGroup[]>([])
const activeId = ref<number>(0)
const items = ref<WatchItem[]>([])
const loading = ref(false)
const error = ref('')
const creating = ref(false)
const newName = ref('')
const busy = ref(false)

const activeGroup = computed(() => groups.value.find((g) => g.id === activeId.value) ?? null)
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

async function createGroup() {
  const name = newName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    const res = await watchApi.createGroup(name)
    newName.value = ''
    creating.value = false
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

async function removeGroup() {
  const g = activeGroup.value
  if (!g || !canDelete.value || busy.value) return
  busy.value = true
  try {
    await watchApi.deleteGroup(g.id)
    activeId.value = 0
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

onMounted(refresh)
</script>

<template>
  <div class="page">
    <AppBar title="自选股">
      <template #actions>
        <button class="mini-btn" @click="refresh">刷新</button>
      </template>
    </AppBar>

    <!-- 分组条 -->
    <div class="group-bar">
      <button
        v-for="g in groups"
        :key="g.id"
        class="gchip"
        :class="{ on: g.id === activeId }"
        @click="switchGroup(g.id)"
      >
        {{ g.name }}<span class="gcount">{{ g.count }}</span>
      </button>
      <button v-if="!creating" class="gchip add" @click="creating = true">＋ 分组</button>
      <div v-else class="gnew">
        <input
          v-model="newName"
          class="ginput"
          maxlength="12"
          placeholder="分组名"
          @keyup.enter="createGroup"
        />
        <button class="gok" :disabled="busy" @click="createGroup">建</button>
        <button class="gcancel" @click="creating = false">取消</button>
      </div>
    </div>

    <div v-if="activeGroup" class="group-meta">
      <span class="text-xs">{{ activeGroup.name }} · {{ items.length }} 只</span>
      <button v-if="canDelete" class="del-group" :disabled="busy" @click="removeGroup">删除分组</button>
    </div>

    <div v-if="error" class="empty">{{ error }}</div>
    <div v-else-if="loading && !items.length" class="empty">加载中…</div>
    <div v-else-if="!items.length" class="empty-box">
      <div class="empty-title">这个分组还没有自选</div>
      <p class="text-xs">在个股详情页点「加为自选」，它就会出现在这里。</p>
      <button class="btn btn-ghost" @click="router.push('/market')">去行情挑一只</button>
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
  </div>
</template>

<style scoped>
.mini-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 5px 10px;
  cursor: pointer;
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
}
.gcount {
  font-size: 10px;
  opacity: 0.7;
}
.gnew {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: 0 0 auto;
}
.ginput {
  width: 96px;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line-strong);
  border-radius: 8px;
  color: var(--c-text);
  font-size: 12px;
  padding: 6px 8px;
}
.gok,
.gcancel {
  background: none;
  border: none;
  font-size: 12px;
  padding: 4px 2px;
  cursor: pointer;
}
.gok {
  color: var(--c-brand);
  font-weight: 600;
}
.gcancel {
  color: var(--c-text-3);
}
.group-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 14px 8px;
}
.del-group {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 11px;
  cursor: pointer;
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
</style>
