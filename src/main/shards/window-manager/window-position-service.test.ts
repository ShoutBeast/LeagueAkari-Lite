import { describe, expect, it, vi } from 'vitest'

import { intersectsAnyDisplay, sanitizeRestoredContentBounds } from './window-position-service'

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
