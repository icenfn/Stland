<script setup lang="ts">
/**
 * 行情列表行：名称/代码在左，最新价在中，涨跌幅徽标在右。
 *
 * 为什么只保留一处涨跌幅：
 *   上一版中间列除了价格还挂了一行涨跌幅，右侧又有一枚涨跌徽标，
 *   同一行出现两个百分比；推送每次刷新时两处的过渡并不同步，
 *   看起来就是「数字在跳、还是两种样式在跳」。现在百分比只在右侧出现一次，
 *   中间列只留价格 —— 一列一个信息，行高也稳定了。
 *
 * 为什么不再显示代码旁的题材标签：
 *   热词标签长短不一，且是随行情推送一起下发的，标签出现/消失会让
 *   整行高度跳动、列表上下抖。题材信息在详情页「资料」区完整给出，
 *   列表里不再重复。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { fmtPrice, fmtPct, trendClass } from '@/utils/format'
import type { Quote } from '@/api/types'

const props = defineProps<{ quote: Quote }>()
const router = useRouter()

const pctClass = computed(() => trendClass(props.quote.change_pct))

/** 徽标底色：与文字色同源，涨跌方向一眼可辨 */
const pillClass = computed(() => {
  const p = props.quote.change_pct
  return p > 0 ? 'up-bg' : p < 0 ? 'down-bg' : 'flat-bg'
})

function open() {
  void router.push(`/stock/${props.quote.code}`)
}
</script>

<template>
  <div class="quote-row" @click="open">
    <div class="left">
      <div class="name ellipsis">{{ quote.name }}</div>
      <div class="sub">
        <span class="code">{{ quote.code }}</span>
      </div>
    </div>

    <div class="mid">
      <div class="price tabular" :class="pctClass">{{ fmtPrice(quote.price) }}</div>
    </div>

    <div class="right">
      <span class="pill tabular" :class="pillClass">{{ fmtPct(quote.change_pct) }}</span>
    </div>
  </div>
</template>

<style scoped>
.quote-row {
  display: flex;
  align-items: center;
  padding: 11px 14px;
  border-bottom: 1px solid var(--c-line);
  cursor: pointer;
  transition: background 0.12s ease;
  /* 行高固定：价格/百分比的字号与行数都不再随推送变化，列表不会抖 */
  min-height: 56px;
}
.quote-row:active {
  background: rgba(255, 255, 255, 0.04);
}
.left {
  flex: 1.3;
  min-width: 0;
}
.name {
  font-size: 15px;
  font-weight: 600;
}
.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-text-3);
}
.code {
  font-variant-numeric: tabular-nums;
}
.mid {
  flex: 1;
  text-align: right;
  padding-right: 12px;
}
.price {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.right {
  flex: 0 0 84px;
  display: flex;
  justify-content: flex-end;
}
</style>
