import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { getFrames, getRouteBySlug } from '#shared/utils/catalog'
import { draftOf, resolveDraft, simulateRoute } from '#shared/utils/physics'
import { buildRacePlan } from '#shared/utils/physics/racePlan'
import { geometryForRouteLaps } from '#shared/utils/physics/routeGeometry'
import { rideForRoute, rideForSegment } from '#shared/utils/recommendRide'
import { getSegmentSummary, routeWithMetaForSegment } from '#shared/utils/routeSegments'
import { getWheelsets } from '#shared/utils/wheelsets'
import type { ComboScore } from '../../shared/types/catalog'
import type { RecommendRide } from '../../shared/types/recommendRide'
import type { AppliedRiderInputs } from '../utils/recommendRequest'
import { coveredSectors, tttPlanCoverage } from '../utils/tttPlan'
import { useTttPlan } from './useTttPlan'

beforeEach(() => {
  vi.stubGlobal('computed', computed)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const combo = {
  frame: getFrames().find(frame => frame.name === 'Zwift Carbon')!,
  wheelset: getWheelsets().find(wheelset => wheelset.name === 'Zwift 32mm Carbon')!
} as ComboScore
// The default rider, in a four-rider TTT with a team climb pace set, so the
// climb sectors are the resolved Draft's own pacing plan.
const rider: AppliedRiderInputs = {
  weightKg: 75, heightCm: 175, powerW: 225, draftMode: 'ttt', tttRiders: 4, tttClimbWkg: 3, category: 'all'
}

function planFor(ride: RecommendRide) {
  return useTttPlan({ ride: () => ride, combo: () => combo, rider: () => rider, loading: () => false }).value!
}

describe('useTttPlan', () => {
  describe('on a segment', () => {
    const alpe = routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!)

    it('flags the climb where the segment\'s times are simulated: on the segment itself, from its first metres', () => {
      const ride = rideForSegment(alpe)
      const [climb, ...rest] = planFor(ride).sectors
      expect(rest).toEqual([])
      expect(climb).toMatchObject({ type: 'climb', detail: '12.1 km at 8.5%, est. 1 h 8 min' })
      expect(climb!.fromKm).toBeCloseTo(0.022, 3)
      expect(climb!.toKm).toBeCloseTo(12.134, 3)
      expect(climb!.note).toContain('team climb pace of 3.0 W/kg')
    })

    it('reads the Ride\'s geometry, not the one `geometryForRouteLaps` would make of the same course', () => {
      // The same Alpe segment on a course record that also carries a 3 km
      // lead-in. A segment is timed from its own start, so `rideForSegment`
      // never rides one; `geometryForRouteLaps` would put it in front and move
      // the climb, and the draft's pacing plan with it, 3 km down the road.
      const withLeadIn = { ...alpe, leadInDistance: 3, leadInElevation: 0 }
      const ride = rideForSegment(withLeadIn)
      expect(geometryForRouteLaps(withLeadIn, 1).totalDistanceM).toBeCloseTo(ride.planGeometry().totalDistanceM + 3000, 6)

      const climb = planFor(ride).sectors.find(sector => sector.type === 'climb')!
      expect(climb.fromKm).toBeCloseTo(0.022, 3)
      expect(climb.toKm).toBeCloseTo(12.134, 3)
    })

    it('prices the sectors under the Draft the times are simulated with', () => {
      // The draft the server times the segment under, resolved on the
      // geometry its timed run is simulated over.
      const ride = rideForSegment(alpe)
      const draft = resolveDraft({ mode: 'ttt', riders: 4, climbWkg: 3 }, ride.planGeometry(), rider)
      const timed: Parameters<typeof simulateRoute>[0][] = []
      ride.prepare((options) => {
        timed.push(options)
        return simulateRoute(options)
      }, rider).timeCombo!({ ...combo, draft })
      const timedGeometry = timed.at(-1)!.geometry
      expect(timedGeometry).toBe(ride.planGeometry())

      const [block] = draft.plan!.blocks
      const [climb] = planFor(ride).sectors
      expect(climb!.fromKm).toBe(block!.fromM / 1000)
      expect(climb!.toKm).toBe(block!.toM / 1000)
      expect(climb!.toKm * 1000).toBeLessThanOrEqual(timedGeometry.totalDistanceM)
    })
  })

  describe('on a route or a race', () => {
    // What the plan was built from before issue #284: the route's laps
    // geometry, lead-in once, with the draft resolved on the same geometry.
    function routeLapsPlan(slug: string, laps: number) {
      const route = getRouteBySlug(slug)!
      const geometry = geometryForRouteLaps(route, laps)
      const sectors = buildRacePlan(geometry, {
        weightKg: rider.weightKg,
        heightCm: rider.heightCm,
        riderPowerW: rider.powerW,
        draft: resolveDraft(draftOf(rider), geometry, rider),
        frame: combo.frame,
        wheelset: combo.wheelset
      })
      return coveredSectors(sectors, tttPlanCoverage(route))
    }

    // A climb in the lead-in and on every lap, a long climb after a rough
    // lead-in, rough sectors behind an unmeasured lead-in, a rough
    // point-to-point route, and climbs over three laps. Lap counts a page can
    // ask for: `rideForRoute` clamps the laps to what the route allows, as
    // the server does, and the page's lap picker offers no more.
    it.each([['lutscher', 2], ['road-to-sky', 1], ['electric-break', 1], ['makuri-madness', 1], ['hilly-route', 3]] as const)('keeps %s over %i laps exactly as it was', (slug, laps) => {
      const sectors = planFor(rideForRoute(getRouteBySlug(slug)!, laps)).sectors
      expect(sectors.length).toBeGreaterThan(1)
      expect(sectors).toEqual(routeLapsPlan(slug, laps))
    })

    it('flags a lap\'s climb on every lap, after the lead-in', () => {
      const route = getRouteBySlug('road-to-sky')!
      const climbs = planFor(rideForRoute(route, 1)).sectors.filter(sector => sector.type === 'climb')
      expect(climbs.length).toBeGreaterThan(0)
      expect(climbs.at(-1)!.fromKm).toBeGreaterThan(route.leadInDistance ?? 0)
    })
  })

  it('has no plan outside TTT drafting, and no sectors until a setup is ranked', () => {
    const ride = rideForSegment(routeWithMetaForSegment(getSegmentSummary('alpe-du-zwift')!))
    expect(useTttPlan({ ride: () => ride, combo: () => combo, rider: () => ({ ...rider, draftMode: 'race' }), loading: () => false }).value).toBeUndefined()
    expect(useTttPlan({ ride: () => undefined, combo: () => combo, rider: () => rider, loading: () => false }).value).toBeUndefined()
    expect(useTttPlan({ ride: () => ride, combo: () => undefined, rider: () => rider, loading: () => true }).value)
      .toMatchObject({ sectors: [], hasSetup: false, loading: true, riders: 4, climbWkg: 3 })
  })
})
