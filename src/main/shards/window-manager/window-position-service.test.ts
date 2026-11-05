import { describe, expect, it, vi } from 'vitest'

import {
  createTrackedBounds,
  intersectsAnyDisplay,
  resolveTrackedBounds,
  sanitizeRestoredContentBounds
} from './window-position-service'

vi.mock('electron', () => ({}))
vi.mock('@main/native', () => ({
  NATIVE_SUPPORT: { getLeagueClientWindowPlacement: { available: false } },
  getLeagueClientWindowPlacement: () => null
}))

describe('sanitizeRestoredContentBounds', () => {
  it('保留合法的窗口位置, 并将坐标与尺寸取整', () => {
    expect(
      sanitizeRestoredContentBounds(
        { x: 10.4, y: -3.6, width: 800.4, height: 600.5 },
        340,
        420,
        4000
      )
    ).toEqual({ x: 10, y: -4, width: 800, height: 601 })
  })

  it('尺寸低于最小值时提升到最小值, 位置保持不变', () => {
    expect(
      sanitizeRestoredContentBounds({ x: 120, y: 88, width: 200, height: 300 }, 340, 420, 4000)
    ).toEqual({ x: 120, y: 88, width: 340, height: 420 })
  })

  it('脏数据返回 null 以回退到默认尺寸', () => {
    const corruptBounds = [
      null,
      undefined,
      { x: Number.NaN, y: 0, width: 400, height: 500 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 400, height: 500 },
      { x: 0, y: 0, width: 0, height: 500 },
      { x: 0, y: 0, width: 400, height: -1 },
      // 3 倍最大显示器尺寸以上的值视为 DPI 异常期间误存的脏数据
      { x: 0, y: 0, width: 20000, height: 500 }
    ]

    for (const bounds of corruptBounds) {
      expect(sanitizeRestoredContentBounds(bounds as any, 340, 420, 3840)).toBeNull()
    }
  })

  it('边界值: 恰好等于 3 倍最大显示器尺寸的值被保留', () => {
    expect(
      sanitizeRestoredContentBounds({ x: 0, y: 0, width: 3840 * 3, height: 500 }, 340, 420, 3840)
    ).toEqual({ x: 0, y: 0, width: 3840 * 3, height: 500 })
  })

  it('超出目标显示器工作区的尺寸被裁剪, 但不会低于最小尺寸', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }

    expect(
      sanitizeRestoredContentBounds({ x: 10, y: 10, width: 3000, height: 2000 }, 340, 420, 4000, {
        workArea
      })
    ).toEqual({ x: 10, y: 10, width: 1920, height: 1040 })

    expect(
      sanitizeRestoredContentBounds({ x: 10, y: 10, width: 200, height: 200 }, 340, 420, 4000, {
        workArea: { x: 0, y: 0, width: 1920, height: 1040 }
      })
    ).toEqual({ x: 10, y: 10, width: 340, height: 420 })
  })
})

describe('createTrackedBounds', () => {
  it('取整并记录窗口所在显示器的缩放系数与 id', () => {
    expect(
      createTrackedBounds(
        { x: 10.4, y: -3.6, width: 340.5, height: 535.2 },
        { id: 7, scaleFactor: 1.25 }
      )
    ).toEqual({ x: 10, y: -4, width: 341, height: 535, scaleFactor: 1.25, displayId: 7 })
  })
})

describe('resolveTrackedBounds', () => {
  const primary = { x: 100, y: 100, width: 340, height: 535, scaleFactor: 1, displayId: 1 }

  it('跨显示器且尺寸按缩放系数跳变时, 沿用上一次的尺寸并只更新位置', () => {
    // 250% 显示器上 Chromium 报出的被放大尺寸
    const measured = {
      x: -1400,
      y: 120,
      width: 878,
      height: 1352,
      scaleFactor: 2.5,
      displayId: 2
    }

    expect(resolveTrackedBounds(measured, primary)).toEqual({
      x: -1400,
      y: 120,
      width: 340,
      height: 535,
      scaleFactor: 2.5,
      displayId: 2
    })
  })

  it('跨显示器但尺寸没有按缩放系数跳变时, 采纳新尺寸', () => {
    const measured = {
      x: -1400,
      y: 120,
      width: 500,
      height: 600,
      scaleFactor: 2.5,
      displayId: 2
    }

    expect(resolveTrackedBounds(measured, primary)).toEqual(measured)
  })

  it('同一显示器内的尺寸变化一律采纳', () => {
    const measured = { ...primary, width: 700, height: 800 }

    expect(resolveTrackedBounds(measured, primary)).toEqual(measured)
  })

  it('没有上一次记录时直接采纳本次测量', () => {
    const measured = {
      x: 0,
      y: 0,
      width: 878,
      height: 1352,
      scaleFactor: 2.5,
      displayId: 2
    }

    expect(resolveTrackedBounds(measured, null)).toEqual(measured)
  })
})

describe('intersectsAnyDisplay', () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
  ]

  it('与任一显示器存在交集时返回 true', () => {
    expect(intersectsAnyDisplay({ x: 1800, y: 100, width: 340, height: 420 }, displays)).toBe(true)
    expect(intersectsAnyDisplay({ x: 100, y: 100, width: 340, height: 420 }, displays)).toBe(true)
  })

  it('完全落在所有显示器之外时返回 false, 包括仅有边缘接触的情况', () => {
    expect(intersectsAnyDisplay({ x: 4000, y: 100, width: 340, height: 420 }, displays)).toBe(false)
    // 窗口左边缘恰好贴住副屏右边缘, 属于完全不可达
    expect(intersectsAnyDisplay({ x: 3840, y: 100, width: 340, height: 420 }, displays)).toBe(false)
  })
})
