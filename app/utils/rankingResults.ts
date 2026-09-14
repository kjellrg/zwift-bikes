import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'
import { formatRaceTimeSaving, formatSurfaceTimePenalty, formatTttTimeSaving } from './labels'
import { limitedCourseDataNote } from './rideBriefing'

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
