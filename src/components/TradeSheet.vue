<script setup lang="ts">
/**
 * 下单底部抽屉。
 *
 * 本轮取向（按反馈调整）：
 *  · 抽屉里不再放「买入 / 卖出」切换 —— 买卖方向由用户在详情页按下哪个按钮决定，
 *    进抽屉后再切一次是重复输入，而且容易和底部按钮的颜色暗示打架。
 *    抽屉只呈现「我正在买 X」或「我正在卖 X」这一个确定事实。
 *  · 「限价 / 市价」改成「限价委托 / 市价委托」——「限价」两个字单独摆着看不出是
 *    委托方式还是价格输入方式，加上「委托」后缀语义才完整。
 *  · 显示可买（可卖）股数：用户下单前第一个要问的就是「我这笔钱能买多少」，
 *    让他自己拿现金除以价格口算是这个页面最不该省掉的一步。
 *  · 价格与数量都可用 ＋/－ 调整：手机键盘输数字既慢又容易点错，
 *    步进按钮才是移动端调参的主要方式，输入框用于精确覆盖。
 *
 * 返回键语义：抽屉打开时按系统返回键，应当「关闭抽屉」而不是「退出当前页面」。
 * 实现方式是在打开时往历史栈压一个同地址的哨兵状态，并在 popstate 时拦下。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { accountApi, marketApi, tradeApi } from '@/api'
import type { Quote, StockMeta, TradePreview } from '@/api/types'
import { fmtAmount, fmtMoney, fmtPrice } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    show: boolean
    code?: string
    side?: 'buy' | 'sell'
  }>(),
  { code: '', side: 'buy' },
)

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'submitted', payload: { code: string; side: 'buy' | 'sell' }): void
}>()

const code = ref('')
const side = ref<'buy' | 'sell'>('buy')
const price = ref('')
const quantity = ref('100')
const orderType = ref<'limit' | 'market'>('limit')
const quote = ref<Quote | null>(null)
const meta = ref<StockMeta | null>(null)
const preview = ref<TradePreview | null>(null)
/** 卖出方向的可卖股数：预览接口只给「可买」，卖出要自己查持仓 */
const sellable = ref<number | null>(null)
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')
const submitting = ref(false)

const lot = computed(() => meta.value?.lot_size ?? 100)
const isBuy = computed(() => side.value === 'buy')
const sideLabel = computed(() => (isBuy.value ? '买入' : '卖出'))
const tick = computed(() => meta.value?.tick_size ?? 0.01)

const quickQty = computed(() => {
  // 快捷比例：整仓、半仓、三分之一仓，比固定的 100/200/500 股更贴合真实下单习惯
  const max = maxQuantity.value
  if (!max) return [1, 2, 3, 5, 10].map((n) => n * lot.value)
  const out = [max, Math.floor(max / 2 / lot.value) * lot.value, Math.floor(max / 3 / lot.value) * lot.value]
  return [...new Set(out.filter((n) => n > 0))].slice(0, 3)
})

const estimateAmount = computed(() => {
  const p = orderType.value === 'market' ? Number(quote.value?.price ?? 0) : Number(price.value || 0)
  return p * Number(quantity.value || 0)
})

/** 可买（可卖）股数：买入看资金的整手上限，卖出看可用持仓 */
const maxQuantity = computed(() => {
  if (isBuy.value) return preview.value?.max_buy_quantity ?? 0
  return sellable.value ?? 0
})

/** 是否已经压入了返回键哨兵状态 */
let guardPushed = false

function guardOn() {
  if (guardPushed || typeof window === 'undefined') return
  window.history.pushState({ stlandSheet: true }, '')
  guardPushed = true
  window.addEventListener('popstate', onPopState)
}

function guardOff() {
  window.removeEventListener('popstate', onPopState)
  guardPushed = false
}

/** 系统返回键 / 手势返回：拦下路由回退，只关抽屉 */
function onPopState() {
  guardPushed = false
  window.removeEventListener('popstate', onPopState)
  if (props.show) emit('update:show', false)
}

/** 主动关闭：先把哨兵状态退掉，再通知父组件收起 */
function close() {
  if (guardPushed) {
    window.history.back()
    return
  }
  emit('update:show', false)
}

async function loadSymbol() {
  if (!code.value) return
  try {
    const res = await marketApi.detail(code.value)
    quote.value = res.quote
    meta.value = res.meta
    if (!price.value) price.value = res.quote.price.toFixed(2)
  } catch (e: any) {
    message.value = e?.message ?? '标的不存在'
    messageType.value = 'err'
  }
  if (!isBuy.value) await loadSellable()
}

async function loadSellable() {
  try {
    const res = await accountApi.positions()
    const p = res.items.find((x) => x.code === code.value)
    sellable.value = p?.available ?? 0
  } catch {
    sellable.value = null
  }
}

async function refreshPreview() {
  const qty = Number(quantity.value)
  if (!code.value || !qty) {
    preview.value = null
    return
  }
  try {
    preview.value = await tradeApi.preview({
      code: code.value,
      side: side.value,
      quantity: qty,
      price: orderType.value === 'limit' ? Number(price.value) : undefined,
    })
  } catch {
    preview.value = null
  }
}

/** 价格步进：按最小变动价位调整，市价委托下不允许改价 */
function stepPrice(delta: number) {
  if (orderType.value === 'market') return
  const next = Math.max(tick.value, Number(price.value || 0) + delta * tick.value)
  price.value = next.toFixed(2)
}

/** 数量步进：按整手增减，下限约束在 1 手，上限不超过可买（可卖） */
function stepQty(delta: number) {
  const cur = Number(quantity.value || 0)
  let next = cur + delta * lot.value
  if (next < lot.value) next = lot.value
  const cap = maxQuantity.value
  if (cap > 0 && next > cap) next = Math.floor(cap / lot.value) * lot.value || lot.value
  quantity.value = String(next)
}

/** 一键填满可买（可卖）股数 */
function fillMax() {
  const cap = maxQuantity.value
  if (cap <= 0) return
  quantity.value = String(Math.floor(cap / lot.value) * lot.value)
}

function setMessage(text: string, type: 'ok' | 'err') {
  message.value = text
  messageType.value = type
}

async function submit() {
  message.value = ''
  const qty = Number(quantity.value)
  if (!qty || qty <= 0) return setMessage('请输入委托数量', 'err')
  if (qty % lot.value !== 0) return setMessage(`数量需为 ${lot.value} 股的整数倍`, 'err')
  if (orderType.value === 'limit' && !(Number(price.value) > 0)) return setMessage('请输入委托价格', 'err')
  if (isBuy.value && maxQuantity.value > 0 && qty > maxQuantity.value) {
    return setMessage(`可买仅 ${maxQuantity.value} 股`, 'err')
  }
  if (!isBuy.value && sellable.value !== null && qty > sellable.value) {
    return setMessage(`可卖仅 ${sellable.value} 股`, 'err')
  }
  submitting.value = true
  try {
    const res = await tradeApi.order({
      code: code.value,
      side: side.value,
      quantity: qty,
      price: orderType.value === 'limit' ? Number(price.value) : undefined,
      order_type: orderType.value,
    })
    const o = res.order
    if (o.status === 'filled') {
      setMessage(`已全部成交：均价 ${fmtPrice(o.avg_fill_price, 4)}，费用 ${fmtPrice(o.fee)} 元`, 'ok')
    } else if (o.status === 'partial') {
      setMessage(`部分成交 ${o.filled_quantity}/${o.quantity} 股，余量继续挂单`, 'ok')
    } else {
      setMessage('委托已受理，价格到达后会成交，可在「交易」页查看', 'ok')
    }
    emit('submitted', { code: code.value, side: side.value })
    await refreshPreview()
    if (!isBuy.value) await loadSellable()
  } catch (e: any) {
    setMessage(e?.message ?? '下单失败', 'err')
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.show,
  (v) => {
    if (!v) {
      guardOff()
      return
    }
    message.value = ''
    preview.value = null
    sellable.value = null
    code.value = props.code
    side.value = props.side
    price.value = ''
    quantity.value = '100'
    orderType.value = 'limit'
    guardOn()
    void loadSymbol().then(refreshPreview)
  },
)

watch([price, quantity, orderType, side], () => {
  if (props.show) void refreshPreview()
})

onBeforeUnmount(guardOff)
</script>

<template>
  <transition name="sheet">
    <div v-if="show" class="sheet-mask" @click.self="close">
      <div class="sheet">
        <div class="sheet-top">
          <span class="sheet-grab" />
          <button class="sheet-close" aria-label="关闭" @click="close">✕</button>
        </div>

        <!-- 方向标题：只陈述「正在买/卖什么」，不再提供切换 -->
        <div class="head">
          <span class="head-tag" :class="isBuy ? 'buy' : 'sell'">{{ sideLabel }}</span>
          <span class="head-name">{{ quote?.name ?? '—' }}</span>
          <span class="head-code">{{ code }}</span>
          <span class="head-price tabular" :class="(quote?.change ?? 0) >= 0 ? 'up' : 'down'">
            {{ fmtPrice(quote?.price ?? 0) }}
          </span>
        </div>

        <!-- 委托方式 -->
        <div class="seg-row">
          <button class="seg-btn" :class="{ on: orderType === 'limit' }" @click="orderType = 'limit'">
            限价委托
          </button>
          <button class="seg-btn" :class="{ on: orderType === 'market' }" @click="orderType = 'market'">
            市价委托
          </button>
        </div>

        <!-- 价格：－ 输入 ＋ -->
        <div class="field">
          <span class="flabel">价格</span>
          <button class="step" :disabled="orderType === 'market'" @click="stepPrice(-1)">－</button>
          <input
            v-model="price"
            class="finput tabular"
            type="number"
            inputmode="decimal"
            :disabled="orderType === 'market'"
            :placeholder="orderType === 'market' ? '按市价成交' : '0.00'"
          />
          <button class="step" :disabled="orderType === 'market'" @click="stepPrice(1)">＋</button>
        </div>

        <!-- 数量：－ 输入 ＋ -->
        <div class="field">
          <span class="flabel">数量</span>
          <button class="step" @click="stepQty(-1)">－</button>
          <input v-model="quantity" class="finput tabular" type="number" inputmode="numeric" placeholder="0" />
          <button class="step" @click="stepQty(1)">＋</button>
          <span class="unit">股</span>
        </div>

        <!-- 可买 / 可卖 + 快捷比例 -->
        <div class="cap-row">
          <span class="cap">
            {{ isBuy ? '可买' : '可卖' }}
            <b class="tabular">{{ maxQuantity || '—' }}</b> 股
          </span>
          <div class="qbtns">
            <button v-for="q in quickQty" :key="q" class="qbtn" @click="quantity = String(q)">
              {{ q }}
            </button>
            <button class="qbtn max" @click="fillMax">全部</button>
          </div>
        </div>

        <div class="preview">
          <div class="prow">
            <span>参考金额</span>
            <span class="tabular">{{ fmtAmount(preview?.amount ?? estimateAmount) }}</span>
          </div>
          <div class="prow">
            <span>预估均价 / 滑点</span>
            <span class="tabular">
              {{ fmtPrice(preview?.estimated_avg_price ?? quote?.price ?? 0, 3) }}
              <em class="muted"> · {{ (preview?.slippage_pct ?? 0).toFixed(3) }}%</em>
            </span>
          </div>
          <div class="prow">
            <span>预估费用</span>
            <span class="tabular">{{ fmtPrice(preview?.fee.total ?? 0) }} 元</span>
          </div>
          <div class="prow">
            <span>可用资金</span>
            <span class="tabular">{{ fmtMoney(preview?.available_cash ?? 0) }}</span>
          </div>
        </div>

        <p v-if="message" class="msg" :class="messageType">{{ message }}</p>

        <button class="btn btn-block" :class="isBuy ? 'btn-buy' : 'btn-sell'" :disabled="submitting" @click="submit">
          {{ submitting ? '提交中…' : `确认${sideLabel}` }}
        </button>
        <p class="tip">撮合按价格优先、时间优先逐档成交；未成交部分资金自动解冻。</p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 70;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: var(--c-bg-elevated);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  border-top: 1px solid var(--c-line);
  padding: 8px var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
}
.sheet-top {
  position: relative;
  height: 18px;
}
.sheet-grab {
  position: absolute;
  left: 50%;
  top: 4px;
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--c-line-strong);
  transform: translateX(-50%);
}
.sheet-close {
  position: absolute;
  right: -4px;
  top: -6px;
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--c-text-3);
  font-size: 13px;
  cursor: pointer;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0 4px;
  min-width: 0;
}
.head-tag {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  flex: 0 0 auto;
}
.head-tag.buy {
  color: #fff;
  background: linear-gradient(135deg, #ff5c5e, #d92b2f);
}
.head-tag.sell {
  color: #fff;
  background: linear-gradient(135deg, #1cc477, #0a8f52);
}
.head-name {
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head-code {
  font-size: 11px;
  color: var(--c-text-3);
  flex: 0 0 auto;
}
.head-price {
  margin-left: auto;
  font-size: 15px;
  font-weight: 700;
  flex: 0 0 auto;
}

.seg-row {
  display: flex;
  gap: 6px;
  margin-top: var(--sp-2);
}
.seg-btn {
  flex: 1;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 9px;
  color: var(--c-text-2);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 0;
  cursor: pointer;
}
.seg-btn.on {
  border-color: var(--c-brand);
  color: #ff8b8d;
  background: rgba(232, 56, 61, 0.12);
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 0;
  border-bottom: 1px solid var(--c-line);
  margin-top: var(--sp-2);
}
.flabel {
  flex: 0 0 34px;
  font-size: 12px;
  color: var(--c-text-2);
}
.finput {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--c-text);
  font-size: 19px;
  font-weight: 700;
  text-align: center;
}
.finput:disabled {
  color: var(--c-text-3);
}
.unit {
  font-size: 11px;
  color: var(--c-text-3);
  flex: 0 0 auto;
}
.step {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  color: var(--c-text);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.step:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cap-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: var(--sp-3) 0 var(--sp-2);
}
.cap {
  font-size: 11px;
  color: var(--c-text-3);
  flex: 0 0 auto;
}
.cap b {
  color: var(--c-text-2);
}
.qbtns {
  display: flex;
  gap: 6px;
  flex: 1;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.qbtn {
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
}
.qbtn.max {
  border-color: rgba(232, 56, 61, 0.5);
  color: #ff8b8d;
}

.preview {
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  margin-bottom: var(--sp-3);
}
.prow {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--c-text-2);
  padding: 3px 0;
}
.prow em {
  font-style: normal;
}

.msg {
  font-size: 12px;
  margin: 0 0 var(--sp-2);
  padding: 8px 10px;
  border-radius: 8px;
}
.msg.ok {
  color: #69e2a5;
  background: rgba(18, 183, 106, 0.12);
}
.msg.err {
  color: #ff8b8d;
  background: rgba(255, 77, 79, 0.12);
}
.tip {
  font-size: 10px;
  color: var(--c-text-3);
  margin: 8px 0 0;
  line-height: 1.6;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
