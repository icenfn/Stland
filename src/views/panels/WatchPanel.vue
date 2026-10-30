<script setup lang="ts">
/**
 * 自选股：按分组管理，一屏看到全部自选的最新涨跌。
 *
 * 本轮变化：
 *  · 新建分组从「分组条里就地长出一个输入框」改成弹窗。就地输入会把分组条挤得
 *    忽长忽短、相邻分组被推开，误触到别的分组；弹窗里输入才是「一次只做一件事」。
 *  · 分组支持重命名与删除，都走弹窗：破坏性操作要能看清「我正在删哪一个、里面有
 *    多少只」，就地一个「删除分组」文字按钮太轻，点了才知道后果。
 *  · 删除分组不再受「只剩一个就不能删」限制 —— 分组空了服务端会自动兜底到默认组。
 *
 * 分组的语义（与服务端一致）：一支股票只属于一个分组；把它加到别的分组等于「移动」；
 * 删除分组不会删股票，成分会回到默认分组。
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
const busy = ref(false)

/** 弹窗状态：create 新建 / rename 改名 / remove 删除 */
const dialog = ref<'' | 'create' | 'rename' | 'remove'>('')
const dialogName = ref('')
const dialogBusy = ref(false)
const dialogError = ref('')

const activeGroup = computed(() => groups.value.find((g) => g.id === activeId.value) ?? null)

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

function openDialog(kind: 'create' | 'rename' | 'remove') {
  dialog.value = kind
  dialogError.value = ''
  dialogName.value = kind === 'rename' ? (activeGroup.value?.name ?? '') : ''
}

function closeDialog() {
  if (dialogBusy.value) return
  dialog.value = ''
  dialogError.value = ''
}

async function submitDialog() {
  if (dialogBusy.value) return
  dialogError.value = ''

  if (dialog.value === 'remove') {
    const g = activeGroup.value
    if (!g) return
    dialogBusy.value = true
    try {
      await watchApi.deleteGroup(g.id)
      dialog.value = ''
      activeId.value = 0
      await refresh()
    } catch (e: any) {
      dialogError.value = e?.message ?? '删除分组失败'
    } finally {
      dialogBusy.value = false
    }
    return
  }

  const name = dialogName.value.trim()
  if (!name) {
    dialogError.value = '分组名称不能为空'
    return
  }
  if (name.length > 12) {
    dialogError.value = '分组名称最多 12 个字'
    return
  }

  dialogBusy.value = true
  try {
    if (dialog.value === 'create') {
      const res = await watchApi.createGroup(name)
      dialog.value = ''
      await loadGroups()
      // 新建后直接切过去：用户的下一步必然是往里加标的
      activeId.value = res.group.id
      await loadItems()
    } else if (dialog.value === 'rename') {
      const g = activeGroup.value
      if (!g) return
      await watchApi.renameGroup(g.id, name)
      dialog.value = ''
      await loadGroups()
    }
  } catch (e: any) {
    dialogError.value = e?.message ?? (dialog.value === 'create' ? '新建分组失败' : '重命名失败')
  } finally {
    dialogBusy.value = false
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

/** 指数与个股走不同详情页，按代码前缀分流 */
function openDetail(item: WatchItem) {
  const isIndex = item.code.startsWith('IDX') || item.board === 'index'
  router.push(isIndex ? `/index/${item.code}` : `/stock/${item.code}`)
}

onMounted(refresh)
</script>

<template>
  <div class="page">
    <AppBar title="自选股">
      <template #actions>
        <button class="icon-btn" aria-label="管理分组" @click="openDialog('rename')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </button>
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
      <button class="gchip add" @click="openDialog('create')">＋ 新建分组</button>
    </div>

    <div v-if="activeGroup" class="group-meta">
      <span class="text-xs">{{ activeGroup.name }} · {{ items.length }} 只</span>
      <button class="del-group" :disabled="busy" @click="openDialog('remove')">删除分组</button>
    </div>

    <div v-if="error" class="empty">{{ error }}</div>
    <div v-else-if="loading && !items.length" class="empty">加载中…</div>
    <div v-else-if="!items.length" class="empty-box">
      <div class="empty-title">这个分组还没有自选</div>
      <p class="text-xs">在个股或指数详情页点底栏的「加自选」，就能把它放进指定分组。</p>
      <button class="btn btn-ghost" @click="router.push('/market')">去行情挑一只</button>
    </div>

    <div v-else class="wlist">
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

    <!-- 分组弹窗：新建 / 改名 / 删除 -->
    <transition name="fade">
      <div v-if="dialog" class="mask" @click.self="closeDialog">
        <div class="modal">
          <h3 class="modal-title">
            {{ dialog === 'create' ? '新建分组' : dialog === 'rename' ? '重命名分组' : '删除分组' }}
          </h3>

          <template v-if="dialog === 'remove'">
            <p class="modal-text">
              确定删除分组「<b>{{ activeGroup?.name }}</b>」吗？<br />
              该分组下的 <b>{{ activeGroup?.count ?? 0 }}</b> 只自选会移回默认分组，不会被清空。
            </p>
          </template>

          <template v-else>
            <input
              v-model="dialogName"
              class="modal-input"
              maxlength="12"
              :placeholder="dialog === 'create' ? '例如：科技、红利、观察中' : '输入新的分组名'"
              @keyup.enter="submitDialog"
            />
            <p class="modal-hint">最多 12 个字</p>
          </template>

          <p v-if="dialogError" class="modal-err">{{ dialogError }}</p>

          <div class="modal-actions">
            <button class="mbtn" :disabled="dialogBusy" @click="closeDialog">取消</button>
            <button
              class="mbtn primary"
              :class="{ danger: dialog === 'remove' }"
              :disabled="dialogBusy"
              @click="submitDialog"
            >
              {{ dialogBusy ? '处理中…' : dialog === 'remove' ? '删除' : '确定' }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.icon-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--c-line);
  border-radius: 9px;
  color: var(--c-text-2);
  cursor: pointer;
  padding: 0;
}
.icon-btn svg {
  width: 16px;
  height: 16px;
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

/* ---------- 弹窗 ---------- */
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  padding: 24px;
}
.modal {
  width: 100%;
  max-width: 320px;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: var(--r-lg);
  padding: 18px 16px 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.modal-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 700;
}
.modal-text {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--c-text-2);
  line-height: 1.7;
}
.modal-text b {
  color: var(--c-text);
}
.modal-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--c-card);
  border: 1px solid var(--c-line-strong);
  border-radius: 10px;
  color: var(--c-text);
  font-size: 14px;
  padding: 10px 12px;
  outline: none;
}
.modal-input:focus {
  border-color: var(--c-brand);
}
.modal-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
}
.modal-err {
  margin: 8px 0 0;
  font-size: 12px;
  color: #ff8b8d;
}
.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.mbtn {
  flex: 1;
  padding: 10px 0;
  border-radius: 10px;
  border: 1px solid var(--c-line);
  background: var(--c-card);
  color: var(--c-text-2);
  font-size: 14px;
  cursor: pointer;
}
.mbtn.primary {
  background: var(--c-brand);
  border-color: var(--c-brand);
  color: #fff;
  font-weight: 600;
}
.mbtn.primary.danger {
  background: #d92b2f;
  border-color: #d92b2f;
}
.mbtn:disabled {
  opacity: 0.6;
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
