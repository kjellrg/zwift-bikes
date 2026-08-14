import type { BikeCategory, SurfaceEstimate, TerrainCategory, WheelCategory, ZwiftSurfaceType } from '../../shared/types/catalog'
import type { RaceFormat } from '../../shared/types/events'

export const BIKE_CATEGORY_LABELS: Record<BikeCategory, string> = {
  standard: 'Standard (Road)',
  tt: 'Time Trial',
  gravel: 'Gravel',
  handbike: 'Hand Cycle',
  funbike: 'Fun Bike'
}

export const BIKE_CATEGORY_COLORS: Record<BikeCategory, 'primary' | 'info' | 'warning' | 'neutral' | 'success'> = {
  standard: 'primary',
  tt: 'info',
  gravel: 'warning',
  handbike: 'neutral',
  funbike: 'success'
}

export const WHEEL_CATEGORY_LABELS: Record<WheelCategory, string> = {
  aero: 'Aero',
  climb: 'Lightweight',
  gravel: 'Gravel',
  allrounder: 'All-round',
  disc: 'Disc / TT'
}

export const TERRAIN_LABELS: Record<TerrainCategory, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  mountainous: 'Mountainous'
}

export const TERRAIN_COLORS: Record<TerrainCategory, 'success' | 'primary' | 'warning' | 'error'> = {
  flat: 'success',
  rolling: 'primary',
  hilly: 'warning',
  mountainous: 'error'
}

/** Strava-style climb categories, steepest/hardest (HC) to gentlest (4). Not every mapped climb has one. */
export const CLIMB_TYPE_LABELS: Record<'HC' | '4' | '3' | '2' | '1', string> = {
  HC: 'Hors Catégorie',
  1: 'Category 1',
  2: 'Category 2',
  3: 'Category 3',
  4: 'Category 4'
}

export const CLIMB_TYPE_COLORS: Record<'HC' | '4' | '3' | '2' | '1', 'error' | 'warning' | 'primary' | 'success'> = {
  HC: 'error',
  1: 'error',
  2: 'warning',
  3: 'primary',
  4: 'success'
}

export const SURFACE_TYPE_LABELS: Record<ZwiftSurfaceType, string> = {
  tarmac: 'Tarmac',
  brick: 'Brick',
  wood: 'Wood',
  cobbles: 'Cobbles',
  snow: 'Snow',
  dirt: 'Dirt',
  grass: 'Grass',
  sand: 'Sand',
  gravel: 'Gravel'
}

export const SURFACE_TYPE_COLORS: Record<ZwiftSurfaceType, string> = {
  tarmac: 'bg-slate-400',
  brick: 'bg-orange-600',
  wood: 'bg-amber-700',
  cobbles: 'bg-stone-500',
  snow: 'bg-sky-300',
  dirt: 'bg-yellow-800',
  grass: 'bg-green-500',
  sand: 'bg-yellow-300',
  gravel: 'bg-amber-500'
}

/** Same palette as `SURFACE_TYPE_COLORS`, as SVG `fill-*` utilities instead of `bg-*` - Tailwind's `background-color` utilities have no effect on SVG shapes, which paint via the `fill` property instead (see `RouteSurfaceSpeedProfile.vue`'s chart, `RouteElevationProfile.vue`'s `GRADE_BANDS.fillClass` for the existing precedent). */
export const SURFACE_TYPE_FILL_COLORS: Record<ZwiftSurfaceType, string> = {
  tarmac: 'fill-slate-400',
  brick: 'fill-orange-600',
  wood: 'fill-amber-700',
  cobbles: 'fill-stone-500',
  snow: 'fill-sky-300',
  dirt: 'fill-yellow-800',
  grass: 'fill-green-500',
  sand: 'fill-yellow-300',
  gravel: 'fill-amber-500'
}

export const SURFACE_TYPE_ICONS: Record<ZwiftSurfaceType, string> = {
  tarmac: 'i-lucide-road',
  brick: 'i-lucide-brick-wall',
  wood: 'i-lucide-fence',
  cobbles: 'i-lucide-grip',
  snow: 'i-lucide-snowflake',
  dirt: 'i-lucide-footprints',
  grass: 'i-lucide-sprout',
  sand: 'i-lucide-waves',
  gravel: 'i-lucide-stone'
}

export function formatGrade(percent: number): string {
  return `${percent.toFixed(1)}%`
}

/** Formats a percentage to at most 1 decimal place, e.g. `28.3%` (not `28.349543535634534%`). */
export function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`
}

export function formatDistance(km: number): string {
  return `${km.toFixed(1)} km`
}

export function formatElevation(m: number): string {
  return `${Math.round(m)} m`
}

export function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Describes how much time a route's non-tarmac sections cost vs. an
 * equivalent fully-paved route - see `estimateSurfaceTimePenaltySec`. Kept
 * generic ("rough terrain") rather than naming specific surfaces, since the
 * coarse `gravel`/`cobble` fields are buckets that can mean anything from
 * dirt/snow/sand to brick/wood - see `coarsenSurfaceComposition`. Returns
 * `undefined` when there's nothing non-tarmac or no penalty to report.
 */
export function formatSurfaceTimePenalty(surface: SurfaceEstimate, penaltySec: number | undefined): string | undefined {
  if (!penaltySec || penaltySec <= 0) return undefined
  if (surface.gravel <= 0 && surface.cobble <= 0) return undefined

  return `Due to increased rolling resistance, rough terrain adds ~${Math.round(penaltySec)}s to this route with the fastest combo below.`
}

/**
 * Formats a time gap vs. the fastest combo on the route, e.g. `+5.21s slower`
 * or `+1:23 slower`. Sub-minute gaps keep two decimals on purpose: closely
 * matched combos are routinely separated by fractions of a second, and rounding
 * those to whole seconds collapsed genuinely different combos onto an identical
 * label, making the ranking look arbitrary. From a minute up, hundredths are
 * noise, so the `m:ss` form rounds to whole seconds as before.
 */
export function formatDurationDelta(seconds: number): string {
  // Quantise to the precision we actually display first, so a gap that renders
  // as `+0.00s` is reported as `fastest` rather than as a phantom gap.
  const hundredths = Math.round(seconds * 100)
  if (hundredths <= 0) return 'fastest'
  if (hundredths < 60 * 100) return `+${(hundredths / 100).toFixed(2)}s slower`
  const totalSeconds = Math.round(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `+${minutes}:${secs.toString().padStart(2, '0')} slower`
}

/** Formats an average speed (route distance in km over a finish time in seconds), e.g. `32.4 km/h`. */
export function formatSpeedKmh(distanceKm: number, seconds: number): string {
  if (seconds <= 0) return '-'
  const kmh = distanceKm / (seconds / 3600)
  return `${kmh.toFixed(1)} km/h`
}

export const RACE_FORMAT_LABELS: Record<RaceFormat, string> = {
  ttt: 'Team time trial',
  points: 'Points race',
  scratch: 'Scratch race'
}

export const RACE_FORMAT_COLORS: Record<RaceFormat, 'primary' | 'info' | 'warning'> = {
  ttt: 'warning',
  points: 'info',
  scratch: 'primary'
}

/**
 * Race day, e.g. `Tuesday 22 September 2026`.
 *
 * Locale and time zone are pinned rather than left to the runtime: these
 * pages are prerendered, so a build machine formatting in one locale and a
 * browser formatting in another produces a hydration mismatch. UTC also
 * keeps the ISO date in the calendar data from sliding a day either way.
 */
export function formatRaceDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

/** Compact race day for dense listings, e.g. `Tue 22 Sep`. */
export function formatRaceDateShort(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  })
}
