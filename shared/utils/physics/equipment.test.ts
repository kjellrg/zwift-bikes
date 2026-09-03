import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } from '../../data/frameSpeedData'
import { WHEEL_SPEED_DATA } from '../../data/wheelSpeedData'
import { PRECOMPUTED_TT_DISC_RESIDUAL_CDA_DELTA_M2, precomputedFrameDelta, precomputedWheelDelta } from '../../data/equipmentPhysics'
import { SURFACE_CRR } from '../../data/surfaceCrr'
import { classifyBikeFrame } from '../classifyBikeFrame'
import { speedForPower } from './forces'
import { TT_DISC_EXTRA_GAP_SEC, TT_DISC_REFERENCE_WHEEL, forwardFlatGapSec } from './equipment'

/**
 * Golden tests for the equipment-physics pipeline: every measured frame's and
 * wheel's precomputed CdA/mass/Crr delta, run forward through the same
 * power/speed physics the app uses, must reproduce the ZwiftInsider bot-test
 * gap-seconds it was solved from. `validate:equipment-physics` already proves
 * the committed table matches the solver's output; this proves the solver's
 * output reproduces the measurements - a change to `speedForPower`,
 * `calculateForces`, a baseline constant or the solve itself shows up here as
 * a named frame/wheel drifting from its published number.
 *
 * The constants below deliberately duplicate (pin) their unexported twins in
 * `equipment.ts`. If one of them changes there, this suite fails - which is
 * the point: each is a carefully calibrated, cited value (see the comments in
 * `equipment.ts`), and changing one should be a conscious, test-updating act.
 */
const BOT_POWER_W = 300
const BOT_RIDER_WEIGHT_KG = 75
const STANDARD_BASELINE_CDA_M2 = 0.32
const STANDARD_BASELINE_BIKE_MASS_KG = 8
const TT_BASELINE_CDA_M2 = STANDARD_BASELINE_CDA_M2 * 0.87
const TT_BASELINE_BIKE_MASS_KG = STANDARD_BASELINE_BIKE_MASS_KG * 2.0
// Tempus Fugit (17.231km/26m) and Alpe du Zwift (12.4km/1036m) - the two
// courses every ZwiftInsider bot test runs on.
const FLAT_TEST_GRADE = 26 / 17231
const CLIMB_TEST_GRADE = 1036 / 12400

const TARMAC_ROAD_CRR = SURFACE_CRR.tarmac.road!

interface Delta { cdaDeltaM2: number, bikeMassDeltaKg: number, crrDelta: number }

/** Seconds saved (+) or lost (-) per hour vs. the baseline bike at the bot protocol - ZwiftInsider's gap definition. */
function forwardGapSec(delta: Delta, grade: number, baselineCdaM2: number, baselineBikeMassKg: number): number {
  const baselineSpeed = speedForPower(BOT_POWER_W, BOT_RIDER_WEIGHT_KG + baselineBikeMassKg, grade, TARMAC_ROAD_CRR, baselineCdaM2)
  const speed = speedForPower(
    BOT_POWER_W,
    BOT_RIDER_WEIGHT_KG + baselineBikeMassKg + delta.bikeMassDeltaKg,
    grade,
    Math.max(0, TARMAC_ROAD_CRR + delta.crrDelta),
    baselineCdaM2 + delta.cdaDeltaM2
  )
  return 3600 * (1 - baselineSpeed / speed)
}

const GAP_TOLERANCE_SEC = 0.5

describe('measured equipment physics round-trips its ZwiftInsider gap-seconds', () => {
  it('every standard frame, at stage 0 and stage 5', () => {
    const drift: string[] = []
    for (const [name, sample] of Object.entries(FRAME_SPEED_DATA)) {
      for (const [level, flatGapSec, climbGapSec] of [[0, sample.flatGapSec0, sample.climbGapSec0], [5, sample.flatGapSec5, sample.climbGapSec5]] as const) {
        const delta = precomputedFrameDelta(name, level, false)
        const flat = forwardGapSec(delta, FLAT_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)
        const climb = forwardGapSec(delta, CLIMB_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)
        if (Math.abs(flat - flatGapSec) > GAP_TOLERANCE_SEC) drift.push(`${name} L${level} flat: ${flat.toFixed(2)} vs ${flatGapSec}`)
        if (Math.abs(climb - climbGapSec) > GAP_TOLERANCE_SEC) drift.push(`${name} L${level} climb: ${climb.toFixed(2)} vs ${climbGapSec}`)
      }
    }
    expect(drift).toEqual([])
  })

  it('every TT frame, at stage 0 and stage 5, against the TT baseline', () => {
    const drift: string[] = []
    for (const [name, sample] of Object.entries(TT_FRAME_SPEED_DATA)) {
      for (const [level, flatGapSec, climbGapSec] of [[0, sample.flatGapSec0, sample.climbGapSec0], [5, sample.flatGapSec5, sample.climbGapSec5]] as const) {
        const delta = precomputedFrameDelta(name, level, true)
        const flat = forwardGapSec(delta, FLAT_TEST_GRADE, TT_BASELINE_CDA_M2, TT_BASELINE_BIKE_MASS_KG)
        const climb = forwardGapSec(delta, CLIMB_TEST_GRADE, TT_BASELINE_CDA_M2, TT_BASELINE_BIKE_MASS_KG)
        if (Math.abs(flat - flatGapSec) > GAP_TOLERANCE_SEC) drift.push(`${name} L${level} flat: ${flat.toFixed(2)} vs ${flatGapSec}`)
        if (Math.abs(climb - climbGapSec) > GAP_TOLERANCE_SEC) drift.push(`${name} L${level} climb: ${climb.toFixed(2)} vs ${climbGapSec}`)
      }
    }
    expect(drift).toEqual([])
  })

  it('every measured wheel', () => {
    const drift: string[] = []
    for (const [name, sample] of Object.entries(WHEEL_SPEED_DATA)) {
      const delta = precomputedWheelDelta(name)
      const flat = forwardGapSec(delta, FLAT_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)
      const climb = forwardGapSec(delta, CLIMB_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)
      if (Math.abs(flat - sample.flatGapSec) > GAP_TOLERANCE_SEC) drift.push(`${name} flat: ${flat.toFixed(2)} vs ${sample.flatGapSec}`)
      if (Math.abs(climb - sample.climbGapSec) > GAP_TOLERANCE_SEC) drift.push(`${name} climb: ${climb.toFixed(2)} vs ${sample.climbGapSec}`)
    }
    expect(drift).toEqual([])
  })
})

describe('published reference points', () => {
  it('the Tron bike saves its published 114.6 s/h on the flat course at stage 0 (zwiftinsider.com/tron-bike)', () => {
    const frame = bikeFrames.find(f => f.name === 'Zwift Concept Z1')
    expect(frame).toBeDefined()
    const classified = classifyBikeFrame(frame!, 0)
    expect(classified.confidence).toBe('measured')
    expect(classified.physics).toBeDefined()
    const flat = forwardGapSec(classified.physics!, FLAT_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)
    expect(flat).toBeCloseTo(114.6, 0)
  })

  it('the best TT frame beats the STANDARD baseline by ~223 s/h on the flat course (the cross-baseline anchor)', () => {
    // Pins the TT-vs-standard baseline placement `equipment.ts` calibrated
    // via `TT_BASELINE_CDA_M2`/`TT_BASELINE_BIKE_MASS_KG`: the stage-5 Canyon
    // Speedmax CFR must land ~223 s/h ahead of the standard baseline -
    // comfortably past the Tron's published 114.6 - and a change to either
    // multiplier moves this number.
    const frame = bikeFrames.find(f => f.name === 'Canyon Speedmax CFR')
    expect(frame).toBeDefined()
    const classified = classifyBikeFrame(frame!, 5)
    expect(classified.category).toBe('tt')
    expect(classified.physics).toBeDefined()

    const standardBaselineSpeed = speedForPower(BOT_POWER_W, BOT_RIDER_WEIGHT_KG + STANDARD_BASELINE_BIKE_MASS_KG, FLAT_TEST_GRADE, TARMAC_ROAD_CRR, STANDARD_BASELINE_CDA_M2)
    const speedmaxSpeed = speedForPower(
      BOT_POWER_W,
      BOT_RIDER_WEIGHT_KG + TT_BASELINE_BIKE_MASS_KG + classified.physics!.bikeMassDeltaKg,
      FLAT_TEST_GRADE,
      Math.max(0, TARMAC_ROAD_CRR + classified.physics!.crrDelta),
      TT_BASELINE_CDA_M2 + classified.physics!.cdaDeltaM2
    )
    const gapSec = 3600 * (1 - standardBaselineSpeed / speedmaxSpeed)
    expect(gapSec).toBeGreaterThan(210)
    expect(gapSec).toBeLessThan(235)
  })

  it('a disc wheel on a TT frame is worth its road gap plus the published 15.8 s/h extra, no more', () => {
    // The road-solved delta already buys more seconds on the lighter-CdA,
    // heavier TT baseline than on the road baseline; the residual must only
    // cover what that shift leaves of the 15.8 (zwiftinsider.com/wheel/
    // dt-swiss-arc-1100-dicut-85-disc). Solving the whole 15.8 on top
    // over-credited TT+disc by ~7 s/h.
    const disc = precomputedWheelDelta(TT_DISC_REFERENCE_WHEEL)
    const roadGap = WHEEL_SPEED_DATA[TT_DISC_REFERENCE_WHEEL]!.flatGapSec
    const onTt = forwardFlatGapSec({ ...disc, cdaDeltaM2: disc.cdaDeltaM2 + PRECOMPUTED_TT_DISC_RESIDUAL_CDA_DELTA_M2 }, TT_BASELINE_CDA_M2, TT_BASELINE_BIKE_MASS_KG)
    expect(Math.abs(onTt - (roadGap + TT_DISC_EXTRA_GAP_SEC))).toBeLessThan(GAP_TOLERANCE_SEC)
    // And the exported forward helper agrees with this file's own.
    expect(forwardFlatGapSec(disc, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG)).toBeCloseTo(forwardGapSec(disc, FLAT_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG), 3)
  })

  it('the baseline frame solves to (near-)zero deltas at stage 0', () => {
    const frame = bikeFrames.find(f => f.name === 'Zwift Carbon')
    expect(frame).toBeDefined()
    const { physics } = classifyBikeFrame(frame!, 0)
    expect(physics).toBeDefined()
    expect(Math.abs(physics!.cdaDeltaM2)).toBeLessThan(0.001)
    expect(Math.abs(physics!.bikeMassDeltaKg)).toBeLessThan(0.05)
    expect(physics!.crrDelta).toBe(0)
  })
})
