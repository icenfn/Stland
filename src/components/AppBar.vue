<script setup lang="ts">
/** 通用顶栏：沉浸式（状态栏染色）+ 返回按钮 + 插槽 */
import { useRouter } from 'vue-router'

withDefaults(defineProps<{ title?: string; back?: boolean; transparent?: boolean }>(), {
  title: '',
  back: false,
  transparent: false,
})

const router = useRouter()
</script>

<template>
  <header class="app-bar" :class="{ transparent }">
    <div class="app-bar__inner">
      <button v-if="back" class="back" aria-label="返回" @click="router.back()">
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
