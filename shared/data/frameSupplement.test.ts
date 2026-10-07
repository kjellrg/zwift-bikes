import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } from './frameSpeedData'
import { FRAME_UPGRADE_SCHEMES } from './frameUpgradeSchemes'
import { getFrames } from '../utils/catalog'
import { applyFrameSupplement, isProvisionalFrameId, PROVISIONAL_FRAME_ID_BASE, SUPPLEMENT_FRAMES, UNLOCALIZED_FRAME_NAME } from './frameSupplement'

describe('applyFrameSupplement', () => {
  const real = { id: 1, name: 'Real Bike', isTT: false }
  const placeholder = { id: 2, name: 'Brand LOC_ENTITLEMENT_CYCLING_BIKE_X_NAME', isTT: true }

  it('renames in place on an id match, appends new ids, and drops a new id that reuses an upstream name', () => {
    const merged = applyFrameSupplement([real], [
      { id: 1, name: 'Real Bike Renamed', isTT: false }, // same id: the entry's name replaces upstream's
      { id: 9, name: 'Real Bike', isTT: false }, // new id under an upstream name: dropped
      { id: 3, name: 'New Bike', isTT: true }
    ])
    expect(merged).toEqual([{ id: 1, name: 'Real Bike Renamed', isTT: false }, { id: 3, name: 'New Bike', isTT: true }])
  })

  it('an upstream placeholder under the same id is replaced by the supplement entry', () => {
    const merged = applyFrameSupplement([placeholder], [{ id: 2, name: 'Brand X', isTT: true }])
    expect(merged.map(f => f.name)).toEqual(['Brand X'])
    expect(merged.some(f => UNLOCALIZED_FRAME_NAME.test(f.name))).toBe(false)
  })

  it('a renamed frame keeps the id a garage holds, so the garage entry survives', () => {
    const merged = applyFrameSupplement(bikeFrames, SUPPLEMENT_FRAMES)
    const sl9 = merged.filter(f => f.id === 3371227947)
    expect(sl9.map(f => f.name)).toEqual(['Specialized S-Works Tarmac SL9'])
    expect(merged.some(f => f.name === 'Specialized Tarmac SL9')).toBe(false)
  })

  it('provisional ids sit above every possible Zwift signature', () => {
    expect(PROVISIONAL_FRAME_ID_BASE).toBe(4294967296)
    expect(isProvisionalFrameId(4294967295)).toBe(false)
    expect(isProvisionalFrameId(PROVISIONAL_FRAME_ID_BASE)).toBe(true)
    for (const frame of bikeFrames) expect(isProvisionalFrameId(frame.id), frame.name).toBe(false)
  })
})

describe('the shipped supplement', () => {
  it('every entry is scheme-mapped, unique against upstream by name, and measured unless its scheme says it is derived', () => {
    const upstreamNames = new Set(bikeFrames.map(f => f.name))
    const seen = new Set<number>()
    for (const frame of SUPPLEMENT_FRAMES) {
      expect(upstreamNames.has(frame.name), frame.name).toBe(false)
      expect(seen.has(frame.id), `${frame.name} shares an id`).toBe(false)
      seen.add(frame.id)
      const scheme = FRAME_UPGRADE_SCHEMES[frame.name]
      expect(scheme, `${frame.name} scheme`).toBeDefined()
      if (!scheme?.derived) expect((frame.isTT ? TT_FRAME_SPEED_DATA : FRAME_SPEED_DATA)[frame.name], `${frame.name} speed row`).toBeDefined()
    }
  })
})

describe('the Wilier Filante SLR ID2 We Ride Paris (#272)', () => {
  const RECORD = { id: 3123624451, name: 'Wilier Filante SLR ID2 We Ride Paris', modelYear: 2026, isTT: false }

  it('is in the catalog under the game\'s id and name, as an estimated road frame', () => {
    const wilier = getFrames().find(f => f.id === RECORD.id)
    expect(wilier?.name).toBe(RECORD.name)
    expect(wilier?.category).toBe('standard')
    expect(wilier?.confidence).toBe('estimated')
  })

  it('does not borrow the Filante Team\'s measurement', () => {
    const team = getFrames().find(f => f.name === 'Wilier Filante SLR ID2 Team')
    const wilier = getFrames().find(f => f.id === RECORD.id)
    expect(team?.confidence).toBe('measured')
    expect(wilier?.scores).not.toEqual(team?.scores)
  })

  it('upgrades on the scheme its dictionary lvId names, distance / high-end, marked as derived', () => {
    expect(FRAME_UPGRADE_SCHEMES[RECORD.name]).toEqual({ axis: 'distance', tier: 'high', derived: true })
  })

  it('gives way to zwift-data once the package ships it', () => {
    const merged = applyFrameSupplement([...bikeFrames, RECORD], SUPPLEMENT_FRAMES)
    expect(merged.filter(f => f.id === RECORD.id || f.name === RECORD.name)).toEqual([RECORD])
  })
})

describe('the two Canyon Aeroads the sheet\'s CANYON//SRAM row was confused between (#272)', () => {
  const byId = (id: number) => getFrames().find(f => f.id === id)

  it('the CFR - CANYON//SRAM is in the catalog under its game name, ranked on its own measurement', () => {
    const cfr = byId(2303301376)
    expect(cfr?.name).toBe('Canyon Aeroad CFR - CANYON//SRAM')
    expect(cfr?.confidence).toBe('measured')
    // The sheet's 300 W row for it: stage 0 and stage 5, flat and climb.
    expect(cfr?.upgradeCurve?.flat).toEqual([63.3, 74.6, 75.8, 87.6, 92.1, 92.4])
    expect(cfr?.upgradeCurve?.climb).toEqual([43.6, 44.6, 60.7, 71.7, 72.6, 80.1])
  })

  it('the Aeroad 2024 / SRAM, which nobody has measured, is estimated rather than ranked on the CFR\'s numbers', () => {
    const sram = byId(1122831861)
    expect(sram?.name).toBe('Canyon Aeroad 2024 / SRAM')
    expect(sram?.confidence).toBe('estimated')
    expect(sram?.upgradeCurve).toBeUndefined()
  })
})
