<script setup lang="ts">
/** 行情列表行：仿东方财富自选股行布局（左名称代码，中价格，右涨跌胶囊） */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { fmtPrice, fmtPct, trendClass } from '@/utils/format'
import type { Quote } from '@/api/types'

const props = defineProps<{ quote: Quote; showHotword?: boolean }>()
const router = useRouter()

const pctClass = computed(() => trendClass(props.quote.change_pct))

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
        <span v-if="showHotword && quote.hotword" class="tag tag-hot ellipsis">{{ quote.hotword }}</span>
      </div>
    </div>

    <div class="mid">
      <div class="price tabular" :class="pctClass">{{ fmtPrice(quote.price) }}</div>
      <div class="sub tabular" :class="pctClass">{{ fmtPct(quote.change_pct) }}</div>
    </div>

    <div class="right">
      <span class="pill" :class="quote.change_pct > 0 ? 'up-bg' : quote.change_pct < 0 ? 'down-bg' : 'flat-bg'">
        {{ fmtPct(quote.change_pct) }}
      </span>
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
}
.right {
  flex: 0 0 84px;
  display: flex;
  justify-content: flex-end;
}
</style>
