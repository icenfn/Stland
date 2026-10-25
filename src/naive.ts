/**
 * Naive UI 反馈桥。
 *
 * Naive UI 的 message / dialog 只能在 Provider 子树的组件里通过 useMessage / useDialog 取得，
 * 而业务代码（store、api 层、路由守卫）也需要提示能力。这里用一个极薄的桥：
 * NaiveBridge 组件挂载时把 API 注入进来，其余模块直接调用 feedback.*。
 *
 * 这样既满足「提示统一走 Naive UI」，又不需要把每个调用点都改成组件。
 */
import type { DialogApi, MessageApi } from 'naive-ui'

let messageApi: MessageApi | null = null
let dialogApi: DialogApi | null = null

export function bindNaive(m: MessageApi, d: DialogApi) {
  messageApi = m
  dialogApi = d
}

export interface ConfirmOptions {
  title?: string
  content: string
  positiveText?: string
  negativeText?: string
  /** 危险操作：确认按钮显示为红色 */
  danger?: boolean
}

export const feedback = {
  success(text: string) {
    messageApi?.success(text, { duration: 2200 })
  },
  error(text: string) {
    messageApi?.error(text, { duration: 3200 })
  },
  info(text: string) {
    messageApi?.info(text, { duration: 2400 })
  },
  warning(text: string) {
    messageApi?.warning(text, { duration: 2800 })
  },

  /**
   * 二次确认，返回是否点击了确认。
   * 用 Promise 包装而不是回调，业务代码里就能写成 `if (!(await feedback.confirm(...))) return`，
   * 与原先 window.confirm 的写法最接近，迁移成本最低。
   */
  confirm(opts: ConfirmOptions): Promise<boolean> {
    if (!dialogApi) {
      // Provider 尚未挂载（例如极早期调用），退化为浏览器确认，保证不会静默丢操作
      return Promise.resolve(window.confirm(opts.content))
    }
    return new Promise<boolean>((resolve) => {
      let settled = false
      const done = (v: boolean) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      dialogApi!.warning({
        title: opts.title ?? '请确认',
        content: opts.content,
        positiveText: opts.positiveText ?? '确定',
        negativeText: opts.negativeText ?? '取消',
        maskClosable: false,
        onPositiveClick: () => done(true),
        onNegativeClick: () => done(false),
        onClose: () => done(false),
        onMaskClick: () => done(false),
        ...(opts.danger ? { positiveButtonProps: { type: 'error' } } : {}),
      })
    })
  },
}
