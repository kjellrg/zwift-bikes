import type { BikeCategory, SurfaceEstimate, TerrainCategory, WheelCategory, ZwiftSurfaceType } from '../../shared/types/catalog'
import type { Powerup, RaceFormat } from '../../shared/utils/events'

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

// `formatDuration` now lives in `shared/utils/duration.ts` so the MCP tools
// can format times the same way these pages do; it is auto-imported here and
// used unchanged.

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
  const gap = formatDurationGap(seconds)
  return gap === 'fastest' ? gap : `${gap} slower`
}

/** Formats an average speed (route distance in km over a finish time in seconds), e.g. `32.4 km/h`. */
export function formatSpeedKmh(distanceKm: number, seconds: number): string {
  if (seconds <= 0) return '-'
  const kmh = distanceKm / (seconds / 3600)
  return `${kmh.toFixed(1)} km/h`
}

/**
 * The "riding as a TTT saves X vs solo" line for TTT draft mode - see the
 * recommend endpoints' `physics.ttt` block. Both rides are the same rider at
 * the same power with the same pacing; only the draft differs, so the gap is
 * exactly what the paceline buys. Returns `undefined` when no solo
 * comparison was simulated.
 */
export function formatTttTimeSaving(ttt: { riders: number, frontPullPowerW: number, tttSavedSec?: number } | undefined): string | undefined {
  if (!ttt || typeof ttt.tttSavedSec !== 'number') return undefined
  const savedSec = ttt.tttSavedSec
  const magnitude = Math.abs(savedSec)
  if (magnitude < 0.5) return undefined
  const formatted = magnitude < 60 ? `${Math.round(magnitude)}s` : formatDuration(magnitude)
  return savedSec >= 0
    ? `A ${ttt.riders}-rider paceline saves ~${formatted} vs riding this alone at the same effort (~${ttt.frontPullPowerW} W on your pulls).`
    : `A ${ttt.riders}-rider paceline is ~${formatted} slower here than riding alone at the same effort - the draft can't offset your team's climb pace on this route.`
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

/**
 * A race window for week-long stages (ZRacing), e.g. `10-16 Aug` or
 * `31 Aug - 6 Sep` across a month boundary. Single-day races just get their
 * short date. Same pinned-locale/UTC rules as `formatRaceDate`.
 */
export function formatRaceDateRange(isoDate: string, isoEndDate?: string): string {
  if (!isoEndDate || isoEndDate === isoDate) return formatRaceDateShort(isoDate)
  const from = new Date(`${isoDate}T12:00:00Z`)
  const to = new Date(`${isoEndDate}T12:00:00Z`)
  const sameMonth = from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()
  const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' })
  const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return sameMonth ? `${day(from)}-${dayMonth(to)}` : `${dayMonth(from)} - ${dayMonth(to)}`
}

/** Zwift's race powerups, as spelled in event listings. */
export const POWERUP_LABELS: Record<Powerup, string> = {
  feather: 'Feather',
  aero: 'Aero',
  draft: 'Draft',
  ghost: 'Ghost',
  anvil: 'Anvil',
  steamroller: 'Steamroller',
  burrito: 'Burrito'
}

/** Icons referenced only via this lookup - they're added to `icon.clientBundle` in `nuxt.config.ts` by hand, since the scanner can't see them here. */
export const POWERUP_ICONS: Record<Powerup, string> = {
  feather: 'i-lucide-feather',
  aero: 'i-lucide-wind',
  draft: 'i-lucide-truck',
  ghost: 'i-lucide-ghost',
  anvil: 'i-lucide-anvil',
  steamroller: 'i-lucide-tractor',
  burrito: 'i-lucide-sandwich'
}
