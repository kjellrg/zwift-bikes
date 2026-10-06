import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import { TT_FRAME_SPEED_DATA } from './frameSpeedData'
import { FRAME_UPGRADE_SCHEMES } from './frameUpgradeSchemes'
import { applyFrameSupplement, isProvisionalFrameId, PROVISIONAL_FRAME_ID_BASE, SUPPLEMENT_FRAMES, UNLOCALIZED_FRAME_NAME } from './frameSupplement'

describe('applyFrameSupplement', () => {
  const real = { id: 1, name: 'Real Bike', isTT: false }
  const placeholder = { id: 2, name: 'Brand LOC_ENTITLEMENT_CYCLING_BIKE_X_NAME', isTT: true }

  it('appends entries upstream lacks and lets upstream win on a name or a localized id', () => {
    const merged = applyFrameSupplement([real], [
      { id: 1, name: 'Real Bike Renamed', isTT: false }, // same id, upstream localized: upstream wins
      { id: 9, name: 'Real Bike', isTT: false }, // same name: upstream wins
      { id: 3, name: 'New Bike', isTT: true }
    ])
    expect(merged.map(f => f.name)).toEqual(['Real Bike', 'New Bike'])
  })

  it('an upstream placeholder under the same id does not block the supplement entry', () => {
    const merged = applyFrameSupplement([placeholder], [{ id: 2, name: 'Brand X', isTT: true }])
    expect(merged.filter(f => !UNLOCALIZED_FRAME_NAME.test(f.name)).map(f => f.name)).toEqual(['Brand X'])
  })

  it('provisional ids sit above every possible Zwift signature', () => {
    expect(PROVISIONAL_FRAME_ID_BASE).toBe(4294967296)
    expect(isProvisionalFrameId(4294967295)).toBe(false)
    expect(isProvisionalFrameId(PROVISIONAL_FRAME_ID_BASE)).toBe(true)
    for (const frame of bikeFrames) expect(isProvisionalFrameId(frame.id), frame.name).toBe(false)
  })
})

describe('the shipped supplement', () => {
  it('every entry is measured, scheme-mapped and unique against upstream by name', () => {
    const upstreamNames = new Set(bikeFrames.map(f => f.name))
    const seen = new Set<number>()
    for (const frame of SUPPLEMENT_FRAMES) {
      expect(upstreamNames.has(frame.name), frame.name).toBe(false)
      expect(seen.has(frame.id), `${frame.name} shares an id`).toBe(false)
      seen.add(frame.id)
      expect(frame.isTT ? TT_FRAME_SPEED_DATA[frame.name] : undefined, `${frame.name} speed row`).toBeDefined()
      expect(FRAME_UPGRADE_SCHEMES[frame.name], `${frame.name} scheme`).toBeDefined()
    }
  })
})
