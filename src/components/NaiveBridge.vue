<script setup lang="ts">
/**
 * Naive UI 反馈桥接组件。
 *
 * 必须渲染在 n-message-provider / n-dialog-provider 内部：
 * useMessage / useDialog 只能在其 Provider 子树中取得实例，
 * 这里拿到后交给 naive.ts 的 feedback，供 store / api / 路由守卫等非组件代码复用。
 *
 * 不渲染任何 DOM，只做注入。
 */
import { useDialog, useMessage } from 'naive-ui'
import { bindNaive } from '@/naive'

bindNaive(useMessage(), useDialog())
</script>

<template>
  <slot />
</template>
