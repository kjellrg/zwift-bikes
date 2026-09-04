import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import { FRAME_SPEED_DATA, TT_FRAME_SPEED_DATA } from '../../data/frameSpeedData'
import { WHEEL_SPEED_DATA } from '../../data/wheelSpeedData'
import { PRECOMPUTED_TT_BASELINE, PRECOMPUTED_TT_DISC_RESIDUAL_CDA_DELTA_M2, precomputedFrameDelta, precomputedWheelDelta } from '../../data/equipmentPhysics'
import { SURFACE_CRR } from '../../data/surfaceCrr'
import { classifyBikeFrame } from '../classifyBikeFrame'
import { classifyWheelCategory } from '../classifyWheel'
import { speedForPower } from './forces'
import { CLIMB_TEST_GRADE as EQUIPMENT_CLIMB_TEST_GRADE, FLAT_TEST_GRADE as EQUIPMENT_FLAT_TEST_GRADE, TT_DISC_EXTRA_GAP_SEC, TT_DISC_REFERENCE_WHEEL, forwardFlatGapSec, forwardGapSec as forwardGapAtPower, solveTtBaseline, ttBaselineMeasuredGap } from './equipment'

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
 * The TT baseline is the exception: it is a solved value, read from the
 * precomputed table and proven against its own measurement below rather
 * than pinned by hand.
 */
const BOT_POWER_W = 300
const BOT_RIDER_WEIGHT_KG = 75
const STANDARD_BASELINE_CDA_M2 = 0.32
const STANDARD_BASELINE_BIKE_MASS_KG = 8
const TT_BASELINE_CDA_M2 = PRECOMPUTED_TT_BASELINE.cdaM2
const TT_BASELINE_BIKE_MASS_KG = PRECOMPUTED_TT_BASELINE.bikeMassKg
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

  it('the TT baseline reproduces ZwiftInsider\'s measured Zwift TT vs Zwift Carbon gaps at 300 W (issue #165)', () => {
    // The sheet prints both reference bikes' average speeds on both courses;
    // the TT baseline is solved from the 300 W pair on the standard baseline
    // exactly like a frame, so the round trip must close like a frame's.
    const measured = ttBaselineMeasuredGap('at300W')
    expect(measured.flatGapSec).toBeCloseTo(132.0, 0)
    expect(measured.climbGapSec).toBeCloseTo(-62.9, 0)
    const delta = { cdaDeltaM2: TT_BASELINE_CDA_M2 - STANDARD_BASELINE_CDA_M2, bikeMassDeltaKg: TT_BASELINE_BIKE_MASS_KG - STANDARD_BASELINE_BIKE_MASS_KG, crrDelta: 0 }
    expect(Math.abs(forwardGapAtPower(delta, EQUIPMENT_FLAT_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG) - measured.flatGapSec)).toBeLessThan(GAP_TOLERANCE_SEC)
    expect(Math.abs(forwardGapAtPower(delta, EQUIPMENT_CLIMB_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG) - measured.climbGapSec)).toBeLessThan(GAP_TOLERANCE_SEC)
    // And the precomputed table holds exactly what the solver produces.
    const fresh = solveTtBaseline()
    expect(fresh.cdaM2).toBe(TT_BASELINE_CDA_M2)
    expect(fresh.bikeMassKg).toBe(TT_BASELINE_BIKE_MASS_KG)
  })

  it('the solved TT baseline predicts the 150 W gaps it was never fitted to (validates the CdA/mass split)', () => {
    // Two unknowns from two 300 W equations can always close; only a second
    // power tells whether the split between aero and mass is right. The old
    // 16 kg anchor predicted -332 s/h on the Alpe at 150 W against a
    // measured -84.
    const measured = ttBaselineMeasuredGap('at150W')
    const delta = { cdaDeltaM2: TT_BASELINE_CDA_M2 - STANDARD_BASELINE_CDA_M2, bikeMassDeltaKg: TT_BASELINE_BIKE_MASS_KG - STANDARD_BASELINE_BIKE_MASS_KG, crrDelta: 0 }
    const flat = forwardGapAtPower(delta, EQUIPMENT_FLAT_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG, 150)
    const climb = forwardGapAtPower(delta, EQUIPMENT_CLIMB_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG, 150)
    expect(Math.abs(flat - measured.flatGapSec), `flat ${flat.toFixed(1)} vs ${measured.flatGapSec.toFixed(1)}`).toBeLessThan(5)
    expect(Math.abs(climb - measured.climbGapSec), `climb ${climb.toFixed(1)} vs ${measured.climbGapSec.toFixed(1)}`).toBeLessThan(5)
  })

  it('a TT frame\'s gap over the STANDARD baseline is its own TT gap compounded with the baseline gap', () => {
    // The two tables share one gap definition (speed ratios), so a TT frame's
    // standing against the Zwift Carbon follows from its TT_FRAME_SPEED_DATA
    // row and the measured baseline gap alone - no anchor to tune. This is
    // what the old "~223 s/h for the Speedmax CFR" pin was standing in for.
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
    const ownGap = TT_FRAME_SPEED_DATA['Canyon Speedmax CFR']!.flatGapSec5
    const baselineGap = ttBaselineMeasuredGap('at300W').flatGapSec
    const expected = 3600 * (1 - (1 - baselineGap / 3600) * (1 - ownGap / 3600))
    expect(Math.abs(gapSec - expected), `${gapSec.toFixed(1)} vs ${expected.toFixed(1)}`).toBeLessThan(1)
    // Still comfortably past the Tron's published 114.6 s/h.
    expect(gapSec).toBeGreaterThan(114.6)
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

describe('the 300 W-solved deltas predict measurements they were never fitted to (issue #168)', () => {
  // Two unknowns fitted to two 300 W equations always close (the round-trip
  // suite above), so only a held-out measurement can say whether the split
  // between CdA and mass is right. The sheet's 150 W rows and its
  // wheel-on-Zwift-TT rows are that measurement: imported into `at150W` /
  // `onTtFrame` by scripts/zwiftinsider/import-validation-gaps.mjs and read
  // by nothing but this block.
  const VALIDATION_POWER_W = 150
  // The bar the TT-baseline 150 W test above already uses. At import
  // (2026-09-03) the 212 frame rows sat at median 0.5 / 0.9 s/h (flat /
  // climb) and p90 1.2 / 1.9, but the sheet's own baseline-era drift puts
  // ~4-5 s/h of noise on some rows (see the importer's header), so 5 is not
  // a tight bound - the median assertion is what catches a systematic drift.
  const GAP_TOLERANCE_150W_SEC = 5
  const MEDIAN_RESIDUAL_150W_SEC = 1.5
  // Wheels on the TT frame at 300 W: median 0.3 flat / 1.1 climb, p90 1.5 / 2.1 at import.
  const TT_WHEEL_GAP_TOLERANCE_SEC = 3
  const RATCHET_SLACK_SEC = 1

  // Road-table frames the bot tested on Zwift Gravel / MTB wheels (the
  // sheet's Wheels column). Their penalty on tarmac is rolling resistance,
  // which the two-lever solve had to launder into CdA and mass; that
  // transfers wrongly to 150 W, where aero matters less and Crr more. Pinned
  // as |predicted - measured| at import, not tolerated: a residual may only
  // shrink, and the entry goes when a Crr lever for these frames lands.
  const KNOWN_150W_MODEL_GAPS: Record<string, { flat0: number, climb0: number, flat5: number, climb5: number }> = {
    'Allied Able': { flat0: 97.1, climb0: 14.9, flat5: 95.1, climb5: 15.2 },
    'Canyon Inflite': { flat0: 97.9, climb0: 15.5, flat5: 96.1, climb5: 16.7 },
    'Canyon Lux': { flat0: 125.5, climb0: 16.0, flat5: 125.5, climb5: 17.7 }
  }
  // Its 300 W road row (31.8 flat) disagrees with both its 150 W row (40.7)
  // and its TT-frame row (45.5) - a stale sheet row, not a model gap.
  // Excluded pending the drift audit.
  const KNOWN_WHEEL_DATA_GAPS = new Set(['Cadex Max 50'])
  // `DISC_RE` classes these Zwift novelty wheels as `disc`, so the app
  // credits them the TT-frame disc residual - but the sheet's TT rows show
  // they get none of it (~10 s/h over-credited on a TT frame). The real
  // disc wheels (DICUT DISC, Blur, C99, HADRON Disc, Super9) all sit within
  // 2 s/h. Follow-up: solve each wheel's TT residual from its own
  // `onTtFrame` row instead of one reference-disc residual.
  const KNOWN_TT_WHEEL_MODEL_GAPS = new Set(['Zwift Groovy Time Trial Wheels', 'Zwift Supersonic Wheelset', 'Zwift Tri Spoke // Disc Wheel'])

  const median = (values: number[]) => {
    const sorted = values.map(Math.abs).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]!
  }

  it('every frame with a 150 W row, at stage 0 and stage 5', () => {
    const drift: string[] = []
    const stale: string[] = []
    const residuals = { flat: [] as number[], climb: [] as number[] }
    for (const [table, isTT] of [[FRAME_SPEED_DATA, false], [TT_FRAME_SPEED_DATA, true]] as const) {
      const baselineCdaM2 = isTT ? TT_BASELINE_CDA_M2 : STANDARD_BASELINE_CDA_M2
      const baselineBikeMassKg = isTT ? TT_BASELINE_BIKE_MASS_KG : STANDARD_BASELINE_BIKE_MASS_KG
      for (const [name, sample] of Object.entries(table)) {
        if (!sample.at150W) continue
        for (const [level, flatGapSec, climbGapSec] of [[0, sample.at150W.flatGapSec0, sample.at150W.climbGapSec0], [5, sample.at150W.flatGapSec5, sample.at150W.climbGapSec5]] as const) {
          const delta = precomputedFrameDelta(name, level, isTT)
          const flat = forwardGapAtPower(delta, EQUIPMENT_FLAT_TEST_GRADE, baselineCdaM2, baselineBikeMassKg, VALIDATION_POWER_W) - flatGapSec
          const climb = forwardGapAtPower(delta, EQUIPMENT_CLIMB_TEST_GRADE, baselineCdaM2, baselineBikeMassKg, VALIDATION_POWER_W) - climbGapSec
          residuals.flat.push(flat)
          residuals.climb.push(climb)
          const pinned = KNOWN_150W_MODEL_GAPS[name]
          if (pinned) {
            const [flatPin, climbPin] = level === 0 ? [pinned.flat0, pinned.climb0] : [pinned.flat5, pinned.climb5]
            if (Math.abs(flat) > flatPin + RATCHET_SLACK_SEC || Math.abs(climb) > climbPin + RATCHET_SLACK_SEC) drift.push(`${name} L${level} (pinned): flat ${flat.toFixed(1)} vs pin ${flatPin}, climb ${climb.toFixed(1)} vs pin ${climbPin}`)
            if (Math.abs(flat) <= GAP_TOLERANCE_150W_SEC && Math.abs(climb) <= GAP_TOLERANCE_150W_SEC) stale.push(`${name} L${level}`)
            continue
          }
          if (Math.abs(flat) > GAP_TOLERANCE_150W_SEC) drift.push(`${name} L${level} flat: ${flat.toFixed(1)} s/h off the measured ${flatGapSec}`)
          if (Math.abs(climb) > GAP_TOLERANCE_150W_SEC) drift.push(`${name} L${level} climb: ${climb.toFixed(1)} s/h off the measured ${climbGapSec}`)
        }
      }
    }
    expect(drift).toEqual([])
    expect(stale, 'now within tolerance - remove from KNOWN_150W_MODEL_GAPS').toEqual([])
    expect(median(residuals.flat), 'flat median residual').toBeLessThanOrEqual(MEDIAN_RESIDUAL_150W_SEC)
    expect(median(residuals.climb), 'climb median residual').toBeLessThanOrEqual(MEDIAN_RESIDUAL_150W_SEC)
  })

  it('every wheel with a 150 W row', () => {
    const drift: string[] = []
    const stale: string[] = []
    for (const [name, sample] of Object.entries(WHEEL_SPEED_DATA)) {
      if (!sample.at150W) continue
      const delta = precomputedWheelDelta(name)
      const flat = forwardGapAtPower(delta, EQUIPMENT_FLAT_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG, VALIDATION_POWER_W) - sample.at150W.flatGapSec
      const climb = forwardGapAtPower(delta, EQUIPMENT_CLIMB_TEST_GRADE, STANDARD_BASELINE_CDA_M2, STANDARD_BASELINE_BIKE_MASS_KG, VALIDATION_POWER_W) - sample.at150W.climbGapSec
      const outside = Math.abs(flat) > GAP_TOLERANCE_150W_SEC || Math.abs(climb) > GAP_TOLERANCE_150W_SEC
      if (KNOWN_WHEEL_DATA_GAPS.has(name)) {
        if (!outside) stale.push(name)
        continue
      }
      if (outside) drift.push(`${name}: flat ${flat.toFixed(1)}, climb ${climb.toFixed(1)} s/h off the measured ${sample.at150W.flatGapSec} / ${sample.at150W.climbGapSec}`)
    }
    expect(drift).toEqual([])
    expect(stale, 'now within tolerance - remove from KNOWN_WHEEL_DATA_GAPS').toEqual([])
  })

  it('every wheel with a Zwift TT row: the road-solved delta, plus the disc residual, transfers to the TT baseline', () => {
    // This is exactly what `equipmentPhysics` does for a TT combo, checked
    // against 64 wheels the sheet actually rode on the Zwift TT instead of
    // the one reference disc the residual was solved from.
    const drift: string[] = []
    const stale: string[] = []
    for (const [name, sample] of Object.entries(WHEEL_SPEED_DATA)) {
      if (!sample.onTtFrame) continue
      const road = precomputedWheelDelta(name)
      const isDisc = classifyWheelCategory(name).category === 'disc'
      const delta = isDisc ? { ...road, cdaDeltaM2: road.cdaDeltaM2 + PRECOMPUTED_TT_DISC_RESIDUAL_CDA_DELTA_M2 } : road
      const flat = forwardGapAtPower(delta, EQUIPMENT_FLAT_TEST_GRADE, TT_BASELINE_CDA_M2, TT_BASELINE_BIKE_MASS_KG) - sample.onTtFrame.flatGapSec
      const climb = forwardGapAtPower(delta, EQUIPMENT_CLIMB_TEST_GRADE, TT_BASELINE_CDA_M2, TT_BASELINE_BIKE_MASS_KG) - sample.onTtFrame.climbGapSec
      const outside = Math.abs(flat) > TT_WHEEL_GAP_TOLERANCE_SEC || Math.abs(climb) > TT_WHEEL_GAP_TOLERANCE_SEC
      if (KNOWN_WHEEL_DATA_GAPS.has(name) || KNOWN_TT_WHEEL_MODEL_GAPS.has(name)) {
        if (!outside) stale.push(name)
        continue
      }
      if (outside) drift.push(`${name}${isDisc ? ' (disc)' : ''}: flat ${flat.toFixed(1)}, climb ${climb.toFixed(1)} s/h off the measured ${sample.onTtFrame.flatGapSec} / ${sample.onTtFrame.climbGapSec}`)
    }
    expect(drift).toEqual([])
    expect(stale, 'now within tolerance - remove from the known-gap set').toEqual([])
  })

  it('validation coverage never shrinks', () => {
    // Same ratchet as the stage-curve one in classifyBikeFrame.test.ts: a
    // new bike without a 150 W row is fine, existing blocks silently
    // disappearing is not. Counts at import (2026-09-03): 105 frame rows
    // (106 counted, the Golden Concept Z1 sharing the Tron's sample), 65
    // wheels at 150 W, 64 on the Zwift TT. Bump when the importer brings in
    // more; never down.
    const frames = [...Object.values(FRAME_SPEED_DATA), ...Object.values(TT_FRAME_SPEED_DATA)].filter(sample => sample.at150W)
    expect(frames.length).toBeGreaterThanOrEqual(106)
    const wheels = Object.values(WHEEL_SPEED_DATA)
    expect(wheels.filter(sample => sample.at150W).length).toBeGreaterThanOrEqual(65)
    expect(wheels.filter(sample => sample.onTtFrame).length).toBeGreaterThanOrEqual(64)
  })
})
