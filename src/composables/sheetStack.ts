/**
 * 底部抽屉的「返回键」协同。
 *
 * 背景：抽屉打开时按系统返回键，预期只关抽屉、不退出页面。抽屉数量不止一个
 * （下单、副图切换、分组管理），而且页面级的返回键处理器（useBackExit）也在
 * 监听同一个 popstate。若没有一层共识，两方会同时响应同一个事件：
 * 抽屉关了，页面又退了一层，或者首页直接弹出「再按一次退出」。
 *
 * 约定：
 *  · 抽屉在打开时压一条哨兵历史记录（地址不变，因此不会引起路由跳转）；
 *  · 抽屉的 popstate 监听最先登记「本次返回已被消费」；
 *  · useBackExit 在处理前先查询这个标记，被消费过就什么都不做。
 */

let consumed = false

/** 抽屉消费掉了一次返回：告知页面级处理器不要再处理这个事件 */
export function markBackConsumed(): void {
  consumed = true
}

/** 读取并清空标记，保证一次返回只被消费一次 */
export function takeBackConsumed(): boolean {
  const v = consumed
  consumed = false
  return v
}
