<script setup lang="ts">
/**
 * 个股详情页（独立页面）。
 *
 * 与指数详情页拆开的原因：两者共用一个组件时，模板里到处是「指数这样、个股那样」
 * 的条件分支，改个股一处样式就容易碰坏指数。拆成两页后每页只写自己那一条路径，
 * 结构相同但各自可独立演进。
 *
 * 版式要点（按反馈调整）：
 *  · 右上角不再放「加自选」—— 顶部是低频操作区，真正的操作应集中在触手可及的底栏；
 *  · 底栏固定在屏幕底部，里面放「加自选 / 买入 / 卖出」，单手可及；
 *  · 五档与 K 线不再套卡片、不留左右边距，图表直接贴边占满宽度 ——
 *    图表被卡片内边距挤窄是这版最明显的浪费；
 *  · 副图默认 MACD，可切成交量、量比；不再保留「无」——
 *    「无」等于让用户主动选择一块空白，副图区的价值就是常驻一条量价信息。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { marketApi, watchApi } from '@/api'
import type { BarItem, Depth, MinutePoint, Quote, StockMeta, WatchGroup } from '@/api/types'
import MiniChart from '@/components/MiniChart.vue'
import TradeSheet from '@/components/TradeSheet.vue'
import { fmtAmount, fmtPct, fmtPrice, fmtVolume, trendClass } from '@/utils/format'

const route = useRoute()
const router = useRouter()

const code = computed(() => String(route.params.code ?? ''))
const quote = ref<Quote | null>(null)
const meta = ref<StockMeta | null>(null)
const depth = ref<Depth | null>(null)
const minutes = ref<MinutePoint[]>([])
const bars = ref<BarItem[]>([])
const loading = ref(true)
const error = ref('')

const mode = ref<'minute' | 'kline'>('minute')
const period = ref('5min')
/** 副图固定有内容：默认 MACD，可切成交量、量比 */
const sub = ref<'volume' | 'macd' | 'ratio'>('macd')

const sheetShow = ref(false)
const sheetSide = ref<'buy' | 'sell'>('buy')

const watchSheet = ref(false)
const groups = ref<WatchGroup[]>([])
const watching = ref(false)
const watchBusy = ref(false)
const newGroupName = ref('')
const watchError = ref('')

const priceClass = computed(() => trendClass(quote.value?.change ?? 0))

const statRows = computed(() => {
  const q = quote.value
  if (!q) return []
  return [
    { k: '今开', v: fmtPrice(q.open), cls: trendClass(q.open - q.prev_close) },
    { k: '最高', v: fmtPrice(q.high), cls: trendClass(q.high - q.prev_close) },
    { k: '最低', v: fmtPrice(q.low), cls: trendClass(q.low - q.prev_close) },
    { k: '昨收', v: fmtPrice(q.prev_close) },
    { k: '成交量', v: fmtVolume(q.volume) },
    { k: '成交额', v: fmtAmount(q.amount) },
    { k: '换手率', v: `${(q.turnover_rate ?? 0).toFixed(2)}%` },
    { k: '量比', v: (q.volume_ratio ?? 0).toFixed(2), cls: (q.volume_ratio ?? 0) >= 1 ? 'up' : 'down' },
  ]
})

/** 五档：卖 5→卖 1 自上而下，买 1→买 5 紧随其后，与看盘软件的排列一致 */
const asksDesc = computed(() => [...(depth.value?.asks ?? [])].reverse())
const bidsList = computed(() => depth.value?.bids ?? [])
const maxDepthVol = computed(() => {
  const all = [...(depth.value?.asks ?? []), ...(depth.value?.bids ?? [])]
  return Math.max(1, ...all.map((d) => d.volume))
})

function fmtHands(v: number) {
  if (!v) return '—'
  if (v >= 10000) return `${(v / 10000).toFixed(2)}万`
  return String(Math.round(v))
}

async function loadQuote() {
  try {
    const res = await marketApi.detail(code.value)
    quote.value = res.quote
    meta.value = res.meta
    error.value = ''
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadDepth() {
  try {
    depth.value = await marketApi.depth(code.value)
  } catch {
    /* 盘口拿不到不影响价格与图表 */
  }
}

async function loadChart() {
  try {
    if (mode.value === 'minute') {
      const res = await marketApi.minutes(code.value, 240)
      minutes.value = res.items
    } else {
      const res = await marketApi.kline(code.value, period.value, 120)
      bars.value = res.items
    }
  } catch {
    /* 静默 */
  }
}

async function loadWatch() {
  try {
    const res = await watchApi.status(code.value)
    watching.value = res.watching
  } catch {
    watching.value = false
  }
}

/** 打开分组选择：加自选必须先选放哪个分组，而不是闷头塞进默认组 */
async function openWatchPicker() {
  watchError.value = ''
  watchSheet.value = true
  newGroupName.value = ''
  try {
    const res = await watchApi.groups()
    groups.value = res.items
  } catch (e: any) {
    watchError.value = e?.message ?? '分组加载失败'
  }
}

async function addToGroup(groupId: number) {
  if (watchBusy.value) return
  watchBusy.value = true
  watchError.value = ''
  try {
    await watchApi.add(code.value, groupId)
    watching.value = true
    watchSheet.value = false
  } catch (e: any) {
    watchError.value = e?.message ?? '加自选失败'
  } finally {
    watchBusy.value = false
  }
}

async function createGroupAndAdd() {
  const name = newGroupName.value.trim()
  if (!name) {
    watchError.value = '请输入分组名称'
    return
  }
  if (watchBusy.value) return
  watchBusy.value = true
  try {
    const res = await watchApi.createGroup(name)
    await watchApi.add(code.value, res.group.id)
    watching.value = true
    watchSheet.value = false
  } catch (e: any) {
    watchError.value = e?.message ?? '新建分组失败'
  } finally {
    watchBusy.value = false
  }
}

async function removeWatch() {
  if (watchBusy.value) return
  watchBusy.value = true
  try {
    await watchApi.remove(code.value)
    watching.value = false
  } catch {
    /* 保持原状，避免按钮与真实状态脱节 */
  } finally {
    watchBusy.value = false
  }
}

/** 底栏的加自选：已自选则直接取消，未自选则弹分组选择 */
function onWatchTap() {
  if (watching.value) void removeWatch()
  else void openWatchPicker()
}

function openTrade(side: 'buy' | 'sell') {
  sheetSide.value = side
  sheetShow.value = true
}

const { pause, resume } = useIntervalFn(
  () => {
    if (document.visibilityState === 'visible') {
      void loadQuote()
      void loadDepth()
      void loadChart()
    }
  },
  4000,
  { immediate: false },
)

watch([mode, period], () => void loadChart())
watch(code, () => {
  loading.value = true
  void loadQuote()
  void loadDepth()
  void loadChart()
  void loadWatch()
})

onMounted(async () => {
  await Promise.all([loadQuote(), loadDepth(), loadChart(), loadWatch()])
  resume()
})
onBeforeUnmount(pause)
</script>

<template>
  <div class="page detail-page">
    <!-- 顶栏：只有返回与标题，操作全部下沉到底栏 -->
    <header class="topbar">
      <button class="back" aria-label="返回" @click="router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="tname ellipsis">{{ quote?.name ?? meta?.name ?? '个股' }}</div>
      <div class="tcode">{{ code }}</div>
    </header>

    <div v-if="error" class="empty">{{ error }}</div>
    <div v-else-if="loading" class="empty">加载中…</div>

    <template v-else-if="quote">
      <!-- ① 价格头 -->
      <section class="head">
        <div class="price-line" :class="priceClass">
          <span class="price tabular">{{ fmtPrice(quote.price) }}</span>
          <span class="chg tabular">
            {{ quote.change >= 0 ? '+' : '' }}{{ fmtPrice(quote.change) }}
            <em>{{ fmtPct(quote.change_pct) }}</em>
          </span>
        </div>
        <div class="tags">
          <span v-if="meta?.board" class="tg">{{ meta.board }}</span>
          <span v-if="meta?.industry" class="tg">{{ meta.industry }}</span>
          <span v-if="meta?.is_st" class="tg warn">ST</span>
        </div>
      </section>

      <!-- ② 指标网格 -->
      <section class="grid">
        <div v-for="r in statRows" :key="r.k" class="cell">
          <span class="ck">{{ r.k }}</span>
          <span class="cv tabular" :class="r.cls">{{ r.v }}</span>
        </div>
      </section>

      <!-- ③ 图表区：不套卡片、贴边占满 -->
      <section class="chart-wrap">
        <div class="tabs">
          <button class="tab" :class="{ on: mode === 'minute' }" @click="mode = 'minute'">分时</button>
          <button
            v-for="p in ['5min', '15min', '30min', '60min']"
            :key="p"
            class="tab"
            :class="{ on: mode === 'kline' && period === p }"
            @click="((mode = 'kline'), (period = p))"
          >
            {{ p.replace('min', '分') }}
          </button>
          <button class="tab" :class="{ on: mode === 'kline' && period === 'day' }"
            @click="((mode = 'kline'), (period = 'day'))">
            日K
          </button>
        </div>
        <MiniChart :mode="mode" :minutes="minutes" :bars="bars" :sub="sub" :prev-close="quote.prev_close" />
        <div class="sub-tabs">
          <button class="stab" :class="{ on: sub === 'macd' }" @click="sub = 'macd'">MACD</button>
          <button class="stab" :class="{ on: sub === 'volume' }" @click="sub = 'volume'">成交量</button>
          <button class="stab" :class="{ on: sub === 'ratio' }" @click="sub = 'ratio'">量比</button>
        </div>
      </section>

      <!-- ④ 五档盘口：同样不套卡片、不留左右边距 -->
      <section class="depth-wrap">
        <div class="depth-head">
          <span>五档盘口</span>
          <span class="dh-r tabular">委比 {{ fmtPct(0) }}</span>
        </div>
        <div class="drow sell" v-for="(d, i) in asksDesc" :key="`a${i}`">
          <span class="dlabel">卖{{ 5 - i }}</span>
          <span class="dprice tabular up">{{ fmtPrice(d.price) }}</span>
          <span class="dvol tabular">{{ fmtHands(d.volume) }}</span>
          <span class="dbar"><i class="up-bar" :style="{ width: `${(d.volume / maxDepthVol) * 100}%` }" /></span>
        </div>
        <div class="dsep" />
        <div class="drow buy" v-for="(d, i) in bidsList" :key="`b${i}`">
          <span class="dlabel">买{{ i + 1 }}</span>
          <span class="dprice tabular down">{{ fmtPrice(d.price) }}</span>
          <span class="dvol tabular">{{ fmtHands(d.volume) }}</span>
          <span class="dbar"><i class="down-bar" :style="{ width: `${(d.volume / maxDepthVol) * 100}%` }" /></span>
        </div>
      </section>

      <!-- ⑤ 资料 -->
      <section class="info">
        <div class="irow">
          <span class="ik">涨停 / 跌停</span>
          <span class="iv tabular">
            <em class="up">{{ fmtPrice(quote.limit_up ?? 0) }}</em> /
            <em class="down">{{ fmtPrice(quote.limit_down ?? 0) }}</em>
          </span>
        </div>
        <div class="irow">
          <span class="ik">振幅</span>
          <span class="iv tabular">{{ (quote.amplitude ?? 0).toFixed(2) }}%</span>
        </div>
        <div v-if="meta?.theme" class="irow">
          <span class="ik">题材</span>
          <span class="iv">{{ meta.theme }}</span>
        </div>
        <p v-if="meta?.note" class="note">{{ meta.note }}</p>
      </section>
    </template>

    <!-- ⑥ 固定底栏：加自选 / 买入 / 卖出 -->
    <nav class="actionbar">
      <button class="act watch" :class="{ on: watching }" :disabled="watchBusy" @click="onWatchTap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" />
        </svg>
        <span>{{ watching ? '已自选' : '加自选' }}</span>
      </button>
      <button class="act-trade buy" @click="openTrade('buy')">买入</button>
      <button class="act-trade sell" @click="openTrade('sell')">卖出</button>
    </nav>

    <!-- 加自选：先选分组 -->
    <transition name="fade">
      <div v-if="watchSheet" class="mask" @click.self="watchSheet = false">
        <div class="modal">
          <h3 class="modal-title">添加到自选分组</h3>
          <div class="glist">
            <button
              v-for="g in groups"
              :key="g.id"
              class="gitem"
              :disabled="watchBusy"
              @click="addToGroup(g.id)"
            >
              <span class="gname">{{ g.name }}</span>
              <span class="gcnt">{{ g.count }} 只</span>
            </button>
          </div>
          <div class="newg">
            <input v-model="newGroupName" class="nginput" maxlength="12" placeholder="新建分组名" />
            <button class="ngbtn" :disabled="watchBusy" @click="createGroupAndAdd">建并加入</button>
          </div>
          <p v-if="watchError" class="werr">{{ watchError }}</p>
          <button class="mclose" @click="watchSheet = false">取消</button>
        </div>
      </div>
    </transition>

    <TradeSheet
      v-model:show="sheetShow"
      :code="code"
      :side="sheetSide"
      @submitted="() => { void loadQuote(); void loadDepth() }"
    />
  </div>
</template>

<style scoped>
.detail-page {
  /* 给固定底栏留位置，避免最后一段内容被遮住 */
  padding-bottom: calc(62px + var(--safe-bottom));
}

/* ---------- 顶栏 ---------- */
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: calc(var(--safe-top)) 12px 0;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-line);
}
.back {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: none;
  border: none;
  color: var(--c-text);
  padding: 0;
  cursor: pointer;
}
.back svg {
  width: 21px;
  height: 21px;
}
.tname {
  font-size: 15px;
  font-weight: 700;
}
.tcode {
  font-size: 11px;
  color: var(--c-text-3);
  margin-left: auto;
}

/* ---------- 价格头 ---------- */
.head {
  padding: 12px 14px 10px;
}
.price-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.price {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.5px;
  line-height: 1.1;
}
.chg {
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  gap: 6px;
}
.chg em {
  font-style: normal;
}
.tags {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.tg {
  font-size: 10px;
  color: var(--c-text-2);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--c-line);
  border-radius: 5px;
  padding: 2px 7px;
}
.tg.warn {
  color: #ffb347;
  border-color: rgba(255, 179, 71, 0.4);
}

/* ---------- 指标网格 ---------- */
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--c-line);
  border-top: 1px solid var(--c-line);
  border-bottom: 1px solid var(--c-line);
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 2px;
  background: var(--c-card);
}
.ck {
  font-size: 10px;
  color: var(--c-text-3);
}
.cv {
  font-size: 13px;
  font-weight: 600;
}

/* ---------- 图表：贴边 ---------- */
.chart-wrap {
  padding: 0;
  margin-top: 8px;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 12px;
  padding: 5px 9px;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
}
.tab.on {
  color: var(--c-text);
  background: rgba(255, 255, 255, 0.08);
  font-weight: 600;
}
.sub-tabs {
  display: flex;
  gap: 4px;
  padding: 4px 10px 8px;
  border-top: 1px solid var(--c-line);
}
.stab {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.stab.on {
  color: #e8b339;
  background: rgba(232, 179, 57, 0.12);
}

/* ---------- 五档 ---------- */
.depth-wrap {
  padding: 8px 0 10px;
  margin-top: 8px;
  border-top: 1px solid var(--c-line);
}
.depth-head {
  display: flex;
  justify-content: space-between;
  padding: 2px 14px 6px;
  font-size: 11px;
  color: var(--c-text-3);
}
.dh-r {
  color: var(--c-text-3);
}
.drow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  font-size: 12px;
}
.dlabel {
  flex: 0 0 30px;
  color: var(--c-text-3);
  font-size: 11px;
}
.dprice {
  flex: 0 0 60px;
  font-weight: 600;
}
.dvol {
  flex: 1;
  text-align: right;
  color: var(--c-text-2);
}
.dbar {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 1px;
  height: 2px;
  background: transparent;
  pointer-events: none;
}
.dbar i {
  display: block;
  height: 100%;
  opacity: 0.35;
}
.up-bar {
  background: var(--c-up);
  margin-left: auto;
}
.down-bar {
  background: var(--c-down);
}
.dsep {
  height: 1px;
  background: var(--c-line);
  margin: 4px 14px;
}

/* ---------- 资料 ---------- */
.info {
  margin-top: 8px;
  border-top: 1px solid var(--c-line);
  padding: 8px 14px 14px;
}
.irow {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--c-line);
}
.irow:last-child {
  border-bottom: none;
}
.ik {
  color: var(--c-text-3);
}
.iv em {
  font-style: normal;
}
.note {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--c-text-3);
  line-height: 1.7;
}

/* ---------- 固定底栏 ---------- */
.actionbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px calc(8px + var(--safe-bottom));
  background: var(--c-bg-elevated);
  border-top: 1px solid var(--c-line);
}
.act.watch {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 52px;
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 10px;
  padding: 2px 0;
  cursor: pointer;
}
.act.watch svg {
  width: 20px;
  height: 20px;
}
.act.watch.on {
  color: #e8b339;
}
.act-trade {
  flex: 1;
  height: 40px;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
}
.act-trade.buy {
  background: linear-gradient(135deg, #ff5c5e, #d92b2f);
}
.act-trade.sell {
  background: linear-gradient(135deg, #1cc477, #0a8f52);
}

/* ---------- 加自选分组弹窗 ---------- */
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
}
.modal {
  width: 100%;
  background: var(--c-bg-elevated);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  padding: 16px 16px calc(12px + var(--safe-bottom));
  border-top: 1px solid var(--c-line);
}
.modal-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 700;
}
.glist {
  max-height: 42vh;
  overflow-y: auto;
}
.gitem {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 10px;
  padding: 11px 12px;
  margin-bottom: 8px;
  color: var(--c-text);
  font-size: 13px;
  cursor: pointer;
}
.gname {
  font-weight: 600;
}
.gcnt {
  font-size: 11px;
  color: var(--c-text-3);
}
.newg {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.nginput {
  flex: 1;
  min-width: 0;
  background: var(--c-card);
  border: 1px solid var(--c-line-strong);
  border-radius: 10px;
  color: var(--c-text);
  font-size: 13px;
  padding: 10px 12px;
  outline: none;
}
.ngbtn {
  flex: 0 0 auto;
  background: var(--c-brand);
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  padding: 0 14px;
  cursor: pointer;
}
.werr {
  margin: 8px 0 0;
  font-size: 12px;
  color: #ff8b8d;
}
.mclose {
  width: 100%;
  margin-top: 10px;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 10px;
  color: var(--c-text-2);
  font-size: 14px;
  padding: 11px 0;
  cursor: pointer;
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
