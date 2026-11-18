import { ref } from 'vue'

/**
 * 全局轻提示（顶部浮条）。
 *
 * 用在「后台自动补书」这类不是用户主动点出来的结果上：
 * 要给一个看得见的回执，但不该像 InfoDialog 那样拦下来要求点确认。
 * 放顶部而不是底部，是为了不跟书架的「导入结果」toast 抢同一个位置。
 */
export const noticeText = ref<string | null>(null)

let timer = 0

export const notify = (msg: string, ms = 4000): void => {
  noticeText.value = msg
  clearTimeout(timer)
  timer = window.setTimeout(() => (noticeText.value = null), ms)
}
