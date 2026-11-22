/**
 * 启动画面收尾。
 *
 * index.html 里放了一层静态的 #boot（书阁题字 + 三根书脊），在 JS 还没跑起来、
 * 书架数据还没读到的那一秒挡住白屏，用户不会再看到「这个标签下还没有书」
 * 这种中间态。书读完后调用本函数淡出并移除。
 */

/** 至少显示这么久：首屏极快时避免闪一下就没（看着像花屏）。
 *  performance.now() 的零点就是页面导航开始，直接拿来算已过时间 */
const MIN_SHOW_MS = 360

export const dismissBoot = (): void => {
  const el = document.getElementById('boot')
  if (!el || el.classList.contains('is-gone')) return
  const run = (): void => {
    el.classList.add('is-gone')
    window.setTimeout(() => el.remove(), 300)
  }
  const elapsed = typeof performance !== 'undefined' ? performance.now() : MIN_SHOW_MS
  const wait = Math.max(0, MIN_SHOW_MS - elapsed)
  if (wait > 0) window.setTimeout(run, wait)
  else run()
}
