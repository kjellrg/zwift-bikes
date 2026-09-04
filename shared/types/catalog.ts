import type { UpgradeScheme } from '../data/frameUpgradeSchemes'
import type { BikeFrame, BikeFrontWheel, BikeRearWheel, Route, Sport, WorldSlug } from 'zwift-data'

/**
 * `zwift-data` only provides catalog data (names, ids, images, distance/elevation).
 * It does NOT provide surface composition (gravel/cobbles) or bike/wheel
 * performance stats (aero, weight, rolling resistance). Everything below that
 * scores or classifies equipment/routes is a best-effort heuristic built on
 * top of the real catalog data, not official Zwift game data. It is clearly
 * surfaced as an estimate in the UI.
 */

/**
 * Matches the tabs Zwift itself uses in the in-game garage/drop shop:
 * Standard (road), TT, Gravel, Hand Cycles and Fun bikes.
 */
export type BikeCategory = 'standard' | 'tt' | 'gravel' | 'handbike' | 'funbike'

/**
 * Riding style used only to score `standard` road bikes against a route
 * (aero vs. lightweight vs. all-round vs. cobble-friendly endurance bike).
 * Not shown as a top-level filter, since Zwift doesn't expose it either.
 */
export type BikeStyle = 'aero' | 'climb' | 'endurance' | 'allrounder'

export type WheelCategory = 'aero' | 'climb' | 'gravel' | 'allrounder' | 'disc'

export interface ClassificationScores {
  /** How much the equipment helps on flat/fast terrain (0-100) */
  aero: number
  /** How much the equipment helps when climbing, i.e. low weight (0-100) */
  climb: number
  /** How much the equipment helps off-road / on gravel (0-100) */
  gravel: number
  /** How much the equipment helps on cobbles (comfort/compliance) (0-100) */
  cobble: number
}

/** Whether `scores` come from real ZwiftInsider bot speed-test data or a name-based heuristic guess */
export type ScoreConfidence = 'measured' | 'estimated'

/**
 * Absolute CdA/mass/Crr offsets from this equipment's own category baseline
 * (standard/TT reference bike, or the reference wheel), solved directly from
 * its real ZwiftInsider flat/climb gap-seconds via physics rather than
 * derived from the abstract 0-100 `scores` - see
 * `shared/utils/physics/equipment.ts`'s `solveFrameEquipmentDelta`/
 * `solveWheelEquipmentDelta`. Only present when `confidence === 'measured'`;
 * `scores` themselves are unaffected and keep powering ranking/UI display.
 */
export interface EquipmentPhysicsDelta {
  cdaDeltaM2: number
  bikeMassDeltaKg: number
  /** Rolling-resistance offset from Zwift's stage-3 "drivetrain" upgrade; 0 below that stage and for wheels. */
  crrDelta: number
}

/**
 * A measured frame's bot-test gap at every upgrade stage, `[stage0..stage5]`,
 * in seconds saved (+) or lost (-) per hour against the category's reference
 * bike at 300 W - the flat test and the climb test separately. The same
 * numbers `classifyBikeFrame` scores each level from (see `interpolateGap`),
 * exposed whole so the bike drawer can show what each stage is worth without
 * a request or a second copy of the speed data in the browser.
 */
export interface UpgradeCurve {
  flat: readonly number[]
  climb: readonly number[]
}

export interface ClassifiedBikeFrame extends BikeFrame {
  category: BikeCategory
  style?: BikeStyle
  scores: ClassificationScores
  confidence: ScoreConfidence
  /** True for a small number of special frames (Pinarello Espada, Zwift Concept Z1/Golden Concept Z1, Specialized PROJECT 74) that come with their own integrated wheels which cannot be swapped in Zwift - see `classifyBikeFrame.ts`'s `FIXED_WHEEL_FRAMES`. */
  hasFixedWheels: boolean
  /** Upgrade stage (0-5) these scores were computed at - see `classifyBikeFrame.ts`'s `level` param. */
  level: number
  physics?: EquipmentPhysicsDelta
  /** Present for measured frames only - unmeasured ones have no per-stage numbers, and `level` has no effect on them. */
  upgradeCurve?: UpgradeCurve
  /** Zwift's upgrade scheme for this frame (progression axis x price tier), when catalogued - see `frameUpgradeSchemes.ts`. */
  upgradeScheme?: UpgradeScheme
}

export interface ClassifiedWheel {
  id: number
  name: string
  imageName: string
  category: WheelCategory
  /** Zwift's rolling-resistance class - determines Crr on gravel/cobbles (see `classifyWheel.ts`) */
  crrClass: 'road' | 'gravel' | 'mountain'
  scores: ClassificationScores
  confidence: ScoreConfidence
  physics?: EquipmentPhysicsDelta
}

/** A front+rear wheel pairing, as commonly ridden together in Zwift */
export interface Wheelset {
  /** Stable identity for the garage/localStorage and the API's `ownedWheels` filter - never derive it from anything that can be re-styled. */
  key: string
  name: string
  front: ClassifiedWheel
  /**
   * A set's disc-ness is decided by its REAR wheel, never its front: "Zipp
   * 808/Super9" pairs an aero-class 808 front with a disc rear, and it is the
   * disc rear that earns the TT aero bonuses. Every disc gate (the TT score
   * bonus in `scoring.ts`, the TT residual CdA in `physics/equipment.ts`, the
   * "Disc / TT" UI badge) therefore reads `rear.category` - issue #150.
   */
  rear: ClassifiedWheel
  /** Rolling-resistance class, taken from the front wheel (front/rear always share the same class) */
  crrClass: 'road' | 'gravel' | 'mountain'
  scores: ClassificationScores
  confidence: ScoreConfidence
  physics?: EquipmentPhysicsDelta
}

/**
 * Surface labels mirrored from zwiftmap's `SurfaceType` enum. The route UI
 * still exposes a simple road/gravel/cobble summary, but calculations can use
 * this detailed mix when it is available.
 */
export type ZwiftSurfaceType = 'tarmac' | 'brick' | 'wood' | 'cobbles' | 'snow' | 'dirt' | 'grass' | 'sand' | 'gravel'

export type SurfaceComposition = Partial<Record<ZwiftSurfaceType, number>>

/**
 * A contiguous stretch of one surface type, at its real position along a
 * single lap (`fromKm`/`toKm` relative to the lap start, i.e. `0..route.distance`).
 * Guaranteed lap-relative by generation-time normalization - source traces
 * that covered the lead-in are split, with the lead-in's stretches moved to
 * `SurfaceEstimate.leadInSegments` (see `scripts/route-surfaces/normalize.mjs`,
 * issue #126). See `shared/utils/surfaceGeometry.ts`'s `computeSurfaceProfile`.
 *
 * Positions are OFFICIAL km, not the km the source GPS trace recorded: the
 * two disagree by up to 8% on some routes, and `estimateSurface` rescales
 * the generated trace onto the official distance on the way in, with the
 * same factor it applies to `TerrainProfile.elevationProfile`, so the two
 * always describe the same road (`shared/utils/traceScale.ts`, issue #171).
 * The last segment therefore ends exactly on the lap distance, which is what
 * lets the simulator chain laps without a surface-less gap between them.
 */
export interface SurfaceSegment {
  fromKm: number
  toKm: number
  type: ZwiftSurfaceType
}

export interface SurfaceEstimate {
  road: number
  gravel: number
  cobble: number
  /** Detailed zwiftmap-style surface percentage mix, summing to roughly 100 when known. */
  composition?: SurfaceComposition
  /** Real position-tagged surface stretches for one lap, when measured (see `confidence: 'measured'`) - lets the dynamic physics model use the real surface at each point instead of one blended value for the whole route. */
  segments?: SurfaceSegment[]
  /** The lead-in's own measured surface stretches (km relative to the RIDE start), present only for the few routes whose source trace covered the lead-in - see `routeSurfaces.ts`. */
  leadInSegments?: SurfaceSegment[]
  /**
   * - `measured`: computed from the route's real GPS trace intersected against zwiftmap's world
   *   surface polygons - see `shared/data/routeSurfaces.ts` and `scripts/route-surfaces/`.
   * - `curated`: a best-guess percentage for a specific route, based on public route descriptions.
   * - `unverified`: this route's world is known (via zwiftmap's community-mapped surface data,
   *   see `shared/data/zwiftmapSurfaceZones.ts`) to contain gravel/cobble zones, but this specific
   *   route hasn't been individually checked - percentages default to 100% road.
   * - `heuristic`: no known gravel/cobble zones for this route's world - assumed fully paved.
   */
  confidence: 'measured' | 'curated' | 'unverified' | 'heuristic'
}

export type TerrainCategory = 'flat' | 'rolling' | 'hilly' | 'mountainous'

export interface TerrainWeights {
  aero: number
  climb: number
  gravel: number
  cobble: number
}

/**
 * A named climb on a route, matched from `zwift-data`'s `segments` catalog
 * via the route's `segmentsOnRoute` placements - see `routeClimbs.ts`. Real
 * length/gradient for the *named* climbs on a route (e.g. Alpe du Zwift,
 * Epic KOM), not derived/estimated from the route's aggregate distance/elevation.
 */
export interface RouteClimb {
  name: string
  slug: string
  /** Start position along the route, in km (one lap - repeats per lap on multi-lap routes). */
  fromKm: number
  /** End position along the route, in km. */
  toKm: number
  lengthKm: number
  elevationM: number
  avgGradePercent: number
  /** Strava-style climb category, steepest to gentlest: HC, 1, 2, 3, 4. Not all climbs are categorized. */
  climbType?: 'HC' | '4' | '3' | '2' | '1'
  /**
   * `true` when this climb sits on the repeating lap (`fromKm`/`toKm`
   * relative to the lap start, recurring once per lap); `false` when it
   * falls entirely within the one-time lead-in (`fromKm`/`toKm` relative to
   * the ride start).
   *
   * `zwift-data`'s `segmentsOnRoute` positions are LAP-relative on almost
   * every route, but ride-relative (lead-in included) on a few - lutscher's
   * 13.7km lap has a 10.8km lead-in, and its Innsbruck KOM placements only
   * make sense measured from the ride start (km 3.1-10.6 inside the lead-in,
   * km 16.8-24.2 on the lap). Which frame a route uses is detected from its
   * own placements - see `placementsAreRideRelative` in `routeClimbs.ts`
   * (issue #126: assuming ride-relative everywhere shifted almost every
   * placement `leadIn` km early, slicing phantom surfaces into segment pages).
   */
  perLap: boolean
}

/**
 * A point on a route's real measured elevation profile for one lap, relative
 * to the lap's own start (`distanceM`/`elevationM` both `0` at the lap
 * start) - see `shared/utils/elevationGeometry.ts`.
 */
export interface RouteElevationPoint {
  distanceM: number
  elevationM: number
}

export interface TerrainProfile {
  /** elevation gain per km, m/km */
  climbRatio: number
  category: TerrainCategory
  weights: TerrainWeights
  /** Named climbs on this route with known length/gradient, ordered by position. Empty if none are mapped. */
  climbs: RouteClimb[]
  /**
   * Named sprints on this route, ordered by position - see `getRouteSprints`.
   * Computed server-side next to `climbs` so the route and race pages can
   * expand both per lap (`shared/utils/routeOccurrences.ts`) without
   * touching zwift-data's segment catalog or the measured surface data.
   */
  sprints: RouteSegmentPlacement[]
  /**
   * Real per-lap elevation profile from the route's Strava GPS trace
   * (simplified - see `computeElevationProfile`), when available. Lets the
   * dynamic physics model use the route's actual measured shape instead of
   * the synthetic named-climb/rolling-lap approximation - see
   * `geometryForRouteLaps`. Undefined for routes with no Strava segment.
   * Guaranteed lap-relative (first point `{0,0}` at the lap start) by the
   * same generation-time normalization as `SurfaceSegment`, and rescaled
   * onto the official lap distance by the same factor as that route's
   * surface segments (`shared/utils/traceScale.ts`, issue #171) - distances
   * move, measured elevations never do.
   */
  elevationProfile?: RouteElevationPoint[]
  /** The lead-in's own measured elevation shape (`distanceM: 0` at the ride start), present only when the source trace covered the lead-in. */
  leadInElevationProfile?: RouteElevationPoint[]
}

/**
 * A named segment occurrence on a route - the same real `segmentsOnRoute` +
 * `segments` catalog cross-reference `RouteClimb` uses (see `routeClimbs.ts`),
 * generalized with a `type` discriminator so sprints can be represented too.
 * Unlike `RouteClimb`, sprint occurrences keep `elevationM`/`avgGradePercent`
 * at `0` rather than being skipped when `zwift-data` has no gradient for
 * them (most sprints legitimately don't have one) - see `getRouteSprints` in
 * `routeClimbs.ts`.
 */
export interface RouteSegmentPlacement {
  name: string
  slug: string
  type: 'climb' | 'sprint'
  fromKm: number
  toKm: number
  lengthKm: number
  elevationM: number
  avgGradePercent: number
  climbType?: 'HC' | '4' | '3' | '2' | '1'
  perLap: boolean
}

/**
 * A rankable Zwift segment (climb or sprint), aggregated across every route
 * that hosts it - the shape used for segment search/listing and the segment
 * detail page. See `routeSegments.ts`'s `getAllSegmentSummaries`.
 */
export interface SegmentSummary {
  slug: string
  name: string
  type: 'climb' | 'sprint'
  climbType?: 'HC' | '4' | '3' | '2' | '1'
  world: WorldSlug
  worldName: string
  /** Representative length/elevation/grade, taken from the first route occurrence found - real per-route placements are essentially identical since it's the same physical segment. */
  lengthKm: number
  elevationM: number
  avgGradePercent: number
  /**
   * Elevation/grade derived from the best host route's measured elevation
   * profile - the same slice the segment page's chart and the dynamic
   * simulator ride - present only when such a profile exists. `zwift-data`'s
   * published scalars above can be coarse (Titans Grove reverse KOM says
   * 6.6% where the measured road - and ZwiftInsider - say ~4.3%), so every
   * DISPLAY surface prefers these; physics keeps reading the published
   * scalars (only ever as the no-profile fallback line) so ranking inputs
   * are untouched by this pair. Gain is the slice's total ascent; grade is
   * net elevation change over the official length (Strava's convention).
   */
  measuredElevationM?: number
  measuredAvgGradePercent?: number
  /**
   * How this segment was tied to its host routes: `'positional'` when at
   * least one route publishes a measured `segmentsOnRoute` placement for it,
   * `'membership'` when it only appears in routes' non-positional `segments`
   * arrays - then length/grade come from the segment's own `zwift-data`
   * record, and no route can say *where* along it the segment sits. The
   * segment page uses this to caption the ranking honestly.
   */
  placement: 'positional' | 'membership'
  /** Every route this segment appears on. */
  hostRoutes: { slug: string, name: string }[]
}

export interface RouteWithMeta extends Route {
  terrain: TerrainProfile
  surface: SurfaceEstimate
  worldName: string
}

export interface RouteSummary {
  id?: number
  slug: string
  name: string
  world: WorldSlug
  worldName: string
  distance: number
  elevation: number
  sports: readonly Sport[]
  eventOnly: boolean
  supportsTT: boolean
  terrain: TerrainProfile
  surface: SurfaceEstimate
}

export interface ComboScoreBreakdown {
  aero: number
  climb: number
  gravel: number
  cobble: number
}

export interface ComboScore {
  frame: ClassifiedBikeFrame
  /** Absent for `frame.hasFixedWheels` frames - there's no real wheel choice to show, see `rankCombos`. */
  wheelset?: Wheelset
  score: number
  breakdown: ComboScoreBreakdown
  /** Only present when the request included a rider weight/W-per-kg - see `estimateFinishTimeSec`. */
  finishTimeSec?: number
  /** Only present alongside `finishTimeSec`. Seconds this combo loses to the route's gravel/cobble sections vs. an equivalent fully-paved route - see `estimateSurfaceTimePenaltySec`. `0` for routes with no known non-tarmac surface. */
  surfaceTimePenaltySec?: number
  /**
   * How many distinct wheel answers this frame has for this route, counted
   * over the whole ranked pool rather than the returned page - so a card can
   * offer the rest without a request just to find out whether there are any.
   * `1` means there is no choice to show (a `hasFixedWheels` frame, or a pool
   * filtered down to one wheel). Set on listing responses only; the
   * `wheelsForFrame` drill-down that answers the disclosure omits it.
   */
  wheelOptions?: number
}

export interface RouteFilters {
  search?: string
  world?: WorldSlug
  sport?: Sport
  minDistance?: number
  maxDistance?: number
  minElevation?: number
  maxElevation?: number
  surface?: 'gravel' | 'cobble'
  eventOnly?: boolean
}

export interface BikeFilters {
  search?: string
  category?: BikeCategory
  isTT?: boolean
}

export type { BikeFrontWheel, BikeRearWheel }
