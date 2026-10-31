<script setup lang="ts">
/**
 * 下单底部抽屉。
 *
 * 本版四处调整：
 *
 * 1) 去掉「买入 / 卖出」切换。
 *    抽屉是从明确的入口打开的 —— 详情页的「买入」「卖出」按钮各自对应一种意图，
 *    打开后再让用户切一次，等于让他重复确认刚点过的按钮；也更危险：
 *    切着切着把「卖出」当「买入」提交。方向由调用方传入，抽屉只显示当前方向。
 *
 * 2) 委托方式改为「限价委托 / 市价委托」。
 *    原来只写「限价 / 市价」，对新手是黑话；这两者真正的差别是「要不要指定价格」，
 *    所以价格输入框在市价下直接置灰并写明「按市价成交」。
 *
 * 3) 增加「可买 / 可卖」股数。
 *    原来只显示「可成交」，那是撮合视角（能不能成交），不是用户视角（我买得起多少）。
 *    现在按「可用资金 ÷ 价格」算可买、按持仓可用算可卖，并提供「全部」一键填入，
 *    省掉用户心算。
 *
 * 4) 价格与数量都带 ＋/－ 步进。
 *    价格按最小变动价位跳，数量按一手跳，避免手输 100 手输成 100 股。
 *
 * 间距一律使用像素与真实存在的变量（--c-* / --r-* / --safe-bottom）。
 * 早前这一层用了 --sp-2/--sp-3/--sp-4，而样式表里从来没有这些变量，
 * 导致 padding、margin 全部失效，抽屉内容挤成一坨。
 *
 * 返回键语义保持不变：抽屉打开时按系统返回键只关闭抽屉，不退出当前页面。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { accountApi, marketApi, tradeApi } from '@/api'
import type { Quote, StockMeta, TradePreview } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { fmtAmount, fmtPrice } from '@/utils/format'
import BaseSheet from '@/components/BaseSheet.vue'

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

const router = useRouter()
const auth = useAuth()

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

/** 账户可用资金（买方向算可买） */
const cash = ref(0)
/** 该标的可卖数量（卖方向算可卖） */
const sellable = ref(0)
/** 账户信息是否已拿到，用于区分「可买 0 股」和「还没查到」 */
const capacityReady = ref(false)

const lot = computed(() => meta.value?.lot_size ?? 100)
const loggedIn = computed(() => !!auth.state.user)

/** 计算可买/可卖用的价格：市价单用最新价估算 */
const calcPrice = computed(() =>
  orderType.value === 'limit' ? Number(price.value) || 0 : Number(quote.value?.price ?? 0),
)

const maxQty = computed(() => {
  if (side.value === 'sell') return sellable.value
  const p = calcPrice.value
  if (!p || !lot.value) return 0
  // 一手一手算，向下取整到整手，避免出现「可买 137 股」这种买不进去的数
  return Math.floor(cash.value / (p * lot.value)) * lot.value
})

const estimateAmount = computed(() => Number(quote.value?.price ?? 0) * Number(quantity.value || 0))

/** 主动关闭：返回键与下滑关闭都由 BaseSheet 统一处理 */
function close() {
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

/** 取可用资金与可卖数量。失败不弹错 —— 这只是辅助信息，不该挡住下单 */
async function loadCapacity() {
  capacityReady.value = false
  cash.value = 0
  sellable.value = 0
  if (!loggedIn.value || !code.value) {
    capacityReady.value = true
    return
  }
  try {
    const [s, p] = await Promise.all([accountApi.summary(), accountApi.positions()])
    cash.value = s.asset?.cash ?? 0
    const pos = p.items.find((x) => x.code === code.value)
    sellable.value = pos?.available ?? 0
  } catch {
    /* 未登录或接口异常时保持 0，界面显示「—」 */
  } finally {
    capacityReady.value = true
  }
}

async function refreshPreview() {
  const qty = Number(quantity.value)
  if (!code.value || !qty || !loggedIn.value) {
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
  if (orderType.value === 'market') return
  const tick = meta.value?.tick_size ?? 0.01
  const next = Math.max(tick, Number(price.value || 0) + delta * tick)
  price.value = next.toFixed(2)
}

function stepQty(delta: number) {
  const cur = Number(quantity.value || 0)
  const next = Math.max(0, cur + delta * lot.value)
  quantity.value = String(next)
}

function fillAll() {
  if (maxQty.value > 0) quantity.value = String(maxQty.value)
}

function setMessage(text: string, type: 'ok' | 'err') {
  message.value = text
  messageType.value = type
}

async function submit() {
  message.value = ''
  if (!loggedIn.value) return setMessage('请先登录后再下单', 'err')
  const qty = Number(quantity.value)
  if (!qty || qty <= 0) return setMessage('请输入委托数量', 'err')
  if (qty % lot.value !== 0) return setMessage(`数量需为 ${lot.value} 股的整数倍`, 'err')
  if (side.value === 'sell' && sellable.value > 0 && qty > sellable.value)
    return setMessage(`可卖数量只有 ${sellable.value} 股`, 'err')
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
    // 下单后资金与持仓都变了，容量与预估要一起重算
    await Promise.all([loadCapacity(), refreshPreview()])
  } catch (e: any) {
    setMessage(e?.message ?? '下单失败', 'err')
  } finally {
    submitting.value = false
  }
}

function goLogin() {
  close()
  void router.push('/login')
}

watch(
  () => props.show,
  (v) => {
    if (!v) return
    message.value = ''
    preview.value = null
    code.value = props.code
    side.value = props.side
    // 换标的要重新取行情，价格先清空由行情回填
    quote.value = null
    meta.value = null
    price.value = ''
    quantity.value = '100'
    orderType.value = 'limit'
    void loadSymbol().then(() => Promise.all([loadCapacity(), refreshPreview()]))
  },
)

watch([price, quantity, orderType, side], () => {
  if (props.show) void refreshPreview()
})

</script>

<template>
  <!-- 抽屉外壳交给 BaseSheet：圆角、遮罩、返回键关闭、下滑关闭只实现一次。
       方向由入口决定，head 槽位只做「当前在做什么」的提示，不再提供切换。 -->
  <BaseSheet :show="show" max-height="86vh" @update:show="close">
    <template #head>
      <span class="side-tag" :class="side">{{ side === 'buy' ? '买入' : '卖出' }}</span>
    </template>

        <div class="seg-row">
          <button class="seg-btn" :class="{ on: orderType === 'limit' }" @click="orderType = 'limit'">
            限价委托
          </button>
          <button class="seg-btn" :class="{ on: orderType === 'market' }" @click="orderType = 'market'">
            市价委托
          </button>
        </div>

        <!-- 价格：限价必填，市价置灰 -->
        <div class="field">
          <span class="flabel">价格</span>
          <input
            v-model="price"
            class="finput tabular"
            type="number"
            inputmode="decimal"
            :disabled="orderType === 'market'"
            :placeholder="orderType === 'market' ? '按市价成交' : '0.00'"
          />
          <div class="steppers">
            <button class="step" :disabled="orderType === 'market'" @click="stepPrice(-1)">－</button>
            <button class="step" :disabled="orderType === 'market'" @click="stepPrice(1)">＋</button>
          </div>
        </div>

        <!-- 数量：带可买/可卖提示与整手步进 -->
        <div class="field">
          <span class="flabel">数量</span>
          <input v-model="quantity" class="finput tabular" type="number" inputmode="numeric" placeholder="0" />
          <span class="unit">股</span>
          <div class="steppers">
            <button class="step" @click="stepQty(-1)">－</button>
            <button class="step" @click="stepQty(1)">＋</button>
          </div>
        </div>

        <div class="cap-row">
          <span class="cap">
            {{ side === 'buy' ? '可买' : '可卖' }}
            <b v-if="capacityReady" class="tabular">{{ maxQty }}</b>
            <b v-else class="tabular muted">—</b>
            股
          </span>
          <button v-if="maxQty > 0" class="cap-all" @click="fillAll">全部</button>
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

        <!-- 未登录：给登录入口，而不是点了按钮才报错 -->
        <button v-if="!loggedIn" class="btn btn-block btn-primary" @click="goLogin">登录后下单</button>
        <button
          v-else
          class="btn btn-block"
          :class="side === 'buy' ? 'btn-buy' : 'btn-sell'"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? '提交中…' : side === 'buy' ? '确认买入' : '确认卖出' }}
        </button>
        <p class="tip">撮合按价格优先、时间优先逐档成交；未成交部分资金自动解冻。</p>
  </BaseSheet>
</template>

<style scoped>
.side-tag {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  line-height: 18px;
}
.side-tag.buy {
  color: #ff8b8d;
  background: rgba(232, 56, 61, 0.14);
}
.side-tag.sell {
  color: #69e2a5;
  background: rgba(18, 183, 106, 0.14);
}

.seg-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.seg-btn {
  flex: 1;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 9px;
  color: var(--c-text-2);
  font-family: inherit;
  font-size: 13px;
  padding: 9px 0;
  cursor: pointer;
}
.seg-btn.on {
  border-color: var(--c-brand);
  color: #ff8b8d;
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--c-line);
  margin-top: 8px;
}
.flabel {
  flex: 0 0 40px;
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
  font-family: inherit;
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
  line-height: 1;
  cursor: pointer;
}
.step:disabled {
  color: var(--c-text-3);
  cursor: default;
}

.cap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 2px;
}
.cap {
  font-size: 11px;
  color: var(--c-text-3);
}
.cap b {
  color: var(--c-text-2);
  font-weight: 600;
  margin: 0 2px;
}
.cap-all {
  background: none;
  border: none;
  color: var(--c-brand);
  font-size: 11px;
  font-weight: 600;
  padding: 0;
  cursor: pointer;
}

.preview {
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  margin: 10px 0 12px;
}
.prow {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--c-text-2);
  padding: 3px 0;
}
.prow em,
.muted {
  font-style: normal;
  color: var(--c-text-3);
}

.msg {
  font-size: 12px;
  margin: 0 0 8px;
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
</style>
