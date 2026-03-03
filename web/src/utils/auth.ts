import { useStorage } from '@vueuse/core'

/**
 * 统一的 Auth 状态管理
 * 解决多处独立调用 useStorage 导致的响应式同步延迟或失效问题
 */

// 管理员令牌
export const adminToken = useStorage('admin_token', '')

// 当前选中的账号 ID
export const currentAccountId = useStorage('current_account_id', '')

/**
 * 清除认证信息并跳转登录
 */
export function clearAuth() {
    adminToken.value = ''
    // 保持 accountId 存在以方便下次登录后恢复，或者也可以选择清除
    // currentAccountId.value = ''
}
