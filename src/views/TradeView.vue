<script setup lang="ts">
/** 交易页：选股 + 买卖 + 限价/市价 + 预估（含滑点）+ 快捷数量（东方财富下单面板） */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMarket } from '@/stores/market'
import { tradeApi, marketApi } from '@/api'
import type { Quote, StockMeta, TradePreview } from '@/api/types'
import AppBar from '@/components/AppBar.vue'
import { fmtAmount, fmtPrice } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const market = useMarket()

const side = ref<'buy' | 'sell'>('buy')
const code = ref(String(route.query.code ?? '688301'))
const codeInput = ref('')
const price = ref('')
const quantity = ref('100')
const orderType = ref<'limit' | 'market'>('limit')
const quote = ref<Quote | null>(null)
const meta = ref<StockMeta | null>(null)
const preview = ref<TradePreview | null>(null)
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')
const submitting = ref(false)
const showPicker = ref(false)
const pickerKeyword = ref('')

const lot = computed(() => meta.value?.lot_size ?? 100)
const quickQty = computed(() => [1, 2, 3, 5, 10].map((n) => n * lot.value))

const candidates = computed(() => {
  const kw = pickerKeyword.value.trim()
  if (!kw) return market.state.quotes.slice(0, 40)
  return market.state.quotes.filter((q) => q.name.includes(kw) || q.code.includes(kw) || (q.hotword ?? '').includes(kw))
})

async function loadSymbol() {
  try {
    const res = await marketApi.detail(code.value)
    quote.value = res.quote
    meta.value = res.meta
    if (!price.value || orderType.value === 'limit') {
      price.value = res.quote.price.toFixed(2)
    }
  } catch (e: any) {
    setMessage(e?.message ?? '标的不存在', 'err')
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

function setMessage(text: string, type: 'ok' | 'err' = 'ok') {
  message.value = text
  messageType.value = type
  if (type === 'ok') window.setTimeout(() => (message.value = ''), 3000)
}

function pickSymbol(c: Quote) {
  code.value = c.code
  price.value = c.price.toFixed(2)
  showPicker.value = false
  pickerKeyword.value = ''
  void loadSymbol()
}

async function submit() {
  message.value = ''
  const qty = Number(quantity.value)
  if (!qty || qty <= 0) {
    setMessage('请输入委托数量', 'err')
    return
  }
  if (qty % lot.value !== 0) {
    setMessage(`数量需为 ${lot.value} 股的整数倍`, 'err')
    return
  }
  if (orderType.value === 'limit' && (!price.value || Number(price.value) <= 0)) {
    setMessage('请输入委托价格', 'err')
    return
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
      setMessage(`委托已全部成交，均价 ${fmtPrice(o.avg_fill_price, 4)}，费用 ${fmtPrice(o.fee)} 元`, 'ok')
    } else if (o.status === 'partial') {
      setMessage(`部分成交 ${o.filled_quantity}/${o.quantity} 股`, 'ok')
    } else {
      setMessage(`委托已受理（${o.status}）`, 'ok')
    }
    await refreshPreview()
  } catch (e: any) {
    setMessage(e?.message ?? '下单失败', 'err')
  } finally {
    submitting.value = false
  }
}

watch([code, side, price, quantity, orderType], () => {
  void refreshPreview()
})

watch(
  () => route.query.code,
  (v) => {
    if (v && String(v) !== code.value) {
      code.value = String(v)
      void loadSymbol()
    }
  },
)

onMounted(async () => {
  market.start(1600)
  await loadSymbol()
  await refreshPreview()
})
</script>

<template>
  <div class="page">
    <AppBar title="交易下单" />

    <!-- 标的 -->
    <section class="px" style="padding-top: 12px">
      <div class="card symbol-card" @click="showPicker = true">
        <div class="row-between">
          <div>
            <div class="sym-name">{{ quote?.name ?? '选择标的' }}</div>
            <div class="sym-code">{{ code }} · {{ meta?.board ?? '' }}</div>
          </div>
          <div class="sym-price">
            <div class="tabular" :class="(quote?.change_pct ?? 0) >= 0 ? 'up' : 'down'" style="font-size: 18px; font-weight: 700">
              {{ fmtPrice(quote?.price ?? 0) }}
            </div>
            <div class="text-xs tabular" :class="(quote?.change_pct ?? 0) >= 0 ? 'up' : 'down'">
              {{ (quote?.change_pct ?? 0) > 0 ? '+' : '' }}{{ (quote?.change_pct ?? 0).toFixed(2) }}%
            </div>
          </div>
        </div>
        <div class="hint-row">
          <span class="text-xs">点击切换标的</span>
          <span class="text-xs">涨停 {{ fmtPrice(meta?.limit_up ?? 0) }} / 跌停 {{ fmtPrice(meta?.limit_down ?? 0) }}</span>
        </div>
      </div>
    </section>

    <!-- 买卖切换 -->
    <section class="px">
      <div class="side-switch">
        <button class="side-btn" :class="{ on: side === 'buy' }" @click="side = 'buy'">买入</button>
        <button class="side-btn sell" :class="{ on: side === 'sell' }" @click="side = 'sell'">卖出</button>
      </div>
    </section>

    <!-- 表单 -->
    <section class="px">
      <div class="card form-card">
        <div class="form-row">
          <span class="flabel">委托方式</span>
          <div class="seg">
            <button class="seg-btn" :class="{ on: orderType === 'limit' }" @click="orderType = 'limit'">限价</button>
            <button class="seg-btn" :class="{ on: orderType === 'market' }" @click="orderType = 'market'">市价</button>
          </div>
        </div>

        <div class="form-row">
          <span class="flabel">委托价格</span>
          <input v-model="price" class="qty-input tabular" type="number" inputmode="decimal"
            :disabled="orderType === 'market'" :placeholder="orderType === 'market' ? '按市价成交' : '0.00'" />
          <div class="steppers">
            <button class="step" @click="price = (Number(price) - (meta?.tick_size ?? 0.01)).toFixed(2)">－</button>
            <button class="step" @click="price = (Number(price) + (meta?.tick_size ?? 0.01)).toFixed(2)">＋</button>
          </div>
        </div>

        <div class="form-row">
          <span class="flabel">委托数量</span>
          <input v-model="quantity" class="qty-input tabular" type="number" inputmode="numeric" placeholder="0" />
          <span class="text-xs">股</span>
        </div>

        <div class="quick-qty">
          <button v-for="q in quickQty" :key="q" class="qbtn" @click="quantity = String(q)">{{ q }}</button>
        </div>

        <!-- 预估 -->
        <div v-if="preview" class="preview">
          <div class="prow">
            <span>预估均价</span>
            <span class="tabular">{{ fmtPrice(preview.estimated_avg_price, 4) }}</span>
          </div>
          <div class="prow">
            <span>预估滑点</span>
            <span class="tabular" :class="preview.slippage_pct > 0 ? 'up' : preview.slippage_pct < 0 ? 'down' : 'flat'">
              {{ preview.slippage_pct.toFixed(3) }}%
            </span>
          </div>
          <div class="prow">
            <span>预计金额</span>
            <span class="tabular">{{ fmtAmount(preview.amount) }}</span>
          </div>
          <div class="prow">
            <span>预计费用</span>
            <span class="tabular">{{ fmtPrice(preview.fee.total) }} 元</span>
          </div>
          <div class="prow">
            <span>可成交数量</span>
            <span class="tabular">{{ preview.fillable_quantity }} 股</span>
          </div>
        </div>

        <p v-if="message" class="msg" :class="messageType">{{ message }}</p>

        <button class="btn btn-block" :class="side === 'buy' ? 'btn-buy' : 'btn-sell'" :disabled="submitting"
          @click="submit">
          {{ submitting ? '提交中…' : side === 'buy' ? '确认买入' : '确认卖出' }}
        </button>

        <button class="btn btn-ghost btn-block" style="margin-top: 8px" @click="router.push('/orders')">
          查看委托与成交
        </button>
      </div>
    </section>

    <p class="disclaimer px">
      撮合按「价格优先、时间优先」逐档成交；买入冻结「委托价×数量+预估费用」，未成交差额自动退回。
    </p>

    <!-- 标的选择器 -->
    <transition name="fade">
      <div v-if="showPicker" class="picker-mask" @click.self="showPicker = false">
        <div class="picker">
          <div class="picker-head">
            <input v-model="pickerKeyword" class="input" placeholder="搜索名称 / 代码 / 热词" />
            <button class="btn btn-ghost" style="padding: 10px 14px" @click="showPicker = false">取消</button>
          </div>
          <div class="picker-list">
            <button v-for="c in candidates" :key="c.code" class="picker-item" @click="pickSymbol(c)">
              <div class="pi-left">
                <span class="pi-name">{{ c.name }}</span>
                <span class="pi-code">{{ c.code }}</span>
              </div>
              <span class="pi-price tabular" :class="c.change_pct > 0 ? 'up' : c.change_pct < 0 ? 'down' : 'flat'">
                {{ fmtPrice(c.price) }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.symbol-card {
  cursor: pointer;
}
.sym-name {
  font-size: 17px;
  font-weight: 700;
}
.sym-code {
  font-size: 11px;
  color: var(--c-text-3);
  margin-top: 2px;
}
.sym-price {
  text-align: right;
}
.hint-row {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--c-line);
}

.side-switch {
  display: flex;
  background: var(--c-card);
  border-radius: var(--r-md);
  padding: 4px;
  margin-top: 12px;
  border: 1px solid var(--c-line);
}
.side-btn {
  flex: 1;
  background: none;
  border: none;
  color: var(--c-text-2);
  font-size: 14px;
  font-weight: 600;
  padding: 9px 0;
  border-radius: 9px;
  cursor: pointer;
}
.side-btn.on {
  background: linear-gradient(135deg, #ff5c5e, #d92b2f);
  color: #fff;
}
.side-btn.sell.on {
  background: linear-gradient(135deg, #1cc477, #0a8f52);
}

.form-card {
  margin-top: 12px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--c-line);
}
.flabel {
  width: 68px;
  flex: 0 0 68px;
  font-size: 12px;
  color: var(--c-text-2);
}
.seg {
  display: flex;
  gap: 6px;
}
.seg-btn {
  background: var(--c-bg-elevated);
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
  background: rgba(232, 56, 61, 0.1);
}
.qty-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--c-text);
  font-size: 19px;
  font-weight: 700;
  text-align: right;
  min-width: 0;
}
.qty-input:disabled {
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
  background: var(--c-card-2);
  border: 1px solid var(--c-line);
  color: var(--c-text);
  font-size: 15px;
  cursor: pointer;
}
.quick-qty {
  display: flex;
  gap: 6px;
  margin: 12px 0 4px;
}
.qbtn {
  flex: 1;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: 8px;
  color: var(--c-text-2);
  font-size: 11px;
  padding: 6px 0;
  cursor: pointer;
}

.preview {
  margin: 12px 0;
  padding: 10px 12px;
  background: var(--c-bg-elevated);
  border-radius: var(--r-md);
  border: 1px solid var(--c-line);
}
.prow {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--c-text-2);
  padding: 3px 0;
}

.msg {
  font-size: 12px;
  margin: 8px 0;
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

.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  line-height: 1.7;
  margin: 14px 0;
}

.picker-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 60;
  display: flex;
  align-items: flex-end;
}
.picker {
  width: 100%;
  max-height: 76vh;
  background: var(--c-bg-elevated);
  border-radius: 20px 20px 0 0;
  padding: 14px;
  padding-bottom: calc(14px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
}
.picker-head {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.picker-list {
  overflow-y: auto;
}
.picker-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: none;
  border: none;
  border-bottom: 1px solid var(--c-line);
  padding: 11px 2px;
  color: var(--c-text);
  cursor: pointer;
}
.pi-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pi-name {
  font-size: 14px;
  font-weight: 600;
}
.pi-code {
  font-size: 11px;
  color: var(--c-text-3);
}
.pi-price {
  font-size: 14px;
  font-weight: 600;
}
</style>
