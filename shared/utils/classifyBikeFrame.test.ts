import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } from '../data/frameSpeedData'
import { FRAME_UPGRADE_SCHEMES, drivetrainCrrDeltaForLevel, stageChartFor } from '../data/frameUpgradeSchemes'
import { classifyBikeFrame, FIXED_WHEEL_FRAMES, interpolateGap, isRedundantCosmeticVariant, solveMeasuredFramePhysics } from './classifyBikeFrame'
import { solveFrameEquipmentDelta, standardEquivalentClimbScore } from './physics/equipment'
import { getFrames, UNLOCALIZED_FRAME_NAME } from './catalog'

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

describe('catalog hygiene', () => {
  it('no catalog frame carries an unlocalized placeholder name', () => {
    for (const frame of getFrames()) {
      expect(frame.name, `frame ${frame.id}`).not.toMatch(UNLOCALIZED_FRAME_NAME)
    }
  })

  it('documents the one placeholder zwift-data currently ships, so a second one is noticed', () => {
    // Upstream gap, not ours: the Canyon Aeroad CFR 2026 shipped before its
    // localized string. When this fails because the list is empty, zwift-data
    // has caught up - delete this test. When it fails because the list grew,
    // check the new one is hidden by `getFrames()` and note it here.
    const placeholders = bikeFrames.filter(f => UNLOCALIZED_FRAME_NAME.test(f.name)).map(f => f.id)
    expect(placeholders).toEqual([2303301376])
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

  it('an intermediate level solves from the frame\'s own measured stage gap, not the scheme shape (issue #88)', () => {
    // CAAD12's sheet row says flat/climb stage 2 = 23.1/25.2 s/hr - notably
    // NOT what the distance-entry scheme shape would place between its
    // endpoints. The physics solve must consume the measured value.
    const sample = FRAME_SPEED_DATA['Cannondale CAAD12']!
    expect(sample.flatGapSecByStage?.[2]).toBe(23.1)
    expect(solveMeasuredFramePhysics('Cannondale CAAD12', 2, false)).toEqual(
      solveFrameEquipmentDelta({ flatGapSec: 23.1, climbGapSec: 25.2 }, false, drivetrainCrrDeltaForLevel(2))
    )
  })

  it('interpolateGap prefers the measured stage array, then the scheme shape, then linear', () => {
    const chart = stageChartFor(FRAME_UPGRADE_SCHEMES['Cannondale CAAD12']!)
    // Tier 1: the measured stage value is returned as-is, chart ignored.
    expect(interpolateGap(0, 100, 2, chart.flat, [0, 10, 20, 30, 40, 100])).toBe(20)
    expect(interpolateGap(0, 100, 0, chart.flat, [5, 10, 20, 30, 40, 100])).toBe(5)
    // Tier 2: the scheme shape scales the endpoint gain by the chart's
    // stage fraction (stage 2 of distance-entry = 16.4 of the 27.8 total).
    expect(interpolateGap(0, 27.8, 2, chart.flat)).toBeCloseTo(16.4, 5)
    // Tier 3: linear between the endpoints.
    expect(interpolateGap(0, 100, 2)).toBe(40)
  })

  it('stage-curve coverage never shrinks', () => {
    // A new frame added with endpoints only is fine (scheme-chart fallback
    // is the designed tier for it), but existing curves silently
    // disappearing is not - so this is a ratchet on the count, not a
    // per-frame requirement. 120 = the full roster at import time
    // (2026-08-25: 119 imported samples, counted once more via the Golden
    // Concept Z1 sharing the Tron's). Bump it when import-stage-curves.mjs
    // brings in curves for new frames; it must never go down.
    const withCurves = [...Object.values(FRAME_SPEED_DATA), ...Object.values(TT_FRAME_SPEED_DATA)]
      .filter(sample => sample.flatGapSecByStage && sample.climbGapSecByStage)
    expect(withCurves.length).toBeGreaterThanOrEqual(120)
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
