<script setup lang="ts">
/** 应用根组件：Naive UI 主题与 Provider 装配 + 全局布局 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { darkTheme, zhCN, dateZhCN, type GlobalThemeOverrides } from 'naive-ui'
import { useImmersiveBar } from './composables/useImmersive'
import TabBar from './components/TabBar.vue'
import NaiveBridge from './components/NaiveBridge.vue'

useImmersiveBar()

const route = useRoute()
const showTabBar = computed(() => Boolean(route.meta.tab))
const isAuthPage = computed(() => route.meta.public === true)

/**
 * 主题覆盖：把 Naive UI 的令牌对齐到 global.css 的设计变量。
 *
 * 这样既有自己的深色视觉语言，弹窗/消息/输入框等原生控件又与页面同色系，
 * 不会出现「一个深色页面里弹出亮白色对话框」的割裂感。
 * 这里取值与 :root 中的 --c-* 保持一致，改主题只需同步一处语义。
 */
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#e8383d',
    primaryColorHover: '#f05256',
    primaryColorPressed: '#c0272c',
    primaryColorSuppl: '#e8383d',
    errorColor: '#ff4d4f',
    successColor: '#12b76a',
    warningColor: '#f0a020',
    infoColor: '#2f7bff',

    bodyColor: '#0b0f16',
    cardColor: '#161f2c',
    modalColor: '#161f2c',
    popoverColor: '#1c2735',
    tableColor: '#161f2c',
    inputColor: '#121a26',

    textColorBase: '#eaf0f8',
    textColor1: '#eaf0f8',
    textColor2: '#a6b2c4',
    textColor3: '#6b7789',

    borderColor: 'rgba(255,255,255,0.10)',
    dividerColor: 'rgba(255,255,255,0.07)',

    borderRadius: '12px',
    borderRadiusSmall: '8px',
    fontSize: '14px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif',
    fontFamilyMono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  },
  Dialog: {
    borderRadius: '16px',
    titleFontSize: '16px',
    fontSize: '14px',
  },
  Message: {
    borderRadius: '10px',
  },
}
</script>

<template>
  <n-config-provider
    :theme="darkTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    style="height: 100%"
  >
    <n-message-provider :max="3" placement="top">
      <n-dialog-provider>
        <NaiveBridge>
          <div class="app-root">
            <router-view v-slot="{ Component }">
              <transition name="slide" mode="out-in">
                <component :is="Component" />
              </transition>
            </router-view>

            <!-- 底部 TabBar：仅一级页面显示，登录页与详情页隐藏 -->
            <TabBar v-if="showTabBar && !isAuthPage" />
          </div>
        </NaiveBridge>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app-root {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-bg);
}
</style>
