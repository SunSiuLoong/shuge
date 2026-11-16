/**
 * 打开外部链接。
 *
 * 两种情况：
 *  - 装成 App：Capacitor 的 WebViewClient 会把 host 不是应用自身的 URL 交给
 *    Android Intent（Bridge.launchIntent），也就是系统浏览器。所以直接改
 *    location 就行——**不能**用 window.open(_, '_blank')，WebView 没实现
 *    onCreateWindow，那样点下去什么都不会发生。
 *  - 浏览器 / PWA：新标签页打开，别把当前页面顶掉。
 */
export const openExternal = (url: string): void => {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  const native = typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false
  if (native) {
    window.location.href = url
    return
  }
  const w = window.open(url, '_blank', 'noopener,noreferrer')
  if (!w) {
    // 被拦截（少数内置浏览器），退回当前页导航
    window.location.href = url
  }
}
