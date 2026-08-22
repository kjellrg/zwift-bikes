import { describe, expect, it } from 'vitest'
import type { ClassifiedBikeFrame, ComboScore, RouteWithMeta, Wheelset } from '../types/catalog'
import { capWheelsetsPerFrame, rankCombos, scoreCombo, searchCombos } from './scoring'
import { getFrames } from './catalog'
import { getWheelsets } from './wheelsets'

function testRoute(overrides: Partial<RouteWithMeta>): RouteWithMeta {
  return {
    world: 'watopia',
    worldName: 'Watopia',
    name: 'Test Route',
    slug: 'test-route',
    distance: 20,
    elevation: 100,
    segments: [],
    segmentsOnRoute: [],
    sports: ['cycling'],
    eventOnly: false,
    levelLocked: false,
    lap: true,
    supportsTT: true,
    supportsMeetups: true,
    terrain: { climbRatio: 5, category: 'flat', weights: { aero: 0.8, climb: 0.2, gravel: 0, cobble: 0 }, climbs: [] },
    surface: { road: 100, gravel: 0, cobble: 0, confidence: 'measured' },
    ...overrides
  }
}

const FLAT_ROAD = testRoute({})
const PURE_COBBLE = testRoute({ surface: { road: 0, gravel: 0, cobble: 100, confidence: 'measured' } })
const PURE_GRAVEL = testRoute({ surface: { road: 0, gravel: 100, cobble: 0, confidence: 'measured' } })

const frames = () => getFrames()
const wheelsets = () => getWheelsets()

const standardFrame = () => frames().find(f => f.category === 'standard' && !f.hasFixedWheels)!
const ttFrame = () => frames().find(f => f.category === 'tt' && !f.hasFixedWheels)!
const roadWheelset = () => wheelsets().find(w => w.crrClass === 'road')!
const gravelWheelset = () => wheelsets().find(w => w.crrClass === 'gravel')!
const discWheelset = () => wheelsets().find(w => w.crrClass === 'road' && w.front.category === 'disc')!

describe('scoreCombo surface rules (Zwift physics, not real-world intuition)', () => {
  it('on 100% cobbles, every road-class wheelset ties - and beats a gravel wheelset', () => {
    // Off-road suitability is purely the wheel's Crr class, and road wheels
    // have the LOWEST cobblestone Crr (zwiftinsider.com/crr/).
    const frame = standardFrame()
    const roadScores = wheelsets().filter(w => w.crrClass === 'road').map(w => scoreCombo(PURE_COBBLE, frame, w).score)
    expect(new Set(roadScores).size).toBe(1)
    expect(roadScores[0]).toBeGreaterThan(scoreCombo(PURE_COBBLE, frame, gravelWheelset()).score)
  })

  it('on 100% gravel, a gravel wheelset beats a road wheelset', () => {
    const frame = standardFrame()
    const gravel = scoreCombo(PURE_GRAVEL, frame, gravelWheelset()).score
    const road = scoreCombo(PURE_GRAVEL, frame, roadWheelset()).score
    expect(gravel).toBeGreaterThan(road)
  })

  it('the frame contributes nothing off-road: two standard frames tie on cobbles with the same wheel', () => {
    const [a, b] = frames().filter(f => f.category === 'standard' && !f.hasFixedWheels)
    const wheelset = roadWheelset()
    expect(scoreCombo(PURE_COBBLE, a!, wheelset).score).toBe(scoreCombo(PURE_COBBLE, b!, wheelset).score)
  })
})

describe('scoreCombo TT disc bonus', () => {
  it('applies on an aero-relevant route and vanishes when aero is irrelevant', () => {
    const frame = ttFrame()
    const disc = discWheelset()
    const breakdownSum = (combo: ComboScore) => combo.breakdown.aero + combo.breakdown.climb + combo.breakdown.gravel + combo.breakdown.cobble
    const onFlat = scoreCombo(FLAT_ROAD, frame, disc)
    const onCobbles = scoreCombo(PURE_COBBLE, frame, disc)
    expect(onFlat.score).toBeGreaterThan(breakdownSum(onFlat))
    expect(onCobbles.score).toBe(breakdownSum(onCobbles))
  })
})

describe('scoreCombo output shape', () => {
  it('scores are whole numbers for every frame/wheelset pairing', () => {
    const wheelset = roadWheelset()
    for (const frame of frames()) {
      const { score, breakdown } = scoreCombo(FLAT_ROAD, frame, frame.hasFixedWheels ? undefined : wheelset)
      expect(Number.isInteger(score), `${frame.name} score ${score}`).toBe(true)
      for (const value of Object.values(breakdown)) expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('a fixed-wheel frame scores identically with and without a wheelset', () => {
    const tron = frames().find(f => f.hasFixedWheels)!
    expect(scoreCombo(FLAT_ROAD, tron, roadWheelset()).score).toBe(scoreCombo(FLAT_ROAD, tron, undefined).score)
  })
})

describe('rankCombos', () => {
  const ranked = () => rankCombos(FLAT_ROAD, frames(), wheelsets(), Number.MAX_SAFE_INTEGER)

  it('only pairs frames with wheelsets Zwift\'s garage actually allows', () => {
    for (const combo of ranked()) {
      if (!combo.wheelset) continue
      if (combo.frame.category === 'gravel') expect(combo.wheelset.crrClass).not.toBe('road')
      if (combo.frame.category === 'standard' || combo.frame.category === 'tt') expect(combo.wheelset.crrClass).toBe('road')
    }
  })

  it('gives fixed-wheel frames exactly one row, with no wheelset', () => {
    const fixedWheelRows = ranked().filter(c => c.frame.hasFixedWheels)
    const fixedWheelFrames = frames().filter(f => f.hasFixedWheels)
    expect(fixedWheelRows).toHaveLength(fixedWheelFrames.length)
    for (const row of fixedWheelRows) expect(row.wheelset).toBeUndefined()
  })

  it('sorts by score descending and honors the limit', () => {
    const all = ranked()
    for (let i = 1; i < all.length; i++) expect(all[i]!.score).toBeLessThanOrEqual(all[i - 1]!.score)
    expect(rankCombos(FLAT_ROAD, frames(), wheelsets(), 5)).toHaveLength(5)
  })
})

describe('capWheelsetsPerFrame', () => {
  const combo = (frameId: number, value: number): ComboScore => ({
    frame: { id: frameId } as ClassifiedBikeFrame,
    wheelset: {} as Wheelset,
    score: value,
    breakdown: { aero: 0, climb: 0, gravel: 0, cobble: 0 }
  })

  it('keeps at most maxPerFrame distinct values per frame and collapses exact ties', () => {
    const combos = [combo(1, 40), combo(1, 40), combo(1, 30), combo(1, 20), combo(1, 10), combo(2, 40)]
    const capped = capWheelsetsPerFrame(combos, c => c.score)
    expect(capped.map(c => [c.frame.id, c.score])).toEqual([[1, 40], [1, 30], [1, 20], [2, 40]])
  })

  it('respects a custom cap', () => {
    const combos = [combo(1, 3), combo(1, 2), combo(1, 1)]
    expect(capWheelsetsPerFrame(combos, c => c.score, 1)).toHaveLength(1)
  })
})

describe('searchCombos', () => {
  it('keeps every match and lists frame-name matches ahead of wheelset-only matches', () => {
    const all = rankCombos(FLAT_ROAD, frames(), wheelsets(), Number.MAX_SAFE_INTEGER)
    const term = 'zwift'
    const hits = searchCombos(all, term)
    const expected = all.filter(c => c.frame.name.toLowerCase().includes(term) || c.wheelset?.name.toLowerCase().includes(term))
    expect(hits).toHaveLength(expected.length)
    const lastFrameMatch = hits.map(c => c.frame.name.toLowerCase().includes(term)).lastIndexOf(true)
    const firstWheelOnlyMatch = hits.findIndex(c => !c.frame.name.toLowerCase().includes(term))
    if (firstWheelOnlyMatch !== -1) expect(lastFrameMatch).toBeLessThan(hits.length)
    // Every frame-name match precedes every wheelset-only match.
    expect(hits.slice(0, lastFrameMatch + 1).every(c => c.frame.name.toLowerCase().includes(term))).toBe(true)
  })

  it('a pure wheel search preserves the incoming order', () => {
    const all = rankCombos(FLAT_ROAD, frames(), wheelsets(), Number.MAX_SAFE_INTEGER)
    const term = 'dicut'
    expect(all.some(c => c.frame.name.toLowerCase().includes(term))).toBe(false)
    const hits = searchCombos(all, term)
    expect(hits).toEqual(all.filter(c => c.wheelset?.name.toLowerCase().includes(term)))
  })
})
