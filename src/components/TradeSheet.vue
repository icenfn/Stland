<script setup lang="ts">
/**
 * 下单底部抽屉。
 *
 * 设计取向：抽屉只负责「填参数 + 提交」，不再重复展示标的名称、最新价、板块、
 * 涨跌幅 —— 这些信息用户在打开抽屉之前刚在榜单或详情页看过，抽屉里再抄一遍
 * 既占高度又容易与行情不同步（抽屉打开期间价格在跳动，静态文案反而误导）。
 * 因此顶部只保留一根拖动条和一个关闭按钮。
 *
 * 返回键语义：抽屉打开时按系统返回键，应当「关闭抽屉」而不是「退出当前页面」。
 * 实现方式是在打开时往历史栈压一个同地址的哨兵状态，并在 popstate 时拦下：
 *   · 返回键 → 历史回退 → 我们关闭抽屉（页面 URL 不变，用户仍停留在原页面）；
 *   · 点关闭按钮 / 点遮罩 → 我们主动 history.back()，让哨兵状态出栈，
 *     避免历史栈里残留无效状态、导致用户要按两次返回键才退页。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { marketApi, tradeApi } from '@/api'
import type { Quote, StockMeta, TradePreview } from '@/api/types'
import { fmtAmount, fmtPrice } from '@/utils/format'

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
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')
const submitting = ref(false)

const lot = computed(() => meta.value?.lot_size ?? 100)
const quickQty = computed(() => [1, 2, 3, 5, 10].map((n) => n * lot.value))
const estimateAmount = computed(() => Number(quote.value?.price ?? 0) * Number(quantity.value || 0))

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
    // 不先移除监听：由 history.back() 触发的 popstate 会负责关抽屉与解绑
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

function stepPrice(delta: number) {
  const tick = meta.value?.tick_size ?? 0.01
  const next = Math.max(tick, Number(price.value || 0) + delta * tick)
  price.value = next.toFixed(2)
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
      setMessage(`部分成交 ${o.filled_quantity}/${o.quantity} 股`, 'ok')
    } else {
      setMessage('委托已受理，可在「委托与成交」中查看', 'ok')
    }
    emit('submitted', { code: code.value, side: side.value })
    await refreshPreview()
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
    code.value = props.code
    side.value = props.side
    price.value = ''
    quantity.value = '100'
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

        <div class="side-switch">
          <button class="side-btn buy" :class="{ on: side === 'buy' }" @click="side = 'buy'">买入</button>
          <button class="side-btn sell" :class="{ on: side === 'sell' }" @click="side = 'sell'">卖出</button>
        </div>

        <div class="seg-row">
          <button class="seg-btn" :class="{ on: orderType === 'limit' }" @click="orderType = 'limit'">限价</button>
          <button class="seg-btn" :class="{ on: orderType === 'market' }" @click="orderType = 'market'">市价</button>
        </div>

        <div class="field">
          <span class="flabel">价格</span>
          <input v-model="price" class="finput tabular" type="number" inputmode="decimal"
            :disabled="orderType === 'market'" :placeholder="orderType === 'market' ? '市价成交' : '0.00'" />
          <div class="steppers">
            <button class="step" @click="stepPrice(-1)">－</button>
            <button class="step" @click="stepPrice(1)">＋</button>
          </div>
        </div>

        <div class="field">
          <span class="flabel">数量</span>
          <input v-model="quantity" class="finput tabular" type="number" inputmode="numeric" placeholder="0" />
          <span class="unit">股</span>
        </div>

        <div class="quick-qty">
          <button v-for="q in quickQty" :key="q" class="qbtn" @click="quantity = String(q)">{{ q }}</button>
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
            <span>可成交</span>
            <span class="tabular">{{ preview?.fillable_quantity ?? 0 }} 股</span>
          </div>
        </div>

        <p v-if="message" class="msg" :class="messageType">{{ message }}</p>

        <button class="btn btn-block" :class="side === 'buy' ? 'btn-buy' : 'btn-sell'" :disabled="submitting"
          @click="submit">
          {{ submitting ? '提交中…' : side === 'buy' ? '确认买入' : '确认卖出' }}
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

.side-switch {
  display: flex;
  gap: var(--sp-2);
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  padding: 4px;
  margin-top: var(--sp-2);
}
.side-btn {
  flex: 1;
  border: none;
  background: none;
  color: var(--c-text-2);
  font-size: 14px;
  font-weight: 700;
  padding: 9px 0;
  border-radius: 9px;
  cursor: pointer;
}
.side-btn.buy.on {
  background: linear-gradient(135deg, #ff5c5e, #d92b2f);
  color: #fff;
}
.side-btn.sell.on {
  background: linear-gradient(135deg, #1cc477, #0a8f52);
  color: #fff;
}

.seg-row {
  display: flex;
  gap: 6px;
  margin-top: var(--sp-3);
}
.seg-btn {
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 12px;
  padding: 6px 14px;
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
  gap: var(--sp-2);
  padding: 10px 0;
  border-bottom: 1px solid var(--c-line);
  margin-top: var(--sp-2);
}
.flabel {
  flex: 0 0 42px;
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
  text-align: right;
}
.finput:disabled {
  color: var(--c-text-3);
}
.unit {
  font-size: 11px;
  color: var(--c-text-3);
}
.steppers {
  display: flex;
  gap: 6px;
}
.step {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  color: var(--c-text);
  font-size: 15px;
  cursor: pointer;
}

.quick-qty {
  display: flex;
  gap: 6px;
  margin: var(--sp-3) 0 var(--sp-2);
}
.qbtn {
  flex: 1;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 7px 0;
  cursor: pointer;
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
