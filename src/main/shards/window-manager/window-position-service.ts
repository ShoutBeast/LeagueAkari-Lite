import { NATIVE_SUPPORT, getLeagueClientWindowPlacement } from '@main/native'
import { BrowserWindow, Display, Rectangle, screen } from 'electron'

export function rectsIntersect(rect1: Rectangle, rect2: Rectangle) {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  )
}

export function rectDistance(rect1: Rectangle, rect2: Rectangle) {
  let dx = 0
  let dy = 0

  if (rect1.x > rect2.x + rect2.width) {
    dx = rect1.x - (rect2.x + rect2.width)
  } else if (rect2.x > rect1.x + rect1.width) {
    dx = rect2.x - (rect1.x + rect1.width)
  }

  if (rect1.y > rect2.y + rect2.height) {
    dy = rect1.y - (rect2.y + rect2.height)
  } else if (rect2.y > rect1.y + rect1.height) {
    dy = rect2.y - (rect1.y + rect1.height)
  }

  return Math.sqrt(dx * dx + dy * dy)
}

export function intersectsAnyDisplay(bounds: Rectangle, displays: Pick<Display, 'bounds'>[]) {
  return displays.some((display) => rectsIntersect(bounds, display.bounds))
}

export function getMaxDisplayDimension() {
  return Math.max(
    ...screen.getAllDisplays().flatMap((display) => [display.bounds.width, display.bounds.height])
  )
}

/** 保存窗口尺寸时一并记录的显示器信息, 用于识别跨 DPI 显示器造成的尺寸误报 */
export interface TrackedWindowBounds extends Rectangle {
  /** 记录该尺寸时窗口所在显示器的缩放系数 */
  scaleFactor?: number

  /** 记录该尺寸时窗口所在显示器的 id */
  displayId?: number
}

/**
 * 窗口停稳多久之后才记录尺寸。
 *
 * 窗口跨到缩放比例不同的显示器时, Chromium 会在若干毫秒内抛出被缩放系数放大或
 * 缩小过的中间尺寸, 立即记录会把这类瞬时值写进存档。
 */
export const TRACKED_BOUNDS_SETTLE_MS = 500

/** 尺寸跳变落在缩放系数比例的该容差内时, 判定为 DPI 换算而非用户手动缩放 */
const DPI_SCALING_RATIO_TOLERANCE = 0.2

function isNearRatio(value: number, expected: number) {
  if (!Number.isFinite(value) || !Number.isFinite(expected) || expected <= 0) {
    return false
  }

  return Math.abs(value - expected) <= expected * DPI_SCALING_RATIO_TOLERANCE
}

export function createTrackedBounds(
  contentBounds: Rectangle,
  display: Pick<Display, 'id' | 'scaleFactor'>
): TrackedWindowBounds {
  return {
    x: Math.round(contentBounds.x),
    y: Math.round(contentBounds.y),
    width: Math.round(contentBounds.width),
    height: Math.round(contentBounds.height),
    scaleFactor: display.scaleFactor,
    displayId: display.id
  }
}

/**
 * 把本次测得的尺寸归一化为可持久化的 DIP 值。
 *
 * Chromium 在窗口跨到缩放比例不同的显示器时会按缩放系数放大或缩小报告尺寸,
 * 即便用户只是移动了窗口。若本次尺寸相对上一次恰好等于两者缩放系数之比,
 * 判定为 DPI 换算误报, 沿用上一次的尺寸, 只采纳新的位置与显示器信息。
 */
export function resolveTrackedBounds(
  next: TrackedWindowBounds,
  previous: TrackedWindowBounds | null | undefined
): TrackedWindowBounds {
  if (!previous) {
    return next
  }

  if (previous.displayId === undefined || next.displayId === undefined) {
    return next
  }

  if (previous.displayId === next.displayId) {
    return next
  }

  const previousScaleFactor = previous.scaleFactor
  const nextScaleFactor = next.scaleFactor

  if (!previousScaleFactor || !nextScaleFactor || previousScaleFactor === nextScaleFactor) {
    return next
  }

  const expectedRatio = nextScaleFactor / previousScaleFactor
  const widthRatio = next.width / previous.width
  const heightRatio = next.height / previous.height

  if (isNearRatio(widthRatio, expectedRatio) && isNearRatio(heightRatio, expectedRatio)) {
    return {
      ...next,
      width: previous.width,
      height: previous.height
    }
  }

  return next
}

export interface RestoredContentBoundsLimits {
  /** 目标显示器工作区, 用于裁剪超出屏幕的宽高 */
  workArea?: Rectangle
}

/**
 * 净化从存储中恢复的窗口内容区域, 防止脏数据(例如 DPI 切换异常期间误存的值)导致窗口恢复成异常大小。
 * 无法识别的数据返回 null, 由调用方回退到默认尺寸与位置。
 */
export function sanitizeRestoredContentBounds(
  bounds: Rectangle | null | undefined,
  minWidth: number,
  minHeight: number,
  maxDisplayDimension: number,
  limits: RestoredContentBoundsLimits = {}
): Rectangle | null {
  if (!bounds) {
    return null
  }

  const { x, y, width, height } = bounds
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null
  }

  if (width <= 0 || height <= 0) {
    return null
  }

  if (width > maxDisplayDimension * 3 || height > maxDisplayDimension * 3) {
    return null
  }

  const { workArea } = limits
  const maxWidth = workArea ? Math.max(workArea.width, minWidth) : Number.POSITIVE_INFINITY
  const maxHeight = workArea ? Math.max(workArea.height, minHeight) : Number.POSITIVE_INFINITY

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.min(Math.max(Math.round(width), minWidth), maxWidth),
    height: Math.min(Math.max(Math.round(height), minHeight), maxHeight)
  }
}

// 由于 chromium 的限制, 设置 bounds 并不会在最小化时生效。所以需要使用监听器来处理
const pendingRepositionWindows = new WeakSet<BrowserWindow>()

export function repositionWindowIfInvisible(win: BrowserWindow) {
  if (!win || win.isDestroyed()) return

  const winBounds = win.getBounds()

  const displays = screen.getAllDisplays()
  let nearestDisplay: Display | null = null
  let minDistance = Infinity

  for (const display of displays) {
    const distance = rectDistance(winBounds, display.workArea)
    if (distance < minDistance) {
      minDistance = distance
      nearestDisplay = display
    }
  }
  if (!nearestDisplay) return

  const workArea = nearestDisplay.workArea

  const fitsHorizontally = winBounds.width <= workArea.width
  const fitsVertically = winBounds.height <= workArea.height
  const sizeOK = fitsHorizontally && fitsVertically
  const visibleEnough = isWindowPartiallyVisible(win)

  if (visibleEnough && sizeOK) {
    return
  }

  const newWidth = Math.min(winBounds.width, workArea.width)
  const newHeight = Math.min(winBounds.height, workArea.height)

  let newX: number
  let newY: number

  // Horizontal adjustment
  if (newWidth < workArea.width) {
    newX = Math.min(Math.max(winBounds.x, workArea.x), workArea.x + workArea.width - newWidth)
  } else {
    // Window is as wide as the workArea → left‑align it.
    newX = workArea.x
  }

  // Vertical adjustment
  if (newHeight < workArea.height) {
    newY = Math.min(Math.max(winBounds.y, workArea.y), workArea.y + workArea.height - newHeight)
  } else {
    // Window is as tall as the workArea → top‑align it.
    newY = workArea.y
  }

  if (win.isMinimized()) {
    if (!pendingRepositionWindows.has(win)) {
      pendingRepositionWindows.add(win)
      win.once('restore', () => {
        pendingRepositionWindows.delete(win)
        win.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight })
      })
    }
  } else {
    win.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight })
  }
}

/**
 * 仅当窗口完全无法触及(与所有显示器均无交集)时, 才将其挪回最近显示器的可视区域。
 * 与 repositionWindowIfInvisible 不同, 该方法不会挪动用户刻意停靠在屏幕边缘或任务栏上的窗口,
 * 适合在窗口创建时自动调用, 避免破坏已记忆的窗口位置。
 */
export function rescueWindowIfUnreachable(win: BrowserWindow) {
  if (!win || win.isDestroyed()) return

  const winBounds = win.getBounds()
  const displays = screen.getAllDisplays()

  if (intersectsAnyDisplay(winBounds, displays)) {
    return
  }

  let nearestDisplay: Display | null = null
  let minDistance = Infinity

  for (const display of displays) {
    const distance = rectDistance(winBounds, display.workArea)
    if (distance < minDistance) {
      minDistance = distance
      nearestDisplay = display
    }
  }
  if (!nearestDisplay) return

  const workArea = nearestDisplay.workArea

  const newWidth = Math.min(winBounds.width, workArea.width)
  const newHeight = Math.min(winBounds.height, workArea.height)
  const newX = Math.min(Math.max(winBounds.x, workArea.x), workArea.x + workArea.width - newWidth)
  const newY = Math.min(Math.max(winBounds.y, workArea.y), workArea.y + workArea.height - newHeight)

  // 由于 chromium 的限制, 设置 bounds 并不会在最小化时生效。所以需要使用监听器来处理
  if (win.isMinimized()) {
    if (!pendingRepositionWindows.has(win)) {
      pendingRepositionWindows.add(win)
      win.once('restore', () => {
        pendingRepositionWindows.delete(win)
        win.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight })
      })
    }
  } else {
    win.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight })
  }
}

export function intersectionArea(rect1: Rectangle, rect2: Rectangle) {
  const xOverlap = Math.max(
    0,
    Math.min(rect1.x + rect1.width, rect2.x + rect2.width) - Math.max(rect1.x, rect2.x)
  )
  const yOverlap = Math.max(
    0,
    Math.min(rect1.y + rect1.height, rect2.y + rect2.height) - Math.max(rect1.y, rect2.y)
  )
  return xOverlap * yOverlap
}

export function repositionWindowWithSnap(
  win: BrowserWindow,
  targetBounds: Rectangle,
  placement: 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right' = 'top-left'
) {
  if (!win || win.isDestroyed()) return

  const winBounds = win.getBounds()

  const { x, y } = getPositionWithSnap(winBounds, targetBounds, placement)

  win.setPosition(x, y)
}

export function getPositionWithSnap(
  from: Rectangle,
  targetBounds: Rectangle,
  placement: 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right' = 'top-left'
) {
  const winBounds = from
  const display = screen.getDisplayMatching(targetBounds)
  const workArea = display.workArea
  let newX: number, newY: number

  switch (placement) {
    case 'top-left':
      // win 的右边对齐目标窗口左边，顶部对齐
      newX = targetBounds.x - winBounds.width
      newY = targetBounds.y
      break
    case 'bottom-left':
      // win 的右边对齐目标窗口左边，底部对齐
      newX = targetBounds.x - winBounds.width
      newY = targetBounds.y + targetBounds.height - winBounds.height
      break
    case 'top-right':
      // win 的左边对齐目标窗口右边，顶部对齐
      newX = targetBounds.x + targetBounds.width
      newY = targetBounds.y
      break
    case 'bottom-right':
      // win 的左边对齐目标窗口右边，底部对齐
      newX = targetBounds.x + targetBounds.width
      newY = targetBounds.y + targetBounds.height - winBounds.height
      break
  }

  // 如果新位置超出 workArea 的水平范围，则贴边 workArea
  if (newX < workArea.x) {
    newX = workArea.x
  } else if (newX + winBounds.width > workArea.x + workArea.width) {
    newX = workArea.x + workArea.width - winBounds.width
  }

  // 如果新位置超出 workArea 的垂直范围，则贴边 workArea
  if (newY < workArea.y) {
    newY = workArea.y
  } else if (newY + winBounds.height > workArea.y + workArea.height) {
    newY = workArea.y + workArea.height - winBounds.height
  }

  return { x: newX, y: newY }
}

export function isWindowPartiallyVisible(win: BrowserWindow, threshold = 0.98) {
  if (!win || win.isDestroyed()) return false

  const winBounds = win.getBounds()
  const winArea = winBounds.width * winBounds.height
  const displays = screen.getAllDisplays()

  let visibleArea = 0
  // 累加窗口与各显示器工作区相交的面积
  for (const display of displays) {
    visibleArea += intersectionArea(winBounds, display.workArea)
  }

  const visibleFraction = winArea > 0 ? visibleArea / winArea : 0
  return visibleFraction >= threshold
}

export function getCenteredRectangle(width: number, height: number) {
  let { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  let x = Math.round((screenWidth - width) / 2)
  let y = Math.round((screenHeight - height) / 2)

  return { x, y, width, height }
}

export function repositionToAlignLeagueClientUx(
  win: BrowserWindow,
  placement?: 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right'
) {
  if (!NATIVE_SUPPORT.getLeagueClientWindowPlacement.available) return

  const info = getLeagueClientWindowPlacement()
  if (info) {
    const { left, top, width, height } = info

    // League Client Ux 的窗口在最小化时会变为 { x: 0, y: 0, width: 134, height: 37 }
    if (width < 200 && height < 50) {
      return
    }

    repositionWindowWithSnap(win, { x: left, y: top, width, height }, placement)
  }
}
