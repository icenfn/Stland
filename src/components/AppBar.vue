<script setup lang="ts">
/**
 * 通用顶栏：沉浸式（状态栏染色）+ 返回按钮 + 插槽。
 *
 * 返回按钮不再调用 router.back()：它依赖浏览器历史深浅，历史被哨兵记录或
 * 深链直达改变后就没有目标可退 —— 这正是「卡在详情页、两个返回键都失效」的
 * 直接原因。改走 goBack()，显式 replace 回最近停留的框架页，不受历史状态影响。
 */
import { goBack } from '@/composables/useBackExit'

withDefaults(defineProps<{ title?: string; back?: boolean; transparent?: boolean }>(), {
  title: '',
  back: false,
  transparent: false,
})

</script>

<template>
  <header class="app-bar" :class="{ transparent }">
    <div class="app-bar__inner">
      <button v-if="back" class="back" aria-label="返回" @click="goBack()">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="app-bar__title ellipsis">
        <slot name="title">{{ title }}</slot>
      </div>
      <div class="actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.transparent {
  background: transparent;
  border-bottom-color: transparent;
  backdrop-filter: none;
}
.back {
  background: none;
  border: none;
  color: var(--c-text);
  padding: 4px 4px 4px 0;
  display: flex;
  cursor: pointer;
}
.app-bar__title {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
