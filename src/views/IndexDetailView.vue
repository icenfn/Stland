<script setup lang="ts">
/**
 * 指数详情页（独立页面）。
 *
 * 与个股详情页结构对齐，但按指数的本质差异取值：
 *  · 没有委托簿 → 五档的位置放「成分涨跌家数分布」；
 *  · 没有换手率、涨跌停 → 指标网格换成振幅与成分数；
 *  · 不可交易 → 不摆买卖按钮，底栏只保留加自选；
 *  · 成分股是真正有用的下钻入口 → 单独成区，点一支直接进它自己的个股页。
 *
 * 拆成独立组件的意义：个股页那些「个股才有的字段」在这里不需要判空，
 * 指数页也不再把一堆无关条件分支塞进同一个模板。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useIntervalFn } from '@vueuse/core'
import { marketApi, watchApi } from '@/api'
import type { BarItem, IndexMember, IndexQuote, MinutePoint, StockMeta, WatchGroup } from '@/api/types'
import MiniChart from '@/components/MiniChart.vue'
import { fmtAmount, fmtPct, fmtPrice, fmtVolume, trendClass } from '@/utils/format'

const route = useRoute()
const router = useRouter()

const code = computed(() => String(route.params.code ?? ''))
const quote = ref<IndexQuote | null>(null)
const meta = ref<StockMeta | null>(null)
const members = ref<IndexMember[]>([])
const minutes = ref<MinutePoint[]>([])
const bars = ref<BarItem[]>([])
const loading = ref(true)
const error = ref('')

const mode = ref<'minute' | 'kline'>('minute')
const period = ref('5min')
const sub = ref<'volume' | 'macd' | 'ratio'>('macd')

const groups = ref<WatchGroup[]>([])
const watching = ref(false)
const watchBusy = ref(false)
const watchSheet = ref(false)
const newGroupName = ref('')
const watchError = ref('')

/** 成分排序：涨跌幅从高到低，涨幅榜在最前，符合看指数的习惯 */
const sortedMembers = computed(() =>
  [...members.value].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0)),
)

const distribution = computed(() => {
  const q = quote.value
  const up = q?.up ?? 0
  const down = q?.down ?? 0
  const flat = q?.flat ?? 0
  const total = Math.max(1, up + down + flat)
  return {
    up,
    down,
    flat,
    total,
    upPct: (up / total) * 100,
    flatPct: (flat / total) * 100,
    downPct: (down / total) * 100,
  }
})

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
    {
      k: '振幅',
      v: q.prev_close ? `${(((q.high - q.low) / q.prev_close) * 100).toFixed(2)}%` : '—',
    },
    { k: '成分', v: `${q.members ?? 0} 家` },
  ]
})

async function loadQuote() {
  try {
    const res = await marketApi.indexDetail(code.value)
    quote.value = res.quote
    meta.value = res.meta
    members.value = res.members ?? []
    error.value = ''
  } catch (e: any) {
    error.value = e?.message ?? '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadChart() {
  try {
    if (mode.value === 'minute') {
      const res = await marketApi.indexMinutes(code.value, 240)
      minutes.value = res.items
    } else {
      const res = await marketApi.indexKline(code.value, period.value, 120)
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
    /* 保持原状 */
  } finally {
    watchBusy.value = false
  }
}

function onWatchTap() {
  if (watching.value) void removeWatch()
  else void openWatchPicker()
}

function openMember(m: IndexMember) {
  router.push(`/stock/${m.code}`)
}

const { pause, resume } = useIntervalFn(
  () => {
    if (document.visibilityState === 'visible') {
      void loadQuote()
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
  void loadChart()
  void loadWatch()
})

onMounted(async () => {
  await Promise.all([loadQuote(), loadChart(), loadWatch()])
  resume()
})
onBeforeUnmount(pause)
</script>

<template>
  <div class="page detail-page">
    <header class="topbar">
      <button class="back" aria-label="返回" @click="router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="tname ellipsis">{{ quote?.name ?? meta?.name ?? '指数' }}</div>
      <div class="tcode">{{ code }}</div>
    </header>

    <div v-if="error" class="empty">{{ error }}</div>
    <div v-else-if="loading" class="empty">加载中…</div>

    <template v-else-if="quote">
      <section class="head">
        <div class="price-line" :class="trendClass(quote.change)">
          <span class="price tabular">{{ fmtPrice(quote.price) }}</span>
          <span class="chg tabular">
            {{ quote.change >= 0 ? '+' : '' }}{{ fmtPrice(quote.change) }}
            <em>{{ fmtPct(quote.change_pct) }}</em>
          </span>
        </div>
        <div class="tags">
          <span class="tg">指数</span>
          <span class="tg">{{ quote.members }} 只成分</span>
        </div>
      </section>

      <section class="grid">
        <div v-for="r in statRows" :key="r.k" class="cell">
          <span class="ck">{{ r.k }}</span>
          <span class="cv tabular" :class="r.cls">{{ r.v }}</span>
        </div>
      </section>

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

      <!-- 涨跌家数分布：替代个股页的五档位置，保持两页纵向节奏一致 -->
      <section class="dist">
        <div class="dist-head">成分涨跌分布</div>
        <div class="dist-nums">
          <div class="dn up">
            <b class="tabular">{{ distribution.up }}</b>
            <span>上涨</span>
          </div>
          <div class="dn flat">
            <b class="tabular">{{ distribution.flat }}</b>
            <span>平盘</span>
          </div>
          <div class="dn down">
            <b class="tabular">{{ distribution.down }}</b>
            <span>下跌</span>
          </div>
        </div>
        <div class="dist-bar">
          <i class="b-up" :style="{ width: `${distribution.upPct}%` }" />
          <i class="b-flat" :style="{ width: `${distribution.flatPct}%` }" />
          <i class="b-down" :style="{ width: `${distribution.downPct}%` }" />
        </div>
      </section>

      <!-- 成分股：点一支进它自己的个股页 -->
      <section class="members">
        <div class="mhead">
          <span>成分股</span>
          <span class="mhint">按涨跌幅排序</span>
        </div>
        <div class="mrow" v-for="m in sortedMembers" :key="m.code" @click="openMember(m)">
          <div class="mname">
            <span class="mnm">{{ m.name }}</span>
            <span class="mcd">{{ m.code }}</span>
          </div>
          <span class="mp tabular" :class="trendClass(m.change_pct ?? 0)">
            {{ m.price != null ? fmtPrice(m.price) : '—' }}
          </span>
          <span class="mc tabular" :class="trendClass(m.change_pct ?? 0)">{{ fmtPct(m.change_pct ?? 0) }}</span>
        </div>
      </section>
    </template>

    <!-- 指数不可交易：底栏只保留加自选 -->
    <nav class="actionbar">
      <button class="act watch wide" :class="{ on: watching }" :disabled="watchBusy" @click="onWatchTap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" />
        </svg>
        <span>{{ watching ? '取消自选' : '加自选' }}</span>
      </button>
    </nav>

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
  </div>
</template>

<style scoped>
.detail-page {
  padding-bottom: calc(62px + var(--safe-bottom));
}

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

.chart-wrap {
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

.dist {
  margin-top: 8px;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--c-line);
}
.dist-head {
  font-size: 11px;
  color: var(--c-text-3);
  margin-bottom: 8px;
}
.dist-nums {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}
.dn {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 10px;
  color: var(--c-text-3);
}
.dn b {
  font-size: 18px;
  font-weight: 700;
}
.dn.up b {
  color: var(--c-up);
}
.dn.down b {
  color: var(--c-down);
}
.dn.flat b {
  color: var(--c-text-2);
}
.dist-bar {
  display: flex;
  height: 7px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--c-line);
}
.dist-bar i {
  display: block;
  height: 100%;
}
.b-up {
  background: var(--c-up);
}
.b-flat {
  background: var(--c-flat);
}
.b-down {
  background: var(--c-down);
}

.members {
  margin-top: 8px;
  border-top: 1px solid var(--c-line);
}
.mhead {
  display: flex;
  justify-content: space-between;
  padding: 9px 14px 6px;
  font-size: 11px;
  color: var(--c-text-3);
}
.mrow {
  display: flex;
  align-items: center;
  padding: 9px 14px;
  border-top: 1px solid var(--c-line);
  cursor: pointer;
}
.mname {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mnm {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcd {
  font-size: 10px;
  color: var(--c-text-3);
}
.mp {
  flex: 0 0 70px;
  text-align: right;
  font-size: 13px;
  font-weight: 600;
}
.mc {
  flex: 0 0 76px;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
}

.actionbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  padding: 8px 12px calc(8px + var(--safe-bottom));
  background: var(--c-bg-elevated);
  border-top: 1px solid var(--c-line);
}
.act.watch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 40px;
  background: var(--c-card);
  border: 1px solid var(--c-line-strong);
  border-radius: 10px;
  color: var(--c-text-2);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.act.watch svg {
  width: 18px;
  height: 18px;
}
.act.watch.on {
  color: #e8b339;
  border-color: rgba(232, 179, 57, 0.45);
}

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
