import type { ClassifiedBikeFrame, Wheelset } from '../../types/catalog'
import type { PhysicsSurface, RouteGeometry, RouteGeometryPoint } from '../../types/physics'
import { SURFACE_CRR } from '../../data/surfaceCrr'
import { detectLongClimbBlocks, tttGroupSpeedMps } from './draft'
import { equipmentPhysics, riderScaledCdaM2 } from './equipment'
import { powerForSpeed, speedForPower } from './forces'

/**
 * A race-impacting feature of the route, for the TTT "race plan" panel:
 * where the paceline is in danger. `type` is a deliberately open union -
 * future dangers (long supertuck descents, sprint segments) slot in as new
 * types without changing consumers that just render rows.
 */
export interface RacePlanItem {
  type: 'climb' | 'surface'
  fromKm: number
  toKm: number
  lengthKm: number
  /** Short factual summary - length/grade/duration for climbs, surface names for sectors. */
  detail: string
  /** Why it matters for racing. */
  note: string
}

export interface RacePlanOptions {
  weightKg: number
  heightCm: number
  /** The rider's own sustained power - see `physics/draft.ts` for what that means in TTT mode. */
  riderPowerW: number
  climbWkg?: number
  /** TTT rotation size, when in TTT mode: the group crosses a rough sector faster than a lone rider would, and the Crr penalty scales with speed. */
  riders?: number
  /** The combo the surface cost is quoted for - the same one the speed/surface chart uses, so the two panels' watt figures are computed the same way. */
  frame: ClassifiedBikeFrame
  wheelset?: Wheelset
}

/** No plan for very short events - nothing on a <5 km blast is "long" enough to plan around (user request: ignore short distances). */
const MIN_ROUTE_KM = 5
/** Non-tarmac sectors shorter than this are ignored - a few metres of dirt where a path crosses the road isn't a race danger. */
const MIN_SURFACE_SECTOR_M = 300

/**
 * A rough sector's cost is reported the same way the speed/surface chart
 * reports it (`extraWattsVsTarmac` in `routeSurfaceSpeedProfile.ts`): the
 * power needed to hold the pace you'd actually ride there, minus the power
 * that same pace would need on tarmac. Everything except Crr is identical
 * between the two terms, so the figure isolates rolling resistance exactly -
 * and any per-wheel `crrDelta` cancels, which is why it isn't applied here.
 *
 * Crr is emphatically NOT flat within a wheel class: on road tyres Zwift
 * charges 0.004 on tarmac but 0.016 on dirt and 0.025 on grass. Values come
 * straight from `SURFACE_CRR` (ZwiftInsider's published table), so this can
 * never drift from what the simulator itself charges. The class comes from
 * the quoted combo's own wheels rather than being hardcoded to road - which
 * is road anyway for any TTT, since Zwift only lets TT/road frames take
 * road-class wheels (see `isWheelsetCompatible`).
 */
const ROAD_TARMAC_CRR = SURFACE_CRR.tarmac.road ?? 0.004
/** Sectors costing less than this are dropped - notably sand, which Zwift charges exactly tarmac's Crr on road wheels, so it is no danger at all. */
const MIN_NOTABLE_EXTRA_W = 2

function crrFor(surface: PhysicsSurface, crrClass: 'road' | 'gravel' | 'mountain'): number {
  return SURFACE_CRR[surface][crrClass] ?? ROAD_TARMAC_CRR
}

/** Elevation at `distanceM`, linearly interpolated - mirrors the helper of the same name in `routeSurfaceSpeedProfile.ts`, needed here because a surface sector spans several grade points. */
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

function formatEstDuration(sec: number): string {
  const minutes = Math.round(sec / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}

/**
 * The route's race-impacting dangers, in ride order: long climbs (where a
 * TTT paceline breaks up - same detection/thresholds as `tttPowerPlan`, see
 * `detectLongClimbBlocks`) and sustained non-tarmac sectors (higher rolling
 * resistance, whose size depends on the wheel's Crr class, plus reduced
 * draft benefit at the slower speeds they force). Pure closed-form - no
 * simulation - so it's cheap enough to compute client-side on mount.
 */
export function buildRacePlan(geometry: RouteGeometry, options: RacePlanOptions): RacePlanItem[] {
  if (geometry.totalDistanceM < MIN_ROUTE_KM * 1000) return []

  const items: RacePlanItem[] = []

  // When no team climb W/kg is set the blocks are still worth flagging -
  // estimate their duration at the rider's normal power instead.
  const climbPowerW = options.climbWkg ? options.climbWkg * options.weightKg : options.riderPowerW
  for (const block of detectLongClimbBlocks(geometry, climbPowerW, options.weightKg)) {
    items.push({
      type: 'climb',
      fromKm: block.fromM / 1000,
      toKm: block.toM / 1000,
      lengthKm: block.distanceM / 1000,
      detail: `${(block.distanceM / 1000).toFixed(1)} km at ${(block.avgGrade * 100).toFixed(1)}%, est. ${formatEstDuration(block.estDurationSec)}`,
      note: options.climbWkg
        ? `Long climb - the paceline likely breaks up here; ridden at your team climb pace of ${options.climbWkg.toFixed(1)} W/kg.`
        : 'Long climb - the paceline likely breaks up here. Draft gives almost nothing at climbing speeds, so agree a climb pace beforehand.'
    })
  }

  // Contiguous non-tarmac runs, merged across surface changes (cobbles into
  // dirt is one continuous danger zone, not two), short crossings ignored.
  let run: { fromM: number, toM: number, surfaces: Set<PhysicsSurface> } | undefined
  const runs: { fromM: number, toM: number, surfaces: Set<PhysicsSurface> }[] = []
  for (const segment of geometry.surfaceSegments) {
    if (segment.surface === 'tarmac') {
      run = undefined
      continue
    }
    if (run && segment.fromM <= run.toM) {
      run.toM = Math.max(run.toM, segment.toM)
      run.surfaces.add(segment.surface)
    } else {
      run = { fromM: segment.fromM, toM: segment.toM, surfaces: new Set([segment.surface]) }
      runs.push(run)
    }
  }
  // Quoted for the same combo the speed/surface chart uses, on the pace the
  // rider would actually hold on each sector's own grade.
  const equipment = equipmentPhysics(options.frame, options.wheelset)
  const cdaM2 = riderScaledCdaM2(equipment.cdaM2, options.heightCm, options.weightKg)
  const massKg = options.weightKg + equipment.bikeMassKg
  const crrClass = options.wheelset?.crrClass ?? 'road'
  const tarmacCrr = crrFor('tarmac', crrClass)

  for (const sector of runs) {
    const lengthM = sector.toM - sector.fromM
    if (lengthM < MIN_SURFACE_SECTOR_M) continue
    // Worst surface in the sector drives the warning - a run that mixes dirt
    // into gravel is as slow as its slowest part.
    const worstSurface = [...sector.surfaces].reduce((worst, surface) => crrFor(surface, crrClass) > crrFor(worst, crrClass) ? surface : worst)
    const crr = crrFor(worstSurface, crrClass)
    const grade = (elevationAt(geometry.points, sector.toM) - elevationAt(geometry.points, sector.fromM)) / lengthM
    const speedMps = options.riders
      ? tttGroupSpeedMps(options.riderPowerW, options.riders, massKg, grade, crr, cdaM2)
      : speedForPower(options.riderPowerW, massKg, grade, crr, cdaM2)
    const extraWattsVsTarmac = powerForSpeed(speedMps, massKg, grade, crr, cdaM2)
      - powerForSpeed(speedMps, massKg, grade, tarmacCrr, cdaM2)
    if (extraWattsVsTarmac < MIN_NOTABLE_EXTRA_W) continue
    const surfaceNames = [...sector.surfaces].join(' / ')
    items.push({
      type: 'surface',
      fromKm: sector.fromM / 1000,
      toKm: sector.toM / 1000,
      lengthKm: lengthM / 1000,
      detail: `${(lengthM / 1000).toFixed(1)} km of ${surfaceNames} · +${Math.round(extraWattsVsTarmac)} W to hold pace vs tarmac`,
      note: 'Rough surface - those extra watts buy you no speed at all, and the slower pace it forces also cuts the draft benefit.'
    })
  }

  return items.sort((a, b) => a.fromKm - b.fromKm)
}
