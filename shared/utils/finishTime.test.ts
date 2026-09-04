import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import type { RouteWithMeta } from '../types/catalog'
import { classifyBikeFrame } from './classifyBikeFrame'
import { estimateFinishTimeSec, estimateSurfaceTimePenaltySec } from './finishTime'
import { getWheelsets } from './wheelsets'
import { MAX_LAPS } from './routeLaps'

// ZwiftInsider's bot-test protocol: 75kg/183cm rider at 300W (4 W/kg).
const RIDER = { weightKg: 75, heightCm: 183, powerW: 300 } as const

function testRoute(overrides: Partial<RouteWithMeta> & { distance: number, elevation: number }): RouteWithMeta {
  const climbRatio = overrides.elevation / overrides.distance
  return {
    world: 'watopia',
    worldName: 'Watopia',
    name: 'Test Route',
    slug: 'test-route',
    segments: [],
    segmentsOnRoute: [],
    sports: ['cycling'],
    eventOnly: false,
    levelLocked: false,
    lap: true,
    supportsTT: true,
    supportsMeetups: true,
    terrain: { climbRatio, category: 'flat', weights: { aero: 0.8, climb: 0.2, gravel: 0, cobble: 0 }, climbs: [], sprints: [] },
    surface: { road: 100, gravel: 0, cobble: 0, composition: { tarmac: 100 }, confidence: 'measured' },
    ...overrides
  }
}

// The two bot-test courses, as routes.
const FLAT_BOT_COURSE = testRoute({ distance: 17.231, elevation: 26 })
const CLIMB_BOT_COURSE = testRoute({ distance: 12.4, elevation: 1036 })

const frameByName = (name: string) => {
  const frame = bikeFrames.find(f => f.name === name)
  expect(frame, `zwift-data no longer has a frame named "${name}"`).toBeDefined()
  return frame!
}

const wheelsetByName = (name: string) => {
  const wheelset = getWheelsets().find(w => w.name === name)
  expect(wheelset, `no wheelset named "${name}"`).toBeDefined()
  return wheelset!
}

const baselineFrame = () => classifyBikeFrame(frameByName('Zwift Carbon'), 0)
const baselineWheels = () => wheelsetByName('Zwift 32mm Carbon')

describe('estimateFinishTimeSec against the bot-test protocol', () => {
  it('predicts a plausible baseline speed on the flat course', () => {
    const timeSec = estimateFinishTimeSec(FLAT_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    const kmh = FLAT_BOT_COURSE.distance / (timeSec / 3600)
    // Coarse envelope, not a golden value: catches unit-level breakage
    // (efficiency applied twice, CdA in cm², mass in grams) without pinning
    // the model's exact calibration.
    expect(kmh).toBeGreaterThan(34)
    expect(kmh).toBeLessThan(44)
  })

  it('reproduces the Tron bike\'s published ~114.6 s/h flat advantage end-to-end', () => {
    const tron = classifyBikeFrame(frameByName('Zwift Concept Z1'), 0)
    const baseTime = estimateFinishTimeSec(FLAT_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    const tronTime = estimateFinishTimeSec(FLAT_BOT_COURSE, tron, undefined, RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    const gapSecPerHour = 3600 * (1 - tronTime / baseTime)
    // Wider tolerance than the physics-level round-trip: this path scales
    // CdA to the rider's own frontal area (`riderScaledCdaM2`), which
    // perturbs the ratio slightly even at the bot rider's own measurements.
    expect(gapSecPerHour).toBeGreaterThan(110)
    expect(gapSecPerHour).toBeLessThan(120)
  })

  it('a fixed-wheel frame ignores whatever wheelset it is passed', () => {
    const tron = classifyBikeFrame(frameByName('Zwift Concept Z1'), 0)
    const withWheels = estimateFinishTimeSec(FLAT_BOT_COURSE, tron, baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    const withoutWheels = estimateFinishTimeSec(FLAT_BOT_COURSE, tron, undefined, RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    expect(withWheels).toBe(withoutWheels)
  })

  it('more sustained power is always faster', () => {
    const at225 = estimateFinishTimeSec(CLIMB_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, 225)
    const at300 = estimateFinishTimeSec(CLIMB_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, 300)
    expect(at300).toBeLessThan(at225)
  })

  it('finish time is strictly monotonic in power across the sliders\' full range', () => {
    // Guards against any hidden cap or discontinuity inside the range the
    // power sliders can actually set (100-1500 W): every extra watt must buy
    // time on every course shape and in every draft mode, or a slider stops
    // responding somewhere and the rankings above that point are stale.
    const frame = baselineFrame()
    const wheels = baselineWheels()
    for (const route of [FLAT_BOT_COURSE, CLIMB_BOT_COURSE]) {
      for (const draft of [undefined, { mode: 'race' as const }, { mode: 'ttt' as const, riders: 8 }]) {
        let previous = Number.POSITIVE_INFINITY
        for (let powerW = 100; powerW <= 1500; powerW += 25) {
          const timeSec = estimateFinishTimeSec(route, frame, wheels, RIDER.weightKg, RIDER.heightCm, powerW, 1, draft)
          expect(timeSec, `${route.distance} km route, draft ${draft?.mode ?? 'solo'}, ${powerW} W`).toBeLessThan(previous)
          previous = timeSec
        }
      }
    }
  })
})

describe('laps and lead-in', () => {
  const LEAD_IN_ROUTE = testRoute({ distance: 10, elevation: 50, leadInDistance: 2.5, leadInElevation: 40 })

  it('adds exactly one lap of time per extra lap (lead-in ridden once)', () => {
    const time = (laps: number) => estimateFinishTimeSec(LEAD_IN_ROUTE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW, laps)
    expect(time(2) - time(1)).toBeCloseTo(time(3) - time(2), 6)
    expect(time(2)).toBeGreaterThan(time(1))
  })

  it('counts the lead-in on top of the laps', () => {
    const noLeadIn = testRoute({ distance: 10, elevation: 50 })
    const withLeadIn = estimateFinishTimeSec(LEAD_IN_ROUTE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW, 1)
    const lapOnly = estimateFinishTimeSec(noLeadIn, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW, 1)
    expect(withLeadIn).toBeGreaterThan(lapOnly)
  })

  it('forces one lap on point-to-point routes and clamps at MAX_LAPS on lap routes', () => {
    const pointToPoint = testRoute({ distance: 10, elevation: 50, lap: false })
    const time = (route: RouteWithMeta, laps: number) => estimateFinishTimeSec(route, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW, laps)
    expect(time(pointToPoint, 5)).toBe(time(pointToPoint, 1))
    expect(time(LEAD_IN_ROUTE, 99)).toBe(time(LEAD_IN_ROUTE, MAX_LAPS))
  })
})

describe('surface time penalty', () => {
  const GRAVEL_ROUTE = testRoute({
    distance: 10,
    elevation: 50,
    surface: { road: 20, gravel: 80, cobble: 0, composition: { tarmac: 20, dirt: 80 }, confidence: 'measured' }
  })

  it('is zero on a fully paved route', () => {
    const penalty = estimateSurfaceTimePenaltySec(FLAT_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    expect(penalty).toBe(0)
  })

  it('an unmeasured lead-in is paved: it adds no surface penalty of its own', () => {
    // Start pens are tarmac, so without `leadInSegments` the lead-in must not
    // inherit the lap's dirt - the penalty with a lead-in equals the penalty
    // without one (see `leadInCrr` and `geometryForRouteLaps`).
    const withLeadIn = testRoute({ ...GRAVEL_ROUTE, leadInDistance: 3, leadInElevation: 20 })
    const lapOnly = estimateSurfaceTimePenaltySec(GRAVEL_ROUTE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    const leadIn = estimateSurfaceTimePenaltySec(withLeadIn, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    expect(lapOnly).toBeGreaterThan(0)
    expect(leadIn).toBeCloseTo(lapOnly, 6)
    // A measured lead-in keeps the lap blend and so does cost time.
    const measuredLeadIn = testRoute({
      ...withLeadIn,
      surface: { ...withLeadIn.surface, leadInSegments: [{ fromKm: 0, toKm: 3, type: 'dirt' }] }
    })
    expect(estimateSurfaceTimePenaltySec(measuredLeadIn, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)).toBeGreaterThan(lapOnly)
    // A world that is one surface end to end (Paris) has cobbled pens too,
    // so its lead-in keeps costing time.
    const parisLike = testRoute({
      ...withLeadIn,
      surface: { road: 0, gravel: 0, cobble: 100, composition: { cobbles: 100 }, confidence: 'measured' }
    })
    const parisLapOnly = testRoute({ ...parisLike, leadInDistance: undefined, leadInElevation: undefined })
    expect(estimateSurfaceTimePenaltySec(parisLike, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW))
      .toBeGreaterThan(estimateSurfaceTimePenaltySec(parisLapOnly, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW))
  })

  it('costs a road wheel real time on gravel, and a gravel wheel much less', () => {
    const gravelWheels = getWheelsets().find(w => w.crrClass === 'gravel')
    expect(gravelWheels).toBeDefined()
    const roadPenalty = estimateSurfaceTimePenaltySec(GRAVEL_ROUTE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    const gravelPenalty = estimateSurfaceTimePenaltySec(GRAVEL_ROUTE, baselineFrame(), gravelWheels!, RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    expect(roadPenalty).toBeGreaterThan(0)
    expect(gravelPenalty).toBeGreaterThan(0)
    expect(gravelPenalty).toBeLessThan(roadPenalty)
  })
})

describe('draft modes', () => {
  it('race draft and TTT paceline are both faster than riding solo, and a bigger team drafts better', () => {
    const solo = estimateFinishTimeSec(FLAT_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW)
    const race = estimateFinishTimeSec(FLAT_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW, 1, { mode: 'race' })
    const ttt4 = estimateFinishTimeSec(FLAT_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW, 1, { mode: 'ttt', riders: 4 })
    const ttt8 = estimateFinishTimeSec(FLAT_BOT_COURSE, baselineFrame(), baselineWheels(), RIDER.weightKg, RIDER.heightCm, RIDER.powerW, 1, { mode: 'ttt', riders: 8 })
    expect(race).toBeLessThan(solo)
    expect(ttt4).toBeLessThan(solo)
    expect(ttt8).toBeLessThan(ttt4)
  })
})
