<script setup lang="ts">
/** 涨跌幅胶囊：A 股红涨绿跌 */
import { computed } from 'vue'
import { fmtPct } from '@/utils/format'

const props = withDefaults(defineProps<{ value: number; solid?: boolean; digits?: number }>(), {
  solid: false,
  digits: 2,
})

const cls = computed(() => {
  if (props.value > 0) return props.solid ? 'pill up-bg' : 'up'
  if (props.value < 0) return props.solid ? 'pill down-bg' : 'down'
  return props.solid ? 'pill flat-bg' : 'flat'
})

const text = computed(() => fmtPct(props.value, props.digits))
</script>

<template>
  <span :class="cls" class="tabular">{{ text }}</span>
</template>
