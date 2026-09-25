import type { BikeStyle, ScoreConfidence, SurfaceEstimate, TerrainCategory, WheelCategory, ZwiftSurfaceType } from '../../shared/types/catalog'
import type { Powerup } from '../../shared/utils/events'
import { RACE_FORMAT_LABELS, raceFormatPhrase } from '#shared/utils/events'
import type { DraftMode } from '../../shared/utils/physics/draft'
import { DRAFT_MODES } from '#shared/utils/physics/draft'
import { formatDuration, formatDurationGap } from '#shared/utils/duration'
import { surfaceFamily, type SurfaceFamily } from '#shared/utils/silhouette'

/**
 * A rank as the Ranking prints it: a plain `1`, `2`, ... `10`, in tabular
 * figures and right-aligned by its column, so the digits line up without a
 * zero pad. The Recommendation is rank 1 and the rows are the rest, so the
 * two render their markers through one function and cannot drift in format.
 */
export const rankMarker = (rank: number) => String(rank)

/** The draft mode as the rider strip, the draft selects and the course-analysis scope lines name it - one list, so none of them can disagree. */
export const DRAFT_MODE_LABELS: Record<DraftMode, string> = { solo: 'Solo', race: 'Race draft', ttt: 'TTT paceline' }

/** The draft selects' items (`RiderProfileControls`, `ProfileContent`), in the order `DRAFT_MODES` lists the modes. */
export const DRAFT_MODE_OPTIONS = DRAFT_MODES.map(value => ({ label: DRAFT_MODE_LABELS[value], value }))

/** A frame's style, as the Ranking's style column and the "why" sentence name it. */
export const BIKE_STYLE_LABELS: Record<BikeStyle, string> = {
  aero: 'aero',
  climb: 'climbing',
  endurance: 'endurance',
  allrounder: 'all-round'
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

/** Strava-style climb categories, steepest/hardest (HC) to gentlest (4). Not every mapped climb has one. */
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

/**
 * A surface's colour, by family (see `surfaceFamily`): tarmac in the strong
 * rule, the loose surfaces in dirt ochre, cobbles, brick and wood in
 * grey-blue. Two surface colours and no more, so the hero's strip, the
 * surface table, the speed chart and the Discovery cards all mean the same
 * thing by one - and a surface never borrows a status colour.
 */
export const SURFACE_FAMILY_BG: Record<SurfaceFamily, string> = {
  tarmac: 'bg-tarmac',
  dirt: 'bg-dirt',
  rough: 'bg-rough'
}

/** The same colours as SVG fills - `background-color` utilities do nothing to an SVG shape. */
export const SURFACE_FAMILY_FILL: Record<SurfaceFamily, string> = {
  tarmac: 'fill-tarmac',
  dirt: 'fill-dirt',
  rough: 'fill-rough'
}

export const SURFACE_TYPE_COLORS = Object.fromEntries(
  (Object.keys(SURFACE_TYPE_LABELS) as ZwiftSurfaceType[]).map(type => [type, SURFACE_FAMILY_BG[surfaceFamily(type)]])
) as Record<ZwiftSurfaceType, string>

export const SURFACE_TYPE_FILL_COLORS = Object.fromEntries(
  (Object.keys(SURFACE_TYPE_LABELS) as ZwiftSurfaceType[]).map(type => [type, SURFACE_FAMILY_FILL[surfaceFamily(type)]])
) as Record<ZwiftSurfaceType, string>

/**
 * Whether every number behind a combo traces to ZwiftInsider bot tests - the
 * `confidence` contract (see `.claude/skills/zwift-recommendation-accuracy`)
 * reduced to one yes/no for a headline. A fixed-wheel frame has no wheel to
 * ask. The recommendation and every ranked row must agree on this rule, which
 * is why it is not spelled out in each of them.
 */
export function isBotTested(combo: { frame: { confidence: ScoreConfidence }, wheelset?: { confidence: ScoreConfidence } }): boolean {
  return combo.frame.confidence === 'measured' && (!combo.wheelset || combo.wheelset.confidence === 'measured')
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
// can format times the same way these pages do; it is used unchanged.
// Imported explicitly rather than left to Nuxt's auto-import, because the
// wording built from it below is asserted in the plain-node suite (see
// `rankingResults.test.ts`), which teaches no auto-imports.

/**
 * Describes, as one short evidence line, how much time a route's non-tarmac
 * sections cost vs. an equivalent fully-paved route - see `estimateSurfaceTimePenaltySec`. Kept
 * generic ("rough terrain") rather than naming specific surfaces, since the
 * coarse `gravel`/`cobble` fields are buckets that can mean anything from
 * dirt/snow/sand to brick/wood - see `coarsenSurfaceComposition`. Returns
 * `undefined` when there's nothing non-tarmac or no penalty to report.
 */
export function formatSurfaceTimePenalty(surface: SurfaceEstimate, penaltySec: number | undefined): string | undefined {
  if (!penaltySec || penaltySec <= 0) return undefined
  if (surface.gravel <= 0 && surface.cobble <= 0) return undefined

  // Rounded first, so 59.7 s reads "1:00 minutes" rather than "60 seconds";
  // `formatDuration` prints h:mm:ss from an hour up, which reads as hours.
  const seconds = Math.round(penaltySec)
  const cost = seconds < 60 ? `${seconds} seconds` : `${formatDuration(seconds)} ${seconds < 3600 ? 'minutes' : 'hours'}`
  return `Rough surfaces cost this setup about ${cost} here`
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

/**
 * The "sitting in the bunch saves X vs solo" line for race draft mode - see the
 * recommend endpoints' `physics.race` block. Same shape and same honesty as
 * `formatTttTimeSaving`: both rides are the same rider at the same average
 * power, and only the draft differs. Says *typical mid-pack* out loud, because
 * that is what the constant measures - not a win and not a breakaway.
 */
export function formatRaceTimeSaving(race: { savingPct: number, raceSavedSec?: number } | undefined): string | undefined {
  if (!race || typeof race.raceSavedSec !== 'number') return undefined
  const savedSec = race.raceSavedSec
  const magnitude = Math.abs(savedSec)
  if (magnitude < 0.5) return undefined
  const formatted = magnitude < 60 ? `${Math.round(magnitude)}s` : formatDuration(magnitude)
  return savedSec >= 0
    ? `Sitting in a typical mass-start bunch saves ~${formatted} vs riding this alone at the same average power (~${race.savingPct}% less power for the same speed on the flat).`
    : `A typical mass-start bunch is ~${formatted} slower here than riding alone at the same average power - this route is too steep for the draft to be worth anything.`
}

// `RACE_FORMAT_LABELS` and `raceFormatPhrase` now live in
// `shared/utils/events.ts`, beside the `RaceFormat` they name, so the
// markdown race document can write a format out too - server code cannot
// import from `app/`. Re-exported here because this module is where every
// page already reaches for a label.
export { RACE_FORMAT_LABELS, raceFormatPhrase }

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

/**
 * The six upgrade stages as every stage select lists them - the garage's,
 * and the one on each ranked setup. One list so the two cannot disagree
 * about what stage 0 is called. The profile's default-stage select spells
 * stage 0 out longer on purpose: it is explaining the default, not editing
 * a bike.
 */
export const UPGRADE_STAGE_OPTIONS = [0, 1, 2, 3, 4, 5].map(level => ({
  label: level === 0 ? 'Stage 0 (stock)' : `Stage ${level}`,
  value: level
}))

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
