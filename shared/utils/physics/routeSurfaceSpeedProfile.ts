import type { ClassifiedBikeFrame, RouteWithMeta, Wheelset, ZwiftSurfaceType } from '../../types/catalog'
import type { RouteGeometryPoint } from '../../types/physics'
import { SURFACE_CRR } from '../../data/surfaceCrr'
import { racePowerScaleAtSpeed, tttFrontPullPowerW, tttPowerPlan, tttPowerScaleAtSpeed } from './draft'
import { equipmentPhysics, riderScaledCdaM2 } from './equipment'
import { powerForSpeed } from './forces'
import { geometryForRouteLaps } from './routeGeometry'
import { simulateRoute } from './simulator'

export interface RouteSurfaceSpeedSegment {
  fromKm: number
  toKm: number
  surface: ZwiftSurfaceType
  avgSpeedKmh: number
  avgGradePercent: number
  /** Extra power (W) needed to hold this segment's own simulated pace on its real surface, vs. what tarmac would have needed at that same pace/grade. `0` on tarmac. */
  extraWattsVsTarmac: number
}

export interface RouteSurfaceSpeedSample {
  /** Midpoint distance (m) of the resampled bucket this sample represents. */
  distanceM: number
  avgSpeedKmh: number
}

export interface RouteSurfaceSpeedProfile {
  segments: RouteSurfaceSpeedSegment[]
  /**
   * Average speed (km/h) across the WHOLE simulated route (`result.distanceM
   * / result.elapsedSec`), not a per-segment figure - a route with one long,
   * steep climb (e.g. Accelerate to Elevate's embedded Alpe du Zwift) can
   * have most of its segments in the 30-40 km/h band while that one wide,
   * slow segment (~11 km/h at default power) dominates the visual chart -
   * this is the single headline number that isn't skewed by segment width.
   */
  overallAvgSpeedKmh: number
  /**
   * Speed vs. distance at a resolution driven by real grade changes as well
   * as surface changes, not just surface changes - `segments` remains the
   * right granularity for "which surface is where," but a single surface
   * segment (e.g. one long tarmac stretch) very often contains a real climb
   * or descent with nothing to do with a surface transition, and averaging
   * speed only at surface-segment granularity blends that climb's slowdown
   * into the whole stretch's average, making it disappear. This IS built
   * from a per-grade-point simulation internally, but resampled down to
   * `TARGET_SAMPLE_COUNT` even buckets via real distance/time-weighted
   * averaging (not a synthetic smoothing curve) before being returned -
   * one sample per grade point produced 100-300+ knots on a typical route,
   * which read as visual noise rather than a legible line. Bucketing
   * preserves genuine, sustained climbs/descents (almost always much
   * longer than a bucket) while averaging away sub-bucket wiggle.
   */
  speedSamples: RouteSurfaceSpeedSample[]
  /**
   * Elevation vs. distance for the exact same simulated geometry `segments`/
   * `speedSamples` are built from - use this for any elevation backdrop
   * rather than `route.terrain.elevationProfile` directly. The real GPS
   * trace backing that raw profile doesn't always cover the official
   * lead-in + lap distance exactly (occasionally by a wide margin, not just
   * the few-metres slop most routes have) - `geometryForRouteLaps` already
   * corrects for this by rescaling to fit, so a chart mixing the raw
   * (unscaled) profile with this module's (rescaled) speed data would
   * gradually drift apart over the course of the route, most visibly as
   * hills that appear to slow a rider down at the wrong position. Deriving
   * the backdrop from this same rescaled geometry instead makes the two
   * impossible to disagree.
   */
  elevationPoints: RouteGeometryPoint[]
  /**
   * Drafted modes only (TTT or race): the same rider, same power, same pacing,
   * riding the route alone with no draft - the dashed "if you rode this solo"
   * overlay. `speedSamples` share the main series' bucket positions so the two
   * lines are directly comparable, and the gap between them IS the draft
   * benefit. Present for exactly the modes whose headline time includes a
   * draft, so the chart and that time can never disagree.
   */
  soloComparison?: {
    speedSamples: RouteSurfaceSpeedSample[]
    overallAvgSpeedKmh: number
    /** TTT only: what the rider holds while pulling on the front - the concrete number a TTT calculator would give them. Race mode has no position, so no pull number exists. */
    frontPullPowerW?: number
  }
}

/** Elevation at `distanceM`, linearly interpolated between the two bracketing `points` - mirrors `gradeSegmentAt` in `simulator.ts` but returns elevation instead of local grade, since a surface segment can span several grade points. */
function elevationAt(points: RouteGeometryPoint[], distanceM: number): number {
  let low = 0
  let high = points.length - 1
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid]!.distanceM <= distanceM) low = mid
    else high = mid
  }
  const a = points[low]!
  const b = points[Math.min(low + 1, points.length - 1)]!
  const span = b.distanceM - a.distanceM
  const t = span > 0 ? (distanceM - a.distanceM) / span : 0
  return a.elevationM + t * (b.elevationM - a.elevationM)
}

/** Number of resampled points `speedSamples` targets, regardless of route length - see that field's doc comment. */
const TARGET_SAMPLE_COUNT = 60
/** Never resample to buckets narrower than this, so a short route/segment doesn't get over-fragmented. */
const MIN_SAMPLE_BUCKET_M = 100

/**
 * Elapsed time (s) at an arbitrary `distanceM`, linearly interpolated between
 * the two bracketing known `(distanceM, elapsedSec)` points - valid because
 * speed is treated as constant within any single simulated boundary
 * interval (the same assumption `crossBoundaries` in `simulator.ts` already
 * makes when placing a crossing inside one physics timestep).
 */
function interpolateTimeAt(points: { distanceM: number, elapsedSec: number }[], distanceM: number): number {
  let low = 0
  let high = points.length - 1
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid]!.distanceM <= distanceM) low = mid
    else high = mid
  }
  const a = points[low]!
  const b = points[Math.min(low + 1, points.length - 1)]!
  const span = b.distanceM - a.distanceM
  const t = span > 0 ? (distanceM - a.distanceM) / span : 0
  return a.elapsedSec + t * (b.elapsedSec - a.elapsedSec)
}

/**
 * Per-surface-segment average speed and extra rolling-resistance wattage
 * (vs. an equivalent tarmac stretch at the same pace/grade), plus a
 * resampled elevation-aware `speedSamples` series, for one specific frame+
 * wheelset combo - using the same dynamic per-timestep simulator
 * (`simulateRoute`) the recommend endpoint already trusts for finish times.
 *
 * Real surface transitions and real grade changes happen at independent
 * positions (see `RouteSurfaceSegment`'s own doc comment) - a single long
 * surface segment routinely contains a real climb or descent that has
 * nothing to do with a surface change. Simulating with `boundariesM` set to
 * only the surface joins (as an earlier version of this function did) would
 * average that climb's slowdown across the whole surface segment, making it
 * disappear from the output. Instead this simulates ONCE with `boundariesM`
 * set to the union of every real grade-change point (`geometry.points`,
 * the same knots `gradeSegmentAt` uses) and every surface join, then derives
 * both outputs from that single fine-grained result: `segments` by looking
 * up the exact elapsed time at each surface segment's own boundary (always
 * present, since it was part of the simulated boundary set), and
 * `speedSamples` by resampling to `TARGET_SAMPLE_COUNT` evenly-spaced
 * buckets via `interpolateTimeAt` - real distance/time-weighted averages
 * within each bucket, not per-grade-point-interval, which is too fine to
 * read as a legible line (100-300+ points on a typical route).
 *
 * Returns `undefined` for routes without both a real measured elevation
 * profile AND real position-tagged surface segments (see `SurfaceEstimate`'s
 * `confidence`) - there's no real per-segment granularity to show for a
 * route whose surface is only known as a whole-route percentage/heuristic.
 * This re-evaluates from live route data every call, so a route gains this
 * automatically once `route-surfaces:compute` produces real data for it.
 *
 * Always computed for a single lap, regardless of how many laps the route
 * itself supports - `RouteSurfaceSpeedProfile.vue` labels its output
 * "(per lap)" for lap-based routes so this stays clear to the reader,
 * rather than repeating the same per-lap detail `laps` times over.
 */
export function computeRouteSurfaceSpeedProfile(
  route: RouteWithMeta,
  frame: ClassifiedBikeFrame,
  wheelset: Wheelset | undefined,
  weightKg: number,
  heightCm: number,
  wkg: number,
  draft?: { mode: 'ttt', riders: number, climbWkg?: number } | { mode: 'race' }
): RouteSurfaceSpeedProfile | undefined {
  if (!route.terrain.elevationProfile || route.terrain.elevationProfile.length < 2) return undefined
  if (!route.surface.segments || route.surface.segments.length === 0) return undefined

  const geometry = geometryForRouteLaps(route, 1)
  const totalDistanceM = geometry.totalDistanceM

  const gradeBoundariesM = geometry.points
    .map(p => p.distanceM)
    .filter(d => d > 0 && d < totalDistanceM)
  const surfaceBoundariesM = geometry.surfaceSegments.slice(0, -1).map(segment => segment.toM)
  const boundariesM = Array.from(new Set([...gradeBoundariesM, ...surfaceBoundariesM])).sort((a, b) => a - b)

  const rider = { weightKg, heightCm, powerW: wkg * weightKg }
  // Chart is per-lap (single lap geometry), so the TTT plan here is built on
  // that same single-lap geometry - independent of the endpoints' per-request
  // plans, which cover the full laps+lead-in ride.
  const tttPlan = draft?.mode === 'ttt' && draft.climbWkg ? tttPowerPlan(geometry, draft.climbWkg, weightKg) : undefined
  const powerScaleAtSpeed = draft?.mode === 'ttt'
    ? (speedMps: number) => tttPowerScaleAtSpeed(draft.riders, speedMps)
    : draft?.mode === 'race' ? (speedMps: number) => racePowerScaleAtSpeed(speedMps) : undefined
  const result = simulateRoute({ rider, frame, wheelset, geometry, boundariesM, powerSegmentsW: tttPlan?.powerSegmentsW, powerScaleAtSpeed })

  const timePoints = buildTimePoints(result, boundariesM, totalDistanceM)

  const equipment = equipmentPhysics(frame, wheelset)
  const cdaM2 = riderScaledCdaM2(equipment.cdaM2, heightCm, weightKg)
  const massKg = weightKg + equipment.bikeMassKg
  const crrClass = wheelset?.crrClass ?? 'road'
  const tarmacCrr = SURFACE_CRR.tarmac[crrClass] ?? 0.004

  const segments: RouteSurfaceSpeedSegment[] = []
  for (const geometrySegment of geometry.surfaceSegments) {
    const distanceM = geometrySegment.toM - geometrySegment.fromM
    if (distanceM <= 0) continue
    // `interpolateTimeAt` rather than an exact `timeAtDistanceSec` lookup -
    // real GPS-measured surface data very often falls a few metres short of
    // (or, occasionally, past) the route's official lap distance (the same
    // "Strava segment length vs. zwift-data route distance" mismatch noted
    // on `appendMeasuredLap`), so the LAST surface segment's own `toM` can
    // land just off of any boundary actually simulated. An exact lookup
    // there returned `undefined` and silently dropped that segment entirely
    // - on a route with only one or two real surface segments (most short
    // routes), that's the one big segment covering nearly the whole ride,
    // which then also corrupted the chart's x-axis scale (built from this
    // array's last `toKm`) into a tiny fraction of the real route.
    const elapsedSec = interpolateTimeAt(timePoints, geometrySegment.toM) - interpolateTimeAt(timePoints, geometrySegment.fromM)
    const avgSpeedMps = elapsedSec > 0 ? distanceM / elapsedSec : 0
    const avgGradePercent = ((elevationAt(geometry.points, geometrySegment.toM) - elevationAt(geometry.points, geometrySegment.fromM)) / distanceM) * 100
    const grade = avgGradePercent / 100
    const surfaceCrr = SURFACE_CRR[geometrySegment.surface][crrClass] ?? SURFACE_CRR.grass.mountain ?? 0.042
    const extraWattsVsTarmac = powerForSpeed(avgSpeedMps, massKg, grade, surfaceCrr, cdaM2)
      - powerForSpeed(avgSpeedMps, massKg, grade, tarmacCrr, cdaM2)

    segments.push({
      fromKm: geometrySegment.fromM / 1000,
      toKm: geometrySegment.toM / 1000,
      surface: geometrySegment.surface,
      avgSpeedKmh: Math.round(avgSpeedMps * 3.6 * 10) / 10,
      avgGradePercent: Math.round(avgGradePercent * 10) / 10,
      extraWattsVsTarmac: Math.round(extraWattsVsTarmac)
    })
  }

  const speedSamples = resampleSpeedSamples(timePoints, totalDistanceM)

  // One extra simulation, only while the chart is open in a drafted mode: the
  // same ride with the draft scaling removed, so the gap between the two lines
  // is exactly what the draft is worth at each point on the route.
  let soloComparison: RouteSurfaceSpeedProfile['soloComparison']
  if (draft) {
    const soloResult = simulateRoute({ rider, frame, wheelset, geometry, boundariesM, powerSegmentsW: tttPlan?.powerSegmentsW })
    soloComparison = {
      speedSamples: resampleSpeedSamples(buildTimePoints(soloResult, boundariesM, totalDistanceM), totalDistanceM),
      overallAvgSpeedKmh: Math.round(soloResult.averageSpeedMps * 3.6 * 10) / 10,
      frontPullPowerW: draft.mode === 'ttt' ? Math.round(tttFrontPullPowerW(rider.powerW, draft.riders)) : undefined
    }
  }

  return {
    segments,
    overallAvgSpeedKmh: Math.round(result.averageSpeedMps * 3.6 * 10) / 10,
    speedSamples,
    elevationPoints: geometry.points,
    soloComparison
  }
}

/** The simulated elapsed time at every requested boundary (plus start/finish), as `interpolateTimeAt` inputs. */
function buildTimePoints(result: ReturnType<typeof simulateRoute>, boundariesM: number[], totalDistanceM: number): { distanceM: number, elapsedSec: number }[] {
  const timeAtDistanceSec = new Map<number, number>()
  timeAtDistanceSec.set(0, 0)
  for (const crossing of result.boundaryCrossings ?? []) timeAtDistanceSec.set(crossing.distanceM, crossing.elapsedSec)
  timeAtDistanceSec.set(totalDistanceM, result.elapsedSec)
  return [0, ...boundariesM, totalDistanceM].map(distanceM => ({ distanceM, elapsedSec: timeAtDistanceSec.get(distanceM)! }))
}

/** Distance/time-weighted resampling to `TARGET_SAMPLE_COUNT` even buckets - see `speedSamples`' doc comment. Bucket positions depend only on the route, so two series resampled here are directly comparable. */
function resampleSpeedSamples(timePoints: { distanceM: number, elapsedSec: number }[], totalDistanceM: number): RouteSurfaceSpeedSample[] {
  const bucketWidthM = Math.max(MIN_SAMPLE_BUCKET_M, totalDistanceM / TARGET_SAMPLE_COUNT)
  const speedSamples: RouteSurfaceSpeedSample[] = []
  for (let fromM = 0; fromM < totalDistanceM; fromM += bucketWidthM) {
    const toM = Math.min(fromM + bucketWidthM, totalDistanceM)
    const distanceM = toM - fromM
    if (distanceM <= 0) continue
    const elapsedSec = interpolateTimeAt(timePoints, toM) - interpolateTimeAt(timePoints, fromM)
    if (elapsedSec <= 0) continue
    speedSamples.push({
      distanceM: (fromM + toM) / 2,
      avgSpeedKmh: Math.round((distanceM / elapsedSec) * 3.6 * 10) / 10
    })
  }
  return speedSamples
}
