import { describe, expect, it } from 'vitest'
import { bikeFrames } from 'zwift-data'
import type { RouteGeometry, RouteGeometryPoint, RouteSurfaceSegment } from '../../types/physics'
import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset } from '../../types/catalog'
import { FRAME_SPEED_DATA } from '../../data/frameSpeedData'
import { SURFACE_CRR } from '../../data/surfaceCrr'
import { classifyBikeFrame } from '../classifyBikeFrame'
import { estimateFinishTimeSec } from '../finishTime'
import { getWheelsets } from '../wheelsets'
import { equipmentPhysics, riderScaledCdaM2 } from './equipment'
import { speedForPower } from './forces'
import { geometryFromRoute, RouteSimulationStallError, simulateRoute } from './simulator'
import { confirmWheelPicks, WHEEL_PICK_CONFIRM_DEPTH, orderBySimulatedTime, SIMULATED_ORDER_MARGIN } from './simulatedOrdering'

const RIDER = { weightKg: 75, heightCm: 183, powerW: 300 }

function geometry(points: RouteGeometryPoint[], surfaceSegments?: RouteSurfaceSegment[]): RouteGeometry {
  const totalDistanceM = points[points.length - 1]!.distanceM
  return {
    routeSlug: 'test-geometry',
    points,
    surfaceSegments: surfaceSegments ?? [{ fromM: 0, toM: totalDistanceM, surface: 'tarmac' }],
    totalDistanceM
  }
}

const frame = () => classifyBikeFrame(bikeFrames.find(f => f.name === 'Zwift Carbon')!, 0)
const wheelset = () => getWheelsets().find(w => w.name === 'Zwift 32mm Carbon')!

/** The closed-form steady-state speed for the same equipment the simulator will derive internally. */
function closedFormSteadySpeed(grade: number): number {
  const physics = equipmentPhysics(frame(), wheelset())
  const cda = riderScaledCdaM2(physics.cdaM2, RIDER.heightCm, RIDER.weightKg)
  const crr = Math.max(0, SURFACE_CRR.tarmac.road! + (physics.crrDelta ?? 0))
  return speedForPower(RIDER.powerW, RIDER.weightKg + physics.bikeMassKg, grade, crr, cda)
}

describe('simulator vs closed-form model consistency', () => {
  // The recommend pipeline depends on the two models agreeing: the cheap
  // estimate is the ranking key, the simulator produces the displayed times,
  // and both read `equipmentPhysics`/`riderScaledCdaM2` so they "never
  // disagree about what a combo's CdA/mass actually are". On a constant
  // grade the step-integrated simulator must therefore converge to the
  // closed-form `speedForPower` solution.
  it.each([
    ['flat', geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 20000, elevationM: 30 }]), 30 / 20000],
    ['climb', geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 12400, elevationM: 1036 }]), 1036 / 12400]
  ])('converges to the closed-form steady state on a constant %s grade', (_label, testGeometry, grade) => {
    const steady = closedFormSteadySpeed(grade)
    const result = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: testGeometry, initialSpeedMps: steady })
    expect(Math.abs(result.finalSpeedMps - steady)).toBeLessThan(0.05)
    const closedFormSec = testGeometry.totalDistanceM / steady
    expect(Math.abs(result.elapsedSec / closedFormSec - 1)).toBeLessThan(0.002)
  })

  it('a standing start costs real but bounded extra time over a rolling start', () => {
    const flat = geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 20000, elevationM: 30 }])
    const steady = closedFormSteadySpeed(30 / 20000)
    const rolling = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat, initialSpeedMps: steady })
    const standing = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat })
    expect(standing.elapsedSec).toBeGreaterThan(rolling.elapsedSec)
    expect(standing.elapsedSec - rolling.elapsedSec).toBeLessThan(120)
  })
})

describe('simulator mechanics', () => {
  const flat = geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 20000, elevationM: 30 }])

  it('finishes exactly at the route distance', () => {
    const result = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat })
    expect(result.distanceM).toBe(flat.totalDistanceM)
    expect(result.elapsedSec).toBeGreaterThan(0)
  })

  it('records boundary crossings in order, at increasing times, consistent with the average pace', () => {
    const boundariesM = [5000, 10000, 15000]
    const steady = closedFormSteadySpeed(30 / 20000)
    const result = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat, initialSpeedMps: steady, boundariesM })
    expect(result.boundaryCrossings?.map(c => c.distanceM)).toEqual(boundariesM)
    const times = result.boundaryCrossings!.map(c => c.elapsedSec)
    expect(times[0]).toBeLessThan(times[1]!)
    expect(times[1]).toBeLessThan(times[2]!)
    expect(times[2]).toBeLessThan(result.elapsedSec)
    expect(Math.abs(times[1]! / (10000 / steady) - 1)).toBeLessThan(0.01)
  })

  it('a rougher surface under road wheels costs time (dirt Crr > tarmac Crr)', () => {
    const paved = geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 5000, elevationM: 7.5 }, { distanceM: 10000, elevationM: 15 }])
    const halfDirt = geometry(
      [{ distanceM: 0, elevationM: 0 }, { distanceM: 5000, elevationM: 7.5 }, { distanceM: 10000, elevationM: 15 }],
      [{ fromM: 0, toM: 5000, surface: 'tarmac' }, { fromM: 5000, toM: 10000, surface: 'dirt' }]
    )
    const pavedSec = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: paved }).elapsedSec
    const dirtSec = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: halfDirt }).elapsedSec
    expect(dirtSec).toBeGreaterThan(pavedSec)
  })

  // Issue #124's regression tests: the steady-state early exit must not
  // extrapolate across a surface join still ahead. A 2-point elevation
  // profile (what `geometryForSegment` builds, with `prependWarmup`
  // delivering the rider already at steady speed) is the vulnerable shape -
  // before the fix, 5km of dirt here cost exactly nothing.
  it('the steady-state early exit accounts for surface changes on a 2-point elevation profile', () => {
    const paved = geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 10000, elevationM: 15 }])
    const halfDirt = geometry(
      [{ distanceM: 0, elevationM: 0 }, { distanceM: 10000, elevationM: 15 }],
      [{ fromM: 0, toM: 5000, surface: 'tarmac' }, { fromM: 5000, toM: 10000, surface: 'dirt' }]
    )
    const pavedSec = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: paved }).elapsedSec
    const dirtSec = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: halfDirt }).elapsedSec
    expect(dirtSec).toBeGreaterThan(pavedSec)
  })

  it('a sparse multi-surface geometry agrees with its dense (grade knots at every join) twin', () => {
    // The property the #124 fix restores. The dense twin defeats the early
    // exit's grade guard on every interior stretch, so it always integrates
    // through every surface - the sparse geometry must reach the same answer.
    // Surfaces mirror the real Alpe segment shape that exposed the bug
    // (short tarmac, wood, long dirt, long tarmac finish), on a climb grade.
    const surfaces: RouteSurfaceSegment[] = [
      { fromM: 0, toM: 300, surface: 'tarmac' },
      { fromM: 300, toM: 400, surface: 'wood' },
      { fromM: 400, toM: 1900, surface: 'dirt' },
      { fromM: 1900, toM: 12000, surface: 'tarmac' }
    ]
    const grade = 1000 / 12000
    const sparse = geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 12000, elevationM: 1000 }], surfaces)
    const densePoints = [0, 300, 400, 1900, 12000].map(d => ({ distanceM: d, elevationM: grade * d }))
    const dense = geometry(densePoints, surfaces)
    const sparseSec = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: sparse }).elapsedSec
    const denseSec = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: dense }).elapsedSec
    expect(Math.abs(sparseSec - denseSec)).toBeLessThan(0.5)
  })

  it('power overrides change the outcome only when they change the power', () => {
    const base = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat })
    const samePower = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat, powerSegmentsW: [{ fromM: 2000, toM: 4000, powerW: RIDER.powerW }] })
    const morePower = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat, powerSegmentsW: [{ fromM: 2000, toM: 4000, powerW: 500 }] })
    // Not exactly equal on purpose: the presence of override segments defers
    // the steady-state early exit past the last boundary, shifting the
    // extrapolation approximation by a few seconds on a long flat.
    expect(Math.abs(samePower.elapsedSec / base.elapsedSec - 1)).toBeLessThan(0.005)
    expect(morePower.elapsedSec).toBeLessThan(base.elapsedSec)
  })

  it('speed-dependent power scaling behaves the same way', () => {
    const base = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat })
    const unscaled = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat, powerScaleAtSpeed: () => 1 })
    const boosted = simulateRoute({ rider: RIDER, frame: frame(), wheelset: wheelset(), geometry: flat, powerScaleAtSpeed: () => 1.2 })
    expect(unscaled.elapsedSec).toBeCloseTo(base.elapsedSec, 6)
    expect(boosted.elapsedSec).toBeLessThan(base.elapsedSec)
  })

  it('throws, rather than returning one dt as the finish time, when the rider stalls', () => {
    // 200 kg at 9 W is inside `RIDER_BOUNDS`. On a 10% grade the net force is
    // negative from the startup speed, so the old `break` returned
    // `elapsedSec` of a single step - and that combo ranked fastest.
    const steep = geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 1000, elevationM: 100 }])
    const stalled = () => simulateRoute({ geometry: steep, rider: { weightKg: 200, heightCm: 175, powerW: 9 }, frame: frame(), wheelset: wheelset() })
    expect(stalled).toThrow(RouteSimulationStallError)
    expect(stalled).toThrow(/stalled on a 10\.0% grade/)
    // The same rider on the flat is merely slow, and finishes.
    const flat = geometry([{ distanceM: 0, elevationM: 0 }, { distanceM: 1000, elevationM: 0 }])
    const result = simulateRoute({ geometry: flat, rider: { weightKg: 200, heightCm: 175, powerW: 9 }, frame: frame(), wheelset: wheelset() })
    expect(result.distanceM).toBeCloseTo(1000, 3)
    expect(result.elapsedSec).toBeGreaterThan(600)
  })

  it('rejects a non-positive step and degenerate geometry', () => {
    expect(() => simulateRoute({ rider: RIDER, frame: frame(), geometry: flat, dtSec: 0 })).toThrow()
    expect(() => simulateRoute({ rider: RIDER, frame: frame(), geometry: geometry([{ distanceM: 0, elevationM: 0 }]) })).toThrow()
  })
})

describe('geometryFromRoute', () => {
  it('builds a two-point geometry carrying the whole surface mix, in share order (issue #172)', () => {
    // Not just the dominant surface: a 60/40 route ridden as 100% dirt is a
    // route this simulator and `estimateFinishTimeSec`, which blends Crr
    // across the same composition, would rank differently for no reason.
    const withDirt = geometryFromRoute({ slug: 'x', distance: 5, elevation: 50, surface: { composition: { dirt: 60, tarmac: 40 } } } as unknown as RouteWithMeta)
    expect(withDirt.points).toEqual([{ distanceM: 0, elevationM: 0 }, { distanceM: 5000, elevationM: 50 }])
    expect(withDirt.surfaceSegments).toEqual([
      { fromM: 0, toM: 3000, surface: 'dirt' },
      { fromM: 3000, toM: 5000, surface: 'tarmac' }
    ])
  })

  it('defaults to one tarmac block when nothing is known about the surface', () => {
    const plain = geometryFromRoute({ slug: 'x', distance: 5, elevation: 50, surface: {} } as unknown as RouteWithMeta)
    expect(plain.surfaceSegments).toEqual([{ fromM: 0, toM: 5000, surface: 'tarmac' }])
  })
})

describe('orderBySimulatedTime', () => {
  const combos = () => {
    const w = wheelset()
    const measured = bikeFrames.filter(f => FRAME_SPEED_DATA[f.name]).slice(0, 4)
    return measured.map((f) => {
      const classified = classifyBikeFrame(f, 5)
      return { frame: classified, wheelset: classified.hasFixedWheels ? undefined : w }
    })
  }

  it('re-orders only the window and leaves the tail untouched', () => {
    const pool = combos()
    // Fake times reversing the window's order; the 4th combo is past the window.
    const fakeSec = new Map(pool.map((combo, index) => [combo, 100 - index]))
    const { ordered, simulatedSec } = orderBySimulatedTime(pool, 3, combo => fakeSec.get(combo)!)
    expect(ordered.slice(0, 3)).toEqual([pool[2], pool[1], pool[0]])
    expect(ordered[3]).toBe(pool[3])
    expect(simulatedSec.size).toBe(3)
  })

  it('simulates physically identical combos once and shares the time', () => {
    const [a] = combos()
    const twin = { ...a! }
    let calls = 0
    const { simulatedSec } = orderBySimulatedTime([a!, twin], 2, () => {
      calls++
      return 42
    })
    expect(calls).toBe(1)
    expect(simulatedSec.get(a!)).toBe(42)
    expect(simulatedSec.get(twin)).toBe(42)
  })
})

describe('confirmWheelPicks', () => {
  // A frame with several wheels, as the pool reaches the page: ordered by the
  // ESTIMATE, which is the whole reason this step exists.
  const frame = { id: 1 } as ClassifiedBikeFrame
  const otherFrame = { id: 2 } as ClassifiedBikeFrame
  const row = (f: ClassifiedBikeFrame, key: string, est: number) => ({ frame: f, wheelset: { key } as Wheelset, est })
  const pool = [
    row(frame, 'w1', 10), row(frame, 'w2', 11), row(frame, 'w3', 12), row(frame, 'w4', 13),
    row(otherFrame, 'x1', 20)
  ]

  it('swaps in the wheel the simulator prefers over the one the estimate picked', () => {
    const simulated: Record<string, number> = { w1: 100, w2: 97, w3: 99, w4: 101 }
    const [pick] = confirmWheelPicks({
      page: [pool[0]!],
      pool,
      currentSec: () => 100,
      valueOf: combo => combo.est,
      simulate: combo => simulated[combo.wheelset!.key]!
    })
    expect(pick!.row.wheelset!.key).toBe('w2')
    expect(pick!.seconds).toBe(97)
  })

  it('leaves the row alone when the estimate already had it right', () => {
    const simulated: Record<string, number> = { w1: 90, w2: 97, w3: 99, w4: 101 }
    const [pick] = confirmWheelPicks({
      page: [pool[0]!],
      pool,
      currentSec: () => 90,
      valueOf: combo => combo.est,
      simulate: combo => simulated[combo.wheelset!.key]!
    })
    expect(pick!.row).toBe(pool[0])
    expect(pick!.seconds).toBe(90)
  })

  it('only ever considers the row\'s own frame', () => {
    const seen: string[] = []
    confirmWheelPicks({
      page: [pool[0]!],
      pool,
      currentSec: () => 100,
      valueOf: combo => combo.est,
      simulate: (combo) => {
        seen.push(combo.wheelset!.key)
        return 100
      }
    })
    expect(seen).not.toContain('x1')
  })

  it('collapses estimate ties instead of spending an integration to rediscover them', () => {
    const tied = [row(frame, 'w1', 10), row(frame, 'w2', 10), row(frame, 'w3', 12)]
    const seen: string[] = []
    confirmWheelPicks({
      page: [tied[0]!],
      pool: tied,
      currentSec: () => 100,
      valueOf: combo => combo.est,
      simulate: (combo) => {
        seen.push(combo.wheelset!.key)
        return 100
      }
    })
    expect(seen).toEqual(['w3'])
  })

  it('reuses times the ordering pass already computed', () => {
    let calls = 0
    const [pick] = confirmWheelPicks({
      page: [pool[0]!],
      pool,
      currentSec: () => 100,
      valueOf: combo => combo.est,
      alreadySimulated: new Map(pool.map(combo => [combo, combo.wheelset!.key === 'w3' ? 95 : 100])),
      simulate: () => {
        calls++
        return 100
      }
    })
    expect(calls).toBe(0)
    expect(pick!.row.wheelset!.key).toBe('w3')
  })

  it('never looks deeper than WHEEL_PICK_CONFIRM_DEPTH candidates per frame', () => {
    const deep = Array.from({ length: 12 }, (_, i) => row(frame, `w${i}`, i))
    const seen: string[] = []
    confirmWheelPicks({
      page: [deep[0]!],
      pool: deep,
      currentSec: () => 100,
      valueOf: combo => combo.est,
      simulate: (combo) => {
        seen.push(combo.wheelset!.key)
        return 100
      }
    })
    // The page row itself is one of the candidates and is skipped, not simulated.
    expect(seen).toHaveLength(WHEEL_PICK_CONFIRM_DEPTH - 1)
  })
})

describe('SIMULATED_ORDER_MARGIN holds on a rolling course', () => {
  // The recommend endpoints rank the pool by the cheap estimate and
  // re-simulate only `offset + limit + SIMULATED_ORDER_MARGIN` combos. That
  // is only correct if the simulator's true first page never sits deeper in
  // the estimate ordering than the window reaches. A rolling course is the
  // adversarial case: the estimate applies the average grade uniformly,
  // never crediting descents, so it overweights mass exactly there.
  it('the true top 9 by simulated time sit inside the first 9 + margin of the estimate ordering', () => {
    const rollingGeometry = geometry([
      { distanceM: 0, elevationM: 0 },
      { distanceM: 1000, elevationM: 40 },
      { distanceM: 2000, elevationM: 0 },
      { distanceM: 3000, elevationM: 40 },
      { distanceM: 4000, elevationM: 0 },
      { distanceM: 5000, elevationM: 40 },
      { distanceM: 6000, elevationM: 0 }
    ])
    const rollingRoute = {
      slug: 'rolling-test',
      distance: 6,
      elevation: 120,
      lap: true,
      terrain: { climbRatio: 20, category: 'hilly', weights: { aero: 0.4, climb: 0.6, gravel: 0, cobble: 0 }, climbs: [] },
      surface: { road: 100, gravel: 0, cobble: 0, composition: { tarmac: 100 }, confidence: 'measured' }
    } as unknown as RouteWithMeta

    const w = wheelset()
    const pool = bikeFrames
      .filter(f => FRAME_SPEED_DATA[f.name])
      .map((f) => {
        const classified = classifyBikeFrame(f, 5)
        return { frame: classified, wheelset: (classified.hasFixedWheels ? undefined : w) as Wheelset | undefined }
      })

    const byEstimate = [...pool].sort((a, b) =>
      estimateFinishTimeSec(rollingRoute, a.frame, a.wheelset, 75, 183, 300)
      - estimateFinishTimeSec(rollingRoute, b.frame, b.wheelset, 75, 183, 300))
    const simulatedSec = new Map(pool.map(combo => [combo, simulateRoute({
      rider: { weightKg: 75, heightCm: 183, powerW: 300 },
      frame: combo.frame,
      wheelset: combo.wheelset,
      geometry: rollingGeometry
    }).elapsedSec]))
    const bySimulation = [...pool].sort((a, b) => simulatedSec.get(a)! - simulatedSec.get(b)!)

    const pageSize = 9
    const windowSize = pageSize + SIMULATED_ORDER_MARGIN
    const tooDeep = bySimulation.slice(0, pageSize)
      .map(combo => ({ name: combo.frame.name, estimateRank: byEstimate.indexOf(combo) }))
      .filter(({ estimateRank }) => estimateRank >= windowSize)
    expect(tooDeep).toEqual([])
  })
})
