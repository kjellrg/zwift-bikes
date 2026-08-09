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

export interface ClassifiedBikeFrame extends BikeFrame {
  category: BikeCategory
  style?: BikeStyle
  scores: ClassificationScores
  confidence: ScoreConfidence
  /** True for a small number of special frames (Pinarello Espada, Zwift Concept Z1/Golden Concept Z1, Specialized PROJECT 74) that come with their own integrated/disc wheels which cannot be swapped in Zwift - see `classifyBikeFrame.ts`'s `FIXED_WHEEL_FRAMES`. */
  hasFixedWheels: boolean
  /** Upgrade stage (0-5) these scores were computed at - see `classifyBikeFrame.ts`'s `level` param. */
  level: number
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
}

/** A front+rear wheel pairing, as commonly ridden together in Zwift */
export interface Wheelset {
  key: string
  name: string
  front: ClassifiedWheel
  rear: ClassifiedWheel
  /** Rolling-resistance class, taken from the front wheel (front/rear always share the same class) */
  crrClass: 'road' | 'gravel' | 'mountain'
  scores: ClassificationScores
  confidence: ScoreConfidence
}

export interface SurfaceEstimate {
  road: number
  gravel: number
  cobble: number
  /**
   * - `curated`: a best-guess percentage for a specific route, based on public route descriptions.
   * - `unverified`: this route's world is known (via zwiftmap's community-mapped surface data,
   *   see `shared/data/zwiftmapSurfaceZones.ts`) to contain gravel/cobble zones, but this specific
   *   route hasn't been individually checked - percentages default to 100% road.
   * - `heuristic`: no known gravel/cobble zones for this route's world - assumed fully paved.
   */
  confidence: 'curated' | 'unverified' | 'heuristic'
}

export type TerrainCategory = 'flat' | 'rolling' | 'hilly' | 'mountainous'

export interface TerrainWeights {
  aero: number
  climb: number
  gravel: number
  cobble: number
}

export interface TerrainProfile {
  /** elevation gain per km, m/km */
  climbRatio: number
  category: TerrainCategory
  weights: TerrainWeights
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
