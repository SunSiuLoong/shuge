import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * 左右滑动识别（书架切标签页 / 设置页右滑返回）。
 *
 * 两个坑，都在真机上踩过：
 * 1. 不能用 pointerup 收尾 —— 安卓 WebView 判定手势要变成滚动时，先发
 *    pointercancel，pointerup 永远不来。
 * 2. 光用 touch 事件也不够 —— 可滚动容器里 touchcancel 一样会来，而且
 *    比 touchend 早，终点坐标直接丢掉。所以 touchmove 必须是非 passive 的：
 *    一旦算出「这是横向滑动」，立刻 preventDefault 把滚动接管挡回去，
 *    后面的 touchmove/touchend 才不会被取消。
 *
 * 判定策略：位移超过 10px 时看方向 —— 纵向为主就放手（交给页面滚动），
 * 横向为主就锁定这一次手势，直到抬手再决定是否触发。
 */
export interface SwipeOptions {
  /** 触发所需的最小横向位移（px） */
  distance?: number
  /** 横向位移至少是纵向的几倍，防止斜着滚列表被误判 */
  dominance?: number
  /** 手指落在这些元素上时不认滑动（滑条、开关、输入框） */
  ignore?: string
  /** 返回 false 时这次手势不算滑动 */
  enabled?: () => boolean
}

const DEFAULT_IGNORE = 'input, textarea, select, [data-noswipe]'
/** 方向判定阈值：小于这个位移先观望，别一抖就锁。
 * [shuge] 20px 而不是 10px：真实手指点按普遍带 10-15px 的自然漂移，
 * 之前 10px 就锁定并 preventDefault，浏览器直接不派发 click——
 * 表现为「点标签/点书没反应」（adb 模拟点击零漂移，复现不了）。
 * 滑动触发阈值是 52px，锁定门槛提到 20px 不影响滑动判定 */
const LOCK_SLOP = 20

export const useSwipe = (
  el: Ref<HTMLElement | null>,
  onSwipe: (dir: 1 | -1) => void,
  opts: SwipeOptions = {},
): void => {
  const distance = opts.distance ?? 56
  const dominance = opts.dominance ?? 1.25
  const ignore = opts.ignore ?? DEFAULT_IGNORE

  let active = false
  /** 已锁定为横向滑动：这段时间的 touchmove 一律阻止滚动 */
  let locking = false
  let sx = 0
  let sy = 0
  let lastDx = 0
  let lastDy = 0
  let pointerId = -1

  const begin = (cx: number, cy: number, target: EventTarget | null): void => {
    active = false
    locking = false
    lastDx = 0
    lastDy = 0
    if (opts.enabled && !opts.enabled()) return
    if (target instanceof Element && target.closest(ignore)) return
    active = true
    sx = cx
    sy = cy
  }

  const finish = (): void => {
    if (
      locking &&
      Math.abs(lastDx) >= distance &&
      Math.abs(lastDx) > Math.abs(lastDy) * dominance
    ) {
      onSwipe(lastDx < 0 ? 1 : -1)
    }
    active = false
    locking = false
  }

  const track = (cx: number, cy: number): boolean => {
    lastDx = cx - sx
    lastDy = cy - sy
    if (locking) return true
    const ax = Math.abs(lastDx)
    const ay = Math.abs(lastDy)
    if (ax < LOCK_SLOP && ay < LOCK_SLOP) return false
    // 纵向为主：这是滚动，本次手势不再算滑动
    if (ay > ax) {
      active = false
      return false
    }
    locking = true
    return true
  }

  const onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) {
      active = false
      return
    }
    const t = e.touches[0]
    begin(t.clientX, t.clientY, e.target)
  }

  const onTouchMove = (e: TouchEvent): void => {
    if (!active) return
    const t = e.touches[0]
    if (!t) return
    if (!track(t.clientX, t.clientY)) return
    // 横向已锁定：把滚动接管挡回去，否则浏览器发 touchcancel 收走这次手势
    if (e.cancelable) e.preventDefault()
  }

  const onTouchEnd = (e: TouchEvent): void => {
    if (!active) return
    const t = e.changedTouches[0]
    if (t) track(t.clientX, t.clientY)
    finish()
  }

  /** touchcancel 也当作抬手：横向已锁定时位移是准的，别白滑一次 */
  const onTouchCancel = (): void => {
    finish()
  }

  // 桌面端（开发自测）用鼠标拖动也能滑
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    pointerId = e.pointerId
    begin(e.clientX, e.clientY, e.target)
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || !active) return
    track(e.clientX, e.clientY)
  }

  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return
    if (pointerId !== -1 && e.pointerId !== pointerId) return
    pointerId = -1
    if (!active) return
    track(e.clientX, e.clientY)
    finish()
  }

  /** 鼠标的 cancel：直接放弃，别把半截拖动当滑动 */
  const onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return
    active = false
    locking = false
  }

  onMounted(() => {
    const node = el.value
    if (!node) return
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    // 必须非 passive：要能 preventDefault 拦住滚动
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd, { passive: true })
    node.addEventListener('touchcancel', onTouchCancel, { passive: true })
    node.addEventListener('pointerdown', onPointerDown)
    node.addEventListener('pointermove', onPointerMove)
    node.addEventListener('pointerup', onPointerUp)
    node.addEventListener('pointercancel', onPointerCancel)
  })

  onBeforeUnmount(() => {
    const node = el.value
    if (!node) return
    node.removeEventListener('touchstart', onTouchStart)
    node.removeEventListener('touchmove', onTouchMove)
    node.removeEventListener('touchend', onTouchEnd)
    node.removeEventListener('touchcancel', onTouchCancel)
    node.removeEventListener('pointerdown', onPointerDown)
    node.removeEventListener('pointermove', onPointerMove)
    node.removeEventListener('pointerup', onPointerUp)
    node.removeEventListener('pointercancel', onPointerCancel)
  })
}
