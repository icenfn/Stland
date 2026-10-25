<script setup lang="ts">
/** 应用根组件：负责沉浸式栏初始化与全局布局 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useImmersiveBar } from './composables/useImmersive'
import TabBar from './components/TabBar.vue'

useImmersiveBar()

const route = useRoute()
const showTabBar = computed(() => Boolean(route.meta.tab))
const isAuthPage = computed(() => route.meta.public === true)
</script>

<template>
  <div class="app-root">
    <router-view v-slot="{ Component }">
      <transition name="slide" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>

    <!-- 底部 TabBar：仅一级页面显示，登录页与详情页隐藏 -->
    <TabBar v-if="showTabBar && !isAuthPage" />
  </div>
</template>

<style scoped>
.app-root {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-bg);
}
</style>
