import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } from '../data/frameSpeedData'
import { classifyBikeFrame, FIXED_WHEEL_FRAMES, isRedundantCosmeticVariant } from './classifyBikeFrame'
import { standardEquivalentClimbScore } from './physics/equipment'

const frameByName = (name: string) => {
  const frame = bikeFrames.find(f => f.name === name)
  expect(frame, `zwift-data no longer has a frame named "${name}"`).toBeDefined()
  return frame!
}

describe('category decisions with history behind them', () => {
  it('the Tron bikes are standard road frames, not funbikes (issue #25)', () => {
    for (const name of ['Zwift Concept Z1', 'Zwift Golden Concept Z1']) {
      const classified = classifyBikeFrame(frameByName(name))
      expect(classified.category, name).toBe('standard')
      expect(classified.style, name).toBe('aero')
      expect(classified.hasFixedWheels, name).toBe(true)
    }
  })

  it('the Cannondale R4000 Roller Blade is a standard road frame despite matching the funbike regex (issue #72)', () => {
    const classified = classifyBikeFrame(frameByName('Cannondale R4000 Roller Blade'))
    expect(classified.category).toBe('standard')
    expect(classified.confidence).toBe('measured')
    expect(classified.hasFixedWheels).toBe(true)
  })

  it('every fixed-wheel frame really exists in the catalog and classifies as fixed-wheel', () => {
    for (const name of FIXED_WHEEL_FRAMES) {
      expect(classifyBikeFrame(frameByName(name)).hasFixedWheels, name).toBe(true)
    }
  })

  it('zwift-data\'s isTT flag always wins the category call', () => {
    for (const frame of bikeFrames.filter(f => f.isTT)) {
      expect(classifyBikeFrame(frame).category, frame.name).toBe('tt')
    }
  })
})

describe('measured data flows through', () => {
  it('every speed-data frame classifies as measured, with solved physics', () => {
    const measuredNames = new Set([...Object.keys(FRAME_SPEED_DATA), ...Object.keys(TT_FRAME_SPEED_DATA)])
    for (const frame of bikeFrames.filter(f => measuredNames.has(f.name))) {
      const classified = classifyBikeFrame(frame, 5)
      expect(classified.confidence, frame.name).toBe('measured')
      expect(classified.physics, frame.name).toBeDefined()
    }
  })

  it('upgrading a measured frame to stage 5 never lowers its scores', () => {
    const measuredNames = new Set([...Object.keys(FRAME_SPEED_DATA), ...Object.keys(TT_FRAME_SPEED_DATA)])
    for (const frame of bikeFrames.filter(f => measuredNames.has(f.name))) {
      const stage0 = classifyBikeFrame(frame, 0)
      const stage5 = classifyBikeFrame(frame, 5)
      expect(stage5.scores.aero, frame.name).toBeGreaterThanOrEqual(stage0.scores.aero)
      expect(stage5.scores.climb, frame.name).toBeGreaterThanOrEqual(stage0.scores.climb)
    }
  })

  it('no estimated standard frame outranks the best measured one (issues #85/#86)', () => {
    const classified = bikeFrames.map(f => classifyBikeFrame(f, 5))
    for (const category of ['standard', 'tt'] as const) {
      const inCategory = classified.filter(f => f.category === category)
      const maxMeasuredAero = Math.max(...inCategory.filter(f => f.confidence === 'measured').map(f => f.scores.aero))
      const maxMeasuredClimb = Math.max(...inCategory.filter(f => f.confidence === 'measured').map(f => f.scores.climb))
      for (const frame of inCategory.filter(f => f.confidence === 'estimated')) {
        expect(frame.scores.aero, `${frame.name} aero`).toBeLessThan(maxMeasuredAero)
        expect(frame.scores.climb, `${frame.name} climb`).toBeLessThan(maxMeasuredClimb)
      }
    }
  })
})

describe('TT climb scores cross the baseline correctly', () => {
  it('standardEquivalentClimbScore is the identity for standard frames and a real penalty for TT frames', () => {
    expect(standardEquivalentClimbScore(65, false)).toBe(65)
    // TT climb scores are measured against the lighter "Zwift TT" baseline;
    // at the same raw number a TT frame is a far worse climber.
    for (const score of [20, 50, 65, 96]) {
      expect(standardEquivalentClimbScore(score, true)).toBeLessThan(score)
    }
  })

  it('is monotonic: a better TT climb score never maps to a worse standard-equivalent', () => {
    let previous = -1
    for (let score = 0; score <= 100; score += 5) {
      const equivalent = standardEquivalentClimbScore(score, true)
      expect(equivalent).toBeGreaterThanOrEqual(previous)
      previous = equivalent
    }
  })
})

describe('cosmetic re-skin handling', () => {
  const goldenTron = frameByName('Zwift Golden Concept Z1')
  const tron = frameByName('Zwift Concept Z1')

  it('drops the Golden Concept Z1 from rankings unless the rider owns it - then drops the original instead', () => {
    expect(isRedundantCosmeticVariant(goldenTron, new Set())).toBe(true)
    expect(isRedundantCosmeticVariant(tron, new Set())).toBe(false)
    const ownsGolden = new Set(['Zwift Golden Concept Z1'])
    expect(isRedundantCosmeticVariant(goldenTron, ownsGolden)).toBe(false)
    expect(isRedundantCosmeticVariant(tron, ownsGolden)).toBe(true)
  })
})
