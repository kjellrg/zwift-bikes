import type { ComboScore, EquipmentPhysicsDelta, RouteWithMeta } from '../../shared/types/catalog'
import { BIKE_CATEGORY_LABELS, formatRaceTimeSaving, formatSurfaceTimePenalty, formatTttTimeSaving } from './labels'
import type { RiderInputs } from './recommendRequest'
import { limitedCourseDataNote } from './rideCoverage'

/**
 * Whether the course carries a real elevation shape, rather than a start
 * point and an aggregate climb total. Two points is the threshold, not one:
 * a single sample has no grade after it, so the dynamic physics has nothing
 * to place a gradient change along.
 */
export function hasElevationProfile(course: RouteWithMeta | undefined): boolean {
  return (course?.terrain.elevationProfile?.length ?? 0) > 1
}

/**
 * Whether the course knows WHERE its surfaces are, rather than only how much
 * of each there is. A measured mix whose trace lost its positions rides on
 * one blended value, exactly like a curated estimate - see
 * `surfaceCoverageLine`, which draws the same distinction in rider words.
 */
export function hasSurfaceLocations(course: RouteWithMeta | undefined): boolean {
  return (course?.surface.segments?.length ?? 0) > 0
}

/**
 * Which course an equipment view is describing, said out loud only when it is
 * not the one the rider has selected: ` on Makuri 40`, or nothing. A race
 * page's group can move the selected course while the ranking on screen is
 * still the previous group's, and a speed curve under a freshly changed
 * selector must not be read as the course now selected.
 *
 * Nothing, too, while the applied course is not known - the view says that
 * on a line of its own, and a scope line about no course would be a claim
 * about nothing.
 */
export function courseNote(selected: Pick<RouteWithMeta, 'slug'>, applied: Pick<RouteWithMeta, 'slug' | 'name'> | undefined): string {
  return applied && applied.slug !== selected.slug ? ` on ${applied.name}` : ''
}

/**
 * The physics block of a recommend response, as the evidence lines read it.
 *
 * A deliberate restatement of `RecommendResponse['physics']` in
 * `useRecommendRequest`, which declares the whole shape and which carries the
 * pointer back here: this module stays plain node, so nothing in it may
 * import a composable. The two move together - a field the lines below read
 * that is renamed there must be renamed here.
 */
type RankingPhysics = {
  mode: string
  ttt?: { riders: number, frontPullPowerW: number, tttSavedSec?: number }
  race?: { savingPct: number, raceSavedSec?: number }
}

/**
 * Whether the ranking ran on the dynamic physics model - the header badge's
 * question, asked by all three ranking pages.
 *
 * One spelling of `'dynamic'` because nothing checks it: `mode` reaches the
 * client as a plain `string` (see `RecommendResponse`), so a renamed mode
 * would turn the badge off in silence rather than fail a build. One place to
 * correct beats three to find.
 */
export function isDynamicPhysics(physics: Pick<RankingPhysics, 'mode'> | undefined): boolean {
  return physics?.mode === 'dynamic'
}

/** Everything the Recommendation says about what its time rests on. */
export interface RankingEvidence {
  /** The lines under the time, in reading order: what the surface cost, what the draft bought. */
  notes: string[]
  /** The warning beside a time whose course inputs are partly missing; absent when none are. */
  limitedDataNote: string | undefined
}

/**
 * The evidence lines for one Applied Ranking: the rough-terrain cost to the
 * recommended setup, what the ride's draft is worth over riding it alone, and
 * how much of the course the model actually had.
 *
 * All three pages derive these from the SAME three things - the applied
 * course, rank 1 and the physics block - which is why this is one function
 * and not a copy per page. The course comes off the Applied Ranking rather
 * than each page's own lookup: on a race page those are two different clocks,
 * and the line explains the time on screen, so it must describe the course
 * that time was computed over.
 */
export function rankingEvidence(ranking: {
  course: RouteWithMeta | undefined
  combo: ComboScore | undefined
  physics: RankingPhysics | undefined
}): RankingEvidence {
  const { course, combo, physics } = ranking
  const notes = [
    course ? formatSurfaceTimePenalty(course.surface, combo?.surfaceTimePenaltySec) : undefined,
    formatTttTimeSaving(physics?.ttt),
    formatRaceTimeSaving(physics?.race)
  ]
  return {
    notes: notes.filter((note): note is string => Boolean(note)),
    limitedDataNote: course
      ? limitedCourseDataNote({
          hasElevationProfile: hasElevationProfile(course),
          hasSurfaceLocations: hasSurfaceLocations(course)
        })
      : undefined
  }
}

/**
 * One JSON-LD block, in the shape `useHead` takes.
 *
 * Every one is keyed, so unhead updates the server-rendered tag in place.
 * Without a key it matches by content hash, and a patch that lands while the
 * page is still hydrating - the stored profile's ranking is accepted -
 * inserts a second script and leaves the crawler-facing default-rider one in
 * the document.
 *
 * A type alias rather than an interface: `useHead`'s script entry carries a
 * `data-*` index signature, and only an alias gets the implicit index
 * signature that makes it assignable to one.
 */
export type StructuredDataScript = {
  key: string
  type: 'application/ld+json'
  innerHTML: string
}

/**
 * JSON-LD as it is safe to put inside a `<script>`: a `<` anywhere in the
 * data - a route or race name is arbitrary text - would otherwise be read as
 * markup and could close the element early.
 */
function jsonLd(key: string, data: object): StructuredDataScript {
  return { key, type: 'application/ld+json', innerHTML: JSON.stringify(data).replace(/</g, '\\u003c') }
}

/**
 * The page's breadcrumb trail, numbered from one in the order given. The
 * trail itself stays the page's: two items on a route, three on a segment and
 * four on a race, built from names no ranking has ever seen. Only the
 * envelope and the escaping are shared.
 */
export function breadcrumbScript(trail: readonly { name: string, item: string }[]): StructuredDataScript {
  return jsonLd('breadcrumbs', {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': trail.map((crumb, index) => ({
      '@type': 'ListItem',
      'position': index + 1,
      'name': crumb.name,
      'item': crumb.item
    }))
  })
}

/**
 * The page's one FAQ entry: the question its heading asks, answered with the
 * very text shown under the Recommendation, so what a crawler is told is what
 * a rider is shown.
 *
 * Absent until there is an answer - before rank 1 lands, or when the filters
 * match nothing. A published Question with no Answer would be a page
 * promising something it does not say.
 */
export function faqScript(question: string | undefined, answer: string | undefined): StructuredDataScript | undefined {
  if (!question || !answer) return undefined
  return jsonLd('faq', {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': [{
      '@type': 'Question',
      'name': question,
      'acceptedAnswer': { '@type': 'Answer', 'text': answer }
    }]
  })
}

/**
 * A ranked setup's physics against the stock bike, frame and wheels
 * together: the solved drag-area, mass and rolling-resistance deltas are
 * each relative to the same reference (the Zwift Carbon on 32mm Carbon
 * wheels for road frames and every wheel; the Zwift TT for TT frames - see
 * `physics/equipment.ts`), so a setup's delta is the sum of its parts.
 *
 * Undefined unless every part has one: only bot-tested equipment is solved,
 * and a half-known sum would read as a whole one. A fixed-wheel frame's
 * delta already includes its wheels.
 */
export function comboPhysicsDelta(combo: Pick<ComboScore, 'frame' | 'wheelset'>): EquipmentPhysicsDelta | undefined {
  const frame = combo.frame.physics
  if (!frame) return undefined
  if (combo.frame.hasFixedWheels || !combo.wheelset) return frame
  const wheels = combo.wheelset.physics
  if (!wheels) return undefined
  return {
    cdaDeltaM2: frame.cdaDeltaM2 + wheels.cdaDeltaM2,
    bikeMassDeltaKg: frame.bikeMassDeltaKg + wheels.bikeMassDeltaKg,
    crrDelta: frame.crrDelta + wheels.crrDelta
  }
}

/** A delta as the table and the "why" section print it: always signed, `−` rather than `-`. */
export function formatSignedDelta(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits))
  if (rounded === 0) return (0).toFixed(digits)
  return `${rounded > 0 ? '+' : '\u2212'}${Math.abs(rounded).toFixed(digits)}`
}

/**
 * The filters that produced a Ranking, named beside the Recommendation's
 * "Fastest of every eligible setup" - the claim is only as true as the pool
 * it was made in, and the response carries no count of that pool to quote,
 * so the pool is described instead. Read off the APPLIED restrictions, like
 * everything that explains a time.
 */
export function activeFiltersLabel(restrictions: Pick<RiderInputs, 'verifiedOnly' | 'includeHaloBikes' | 'myBikesOnly' | 'search'>, category: RiderInputs['bikeCategory']): string {
  const parts = [
    category === 'all' ? 'All categories' : BIKE_CATEGORY_LABELS[category],
    restrictions.verifiedOnly ? 'verified data only' : 'estimates included'
  ]
  if (restrictions.myBikesOnly) parts.push('your garage')
  // A directed search lifts the Halo rule server-side, so a search says so
  // rather than claiming the Halo bikes are hidden.
  if (restrictions.search.trim()) parts.push(`search "${restrictions.search.trim()}"`)
  else if (!restrictions.includeHaloBikes) parts.push('Halo bikes hidden')
  return parts.join(' · ')
}
