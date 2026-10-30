<script setup lang="ts">
/** 行情页：全部标的 + 搜索 + 板块筛选 + 排序 + 热词标签 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMarket } from '@/stores/market'
import { marketApi } from '@/api'
import type { IndexQuote } from '@/api/types'
import QuoteRow from '@/components/QuoteRow.vue'
import { fmtPct } from '@/utils/format'

const market = useMarket()
const { state } = market

const keyword = ref('')
const industry = ref('')
const sort = ref('change_pct')
const industries = ref<Array<{ industry: string; count: number; change_pct: number }>>([])
const loading = ref(false)
const router = useRouter()
/** 指数和个股一样有代码，独立成一组入口（不可交易，但可看详情） */
const indices = ref<IndexQuote[]>([])

const sortOptions = [
  { value: 'change_pct', label: '涨幅' },
  { value: 'amount', label: '成交额' },
  { value: 'turnover_rate', label: '换手' },
  { value: 'price', label: '价格' },
]

let debounce: number | undefined

function applyFilter() {
  state.keyword = keyword.value.trim()
  state.industry = industry.value
  state.sort = sort.value
  void market.refreshList()
}

watch(keyword, () => {
  window.clearTimeout(debounce)
  debounce = window.setTimeout(applyFilter, 260)
})
watch([industry, sort], applyFilter)

const list = computed(() => state.quotes)

// 行情轮询由首页容器统一启停：两个面板常驻，各自 start/stop 会互相掐断
onMounted(async () => {
  try {
    const res = await marketApi.industries()
    industries.value = res.items
  } catch {
    industries.value = []
  }
  try {
    const res = await marketApi.indexList()
    indices.value = res.items
  } catch {
    indices.value = []
  }
})
onBeforeUnmount(() => {
  window.clearTimeout(debounce)
})
</script>

<template>
  <div class="page">
    <header class="app-bar">
      <div class="app-bar__inner" style="gap: 10px">
        <div class="search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" stroke-linecap="round" />
          </svg>
          <input v-model="keyword" class="search-input" placeholder="搜索名称 / 代码 / 热词" />
        </div>
      </div>
    </header>

    <!-- 指数：与个股同一套浏览语义，点击进入指数详情 -->
    <div v-if="indices.length" class="idx-strip">
      <button
        v-for="idx in indices"
        :key="idx.code"
        class="idx-card"
        @click="router.push(`/index/${idx.code}`)"
      >
        <span class="idx-name">{{ idx.name }}</span>
        <span class="idx-price tabular" :class="idx.change_pct > 0 ? 'up' : idx.change_pct < 0 ? 'down' : 'flat'">
          {{ idx.price.toFixed(2) }}
        </span>
        <span class="idx-pct tabular" :class="idx.change_pct > 0 ? 'up' : idx.change_pct < 0 ? 'down' : 'flat'">
          {{ fmtPct(idx.change_pct) }}
        </span>
      </button>
    </div>

    <!-- 板块筛选 -->
    <div class="chips">
      <button class="chip" :class="{ on: industry === '' }" @click="industry = ''">全部</button>
      <button v-for="it in industries" :key="it.industry" class="chip"
        :class="{ on: industry === it.industry }" @click="industry = it.industry">
        {{ it.industry }}
        <span class="chip-pct tabular" :class="it.change_pct > 0 ? 'up' : it.change_pct < 0 ? 'down' : 'flat'">
          {{ fmtPct(it.change_pct, 1) }}
        </span>
      </button>
    </div>

    <!-- 排序栏 -->
    <div class="sortbar">
      <button v-for="opt in sortOptions" :key="opt.value" class="sort"
        :class="{ on: sort === opt.value }" @click="sort = opt.value">
        {{ opt.label }}
      </button>
      <div class="grow" />
      <span class="text-xs">{{ list.length }} 支 · {{ state.overview?.session.label ?? '' }}</span>
    </div>

    <div class="list">
      <div v-if="!list.length" class="empty">暂无匹配标的</div>
      <QuoteRow v-for="q in list" :key="q.code" :quote="q" show-hotword />
    </div>

    <p class="disclaimer">
      数据由服务端内置行情引擎实时生成（每 {{ 1.5 }} 秒轮询），非真实市场行情。
    </p>
  </div>
</template>

<style scoped>
.search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-line);
  border-radius: 20px;
  padding: 7px 12px;
  color: var(--c-text-3);
}
.search-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--c-text);
  font-size: 13px;
}
.search-input::placeholder {
  color: var(--c-text-3);
}

.idx-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 14px 2px;
  scrollbar-width: none;
}
.idx-strip::-webkit-scrollbar {
  display: none;
}
.idx-card {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 104px;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
}
.idx-name {
  font-size: 10px;
  color: var(--c-text-3);
  white-space: nowrap;
}
.idx-price {
  font-size: 15px;
  font-weight: 700;
}
.idx-pct {
  font-size: 10px;
}

.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 14px 4px;
  scrollbar-width: none;
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--c-card);
  border: 1px solid var(--c-line);
  border-radius: 16px;
  color: var(--c-text-2);
  font-size: 12px;
  padding: 6px 11px;
  cursor: pointer;
}
.chip.on {
  border-color: var(--c-brand);
  color: #ff8b8d;
  background: rgba(232, 56, 61, 0.1);
}
.chip-pct {
  font-size: 10px;
}

.sortbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
}
.sort {
  background: none;
  border: none;
  color: var(--c-text-3);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.sort.on {
  color: var(--c-brand);
  background: rgba(232, 56, 61, 0.12);
  font-weight: 600;
}

.list {
  background: var(--c-card);
  border-top: 1px solid var(--c-line);
  border-bottom: 1px solid var(--c-line);
}

.disclaimer {
  font-size: 10px;
  color: var(--c-text-3);
  padding: 14px;
  line-height: 1.6;
}
</style>
