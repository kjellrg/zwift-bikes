import type { H3Event } from 'h3'
import { createError } from 'h3'
import type { BikeCategory, ComboScore, RouteSummary, SegmentSummary } from '../../../shared/types/catalog'
import { getRouteBySlug, getRoutesWithMeta, toRouteSummary } from '../../../shared/utils/catalog'
import { courseCoverage, type CourseApproximation } from '../../../shared/utils/courseCoverage'
import {
  getRaceBySlug,
  getRoundForRace,
  getSeasonBySlug,
  isRacePublishable,
  raceContextLabel
} from '../../../shared/utils/events'
import { BIKE_CATEGORY_WORDS } from '../../../shared/utils/bikeCategories'
import { raceFormatRules } from '../../../shared/utils/raceRules'
import { rideForRoute, rideForSegment } from '../../../shared/utils/recommendRide'
import type { NoticeLink, RunRaceNotice } from '../../../shared/utils/runRaceNotice'
import { buildRecommendationAnswer } from '../../../shared/utils/recommendationAnswer'
import { buildRecommendQuery, DEFAULT_RIDER_INPUTS, riderInputsForRide, type AppliedRiderInputs, type Ride } from '../../../shared/utils/recommendQuery'
import { raceRide, raceStatement, routeStatement, segmentStatement, type RaceStatement, type RideStatement } from '../../../shared/utils/rideStatement'
import { maxLapsForRoute } from '../../../shared/utils/routeLaps'
import { getAllSegmentSummaries, getSegmentSummary, routeWithMetaForSegment } from '../../../shared/utils/routeSegments'
import type { SiteFlags } from '../../../shared/utils/siteFlags'
import { formatDistance } from '../../../shared/utils/units'
import { MAX_UPGRADE_STAGE } from '../../../shared/utils/upgradeStage'
import { recommendRouteQuerySchema, recommendSegmentQuerySchema } from '../apiQuerySchemas'
import { CONFIDENCE_NOTE, formatComboTable, formatSurface } from '../mcp/format'
import { rankRideForQuery, type CourseToRank, type RankingFor, type RideForCourse, type RouteRanking, type SegmentRanking } from '../rankRide'
import { worldListing } from '../worldListing'

/**
 * The markdown representation of the site's pages - what a caller that sent
 * `Accept: text/markdown` gets instead of the HTML, at the same URL.
 *
 * Two rules shape every document here.
 *
 * **It is the page, not a summary of it.** A markdown twin that answered a
 * different question from the HTML would be cloaking, and the numbers on a
 * ranking page are the answer. So each ranking document states its page's
 * own Ride and ranks it for the rider the prerendered HTML is rendered for,
 * through the query the page itself sends - see `rankAsThePage`. What a
 * rider reads and what an agent reads are the same ranking, from the same
 * cache entry. And what the page says about its Ride on its own - its name,
 * question, Fact row and notes, a race's own facts - comes from the page's
 * own Ride statement (`shared/utils/rideStatement`), so the twin has no
 * words of its own for any of it (issue #318).
 *
 * **It is written for a model deciding what to say next.** The table, the
 * confidence column and the "measured vs estimated" note are the MCP
 * server's (`server/utils/mcp/format.ts`), reused wholesale rather than
 * re-derived: the two surfaces answer the same question for the same kind of
 * reader, and one formatter means a fix to either lands in both.
 *
 * The catalog is read directly and the ranking comes from the Ride ranking
 * module (`server/utils/rankRide.ts`) in process, as the MCP tools and the
 * recommend endpoints get theirs (issue #290): one implementation of the
 * ranking, its kill switch and its edge cache, so the expensive part of a
 * markdown request is paid once per Ride per deploy - and not at all when
 * the page's own request for the default rider already paid it.
 */

/** What a document needs from the request it is being rendered for. */
export interface MarkdownRenderContext {
  /**
   * The request's own origin, which every link in the document is built
   * from - so a preview Worker's document browses the preview, exactly as
   * the HTML's relative links do.
   */
  origin: string
  /**
   * The public site URL, which only the canonical is built from - never the
   * request's host. Same rule and same reason as `useCanonicalUrl`: a
   * preview Worker, a workers.dev host or a localhost render must not
   * nominate itself as the canonical copy of a page.
   */
  siteUrl: string
  /**
   * The site flags' kill switches, as `getSiteFlags` read them on the
   * request being answered. Handed to the Ride ranking module, which honours
   * `killSwitches.recommend` itself, before its cache: a data incident is
   * exactly when a ranking must not slip out of a side door, and a document
   * never passes `site-flags-gate.ts`, which only guards the endpoints.
   */
  killSwitches: SiteFlags['killSwitches']
  /**
   * The day the document is rendered for, as an ISO date (`isoDay`): what a
   * race's twin decides by whether its race has been run (`hasBeenRun`), as
   * its page does. A twin is never prerendered, so the middleware supplies
   * the real day - or the dev pin the pages honour (`eventsRenderDay`) - and a
   * test holds it here rather than the document reading the clock.
   */
  today: string
  /**
   * The request being answered, if any. The module writes its cache entry
   * off the critical path through this request's `waitUntil`, and its
   * timings land on this request's log line. Nothing in a document depends
   * on it.
   */
  event?: H3Event
}

/**
 * A rendered twin: its markdown, and whether its page is noindex. The
 * document says so rather than the middleware re-deriving it, because only
 * the document knows what its page decided and on which day - today that is
 * a race page whose race has been run, and every other twin says `false`.
 */
export interface RenderedMarkdown {
  markdown: string
  noindex: boolean
}

/**
 * One page's markdown twin. Just the renderer: the path it was resolved from
 * is the caller's already, and handing it back would only invite the two to
 * disagree.
 */
export type MarkdownDocument = (context: MarkdownRenderContext) => Promise<RenderedMarkdown>

/** A page that is indexed, as every twin's but a run race's is. */
function indexed(markdown: string): RenderedMarkdown {
  return { markdown, noindex: false }
}

/**
 * A document's ranking: the page's, or why there is none to print.
 */
type DocumentRanking<T extends RouteRanking | SegmentRanking>
  = | { ranking: T }
    | { unavailable: 'paused' | 'failed' }

/**
 * Ranks a page's own Ride the way the page does before any profile has
 * loaded: `buildRecommendQuery` - the browser's own builder - applied to
 * `DEFAULT_RIDER_INPUTS`, the seeds the page's composables start from, then
 * parsed with the endpoint's own schema and handed to the Ride ranking
 * module exactly as the endpoint hands it over (`rankRideForQuery`, as
 * `recommendHttp.ts` calls it).
 *
 * That is the whole anti-cloaking contract in one function. The query is not
 * a copy of the client's but the client's, and nothing here builds ranking
 * options by hand, so the document ranks the rider, category, verification,
 * Halo rule and Race format rules the page ranks - and reaches the cache
 * entry the page's own request writes, since the module keys that on the
 * parsed question.
 *
 * Every way of not answering leaves the document serving its facts: paused
 * is the kill switch, and a stall (an outcome) or a throw (a fault) is a
 * ranking that could not be computed. A throw is logged first, as one JSON
 * line in the shape `mcp-tool-error` uses: the document's note reads the
 * same for both, and without the line a fault - the defaults drifting from
 * the schema, say - would turn every document into "could not be computed"
 * with nothing to say why.
 */
async function rankAsThePage<C extends CourseToRank>(
  course: C,
  ride: Ride,
  { killSwitches, event }: MarkdownRenderContext
): Promise<DocumentRanking<RankingFor<RideForCourse<C>>>> {
  const target = course as CourseToRank
  try {
    const query = target.kind === 'route'
      ? recommendRouteQuerySchema.parse(buildRecommendQuery(DEFAULT_RIDER_INPUTS, ride))
      : recommendSegmentQuerySchema.parse(buildRecommendQuery(DEFAULT_RIDER_INPUTS, ride))
    const outcome = await rankRideForQuery(course, query, { killSwitches, event })
    switch (outcome.status) {
      case 'answer': return { ranking: outcome.ranking }
      case 'paused': return { unavailable: 'paused' }
      case 'stall': return { unavailable: 'failed' }
    }
  } catch (error) {
    console.error(JSON.stringify({
      evt: 'markdown-ranking-error',
      course: target.kind,
      slug: target.kind === 'route' ? target.route.slug : target.segment.slug,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }))
    return { unavailable: 'failed' }
  }
}

/**
 * The one line every ranking document needs and no rider-facing page has to
 * say: these times are for a rider nobody chose. The HTML says it too (the
 * pages carry a "set a profile" notice until one is stored), but a model
 * quoting a finish time has to be able to attribute it, or it will present
 * the default rider's time as the reader's.
 */
function defaultRiderNote(rider: AppliedRiderInputs): string {
  const wkg = (rider.powerW / rider.weightKg).toFixed(2)
  return `Ranked for the site's default rider - ${rider.weightKg} kg, ${rider.heightCm} cm, ${rider.powerW} W (${wkg} W/kg), ${draftWords(rider)} - because a request carries no profile. `
    + 'Every time below scales with those three numbers, so quote them alongside any time you repeat, and rank the reader\'s own with the API described at the end.'
}

/**
 * The answer, from the head of the ranking: the same builder the page's
 * visible answer and its FAQ structured data come from
 * (`buildRecommendationAnswer`), fed what the page feeds it
 * (`useRecommendationAnswer`, `rankingPageAnswerRide`) - the Applied rider
 * for this Ride, the default restrictions and the Ride's own rules - so an
 * agent reading this document and a crawler reading the HTML come away with
 * one answer. The assumptions line follows it, as it does on the page.
 */
function answerLine(
  ranking: RouteRanking | SegmentRanking,
  ride: Ride,
  course: { rideName: string, distanceKm?: number }
): string | undefined {
  const restrictions = DEFAULT_RIDER_INPUTS
  const answer = buildRecommendationAnswer({
    ranking: ranking.combos.slice(0, 2),
    fastestOverall: ranking.fastestOverall,
    distanceKm: course.distanceKm,
    rideName: course.rideName,
    rideRules: raceFormatRules(ride)?.rulesLine,
    rider: riderInputsForRide(restrictions, ride),
    laps: ride.laps,
    verifiedOnly: restrictions.verifiedOnly,
    includeHaloBikes: restrictions.includeHaloBikes,
    myBikesOnly: restrictions.myBikesOnly,
    ownsFrames: Object.keys(restrictions.owned).length > 0,
    ownsWheels: Object.keys(restrictions.ownedWheels).length > 0,
    search: restrictions.search
  })
  return answer && `${answer.summary}\n\n${answer.assumptions}`
}

/**
 * The closing section on every document: where an agent goes when the
 * default rider is not the reader. Listed as an explicit next step rather
 * than left implicit, because the whole reason a ranking page can be
 * answered statically is that it assumes a rider - and the interesting
 * answer is always the reader's own.
 */
function nextSteps(origin: string): string[] {
  return [
    '## Rank this for your own weight, height and power',
    '',
    `- **HTTP API**: \`GET ${origin}/api/recommend/{routeSlug}?weightKg=&heightCm=&powerW=\`, and \`${origin}/api/recommend/segments/{segmentSlug}\` for a climb or sprint. JSON.`,
    `- **Site index for agents**: \`${origin}/llms.txt\`.`,
    `- Every route, segment and race page answers in markdown when the request sends \`Accept: text/markdown\`, as this one did - as do \`${origin}/\`, \`${origin}/segments\` and each world's page, \`${origin}/worlds/{worldSlug}\`.`
  ]
}

/**
 * What stands in for the table when there is no ranking to print. The two
 * causes are worth telling apart: a paused ranking is an operational state
 * that will end, while a failed one may be this particular ride refusing to
 * be simulated (a rider who cannot hold the grade at that power), and an
 * agent that cannot distinguish them will retry the wrong one.
 */
function rankingUnavailable(result: DocumentRanking<RouteRanking | SegmentRanking>): string {
  if (!('unavailable' in result)) return '_No verified frame and wheel combination matched. Gravel and fun bikes have no bot-test data, so a verified-only ranking excludes them._'
  if (result.unavailable === 'paused') return '_Rankings are temporarily paused for maintenance. The facts below are current; try again shortly._'
  return '_The ranking could not be computed for this request. Try again shortly, or use the API below._'
}

/**
 * How far into the ranking this document goes, and where the rest is.
 *
 * Deliberately NOT `formatPagination` from the MCP formatter, which is the
 * one thing in it that does not travel: it tells the reader to "call again
 * with a higher `offset`", and there is no call and no argument here. A
 * document names the page and the endpoint that pages instead.
 */
function depthNote(pagination: RouteRanking['pagination'], origin: string): string {
  const last = pagination.offset + pagination.returned
  if (!pagination.hasMore) return `That is every combination that qualified (${last}).`
  return `These are the ${last} fastest; the page itself loads more on demand, and \`${origin}/api/recommend/...\` takes \`offset\` and \`limit\` for the rest.`
}

/**
 * The header block shared by both ranking documents. `answer` falls back to
 * the same sentence the empty ranking section carries, so a document that
 * cannot answer says why once and says the same thing in both places.
 */
function rankingHeader(question: string, answer: string, canonical: string): string[] {
  return [
    `# ${question}`,
    '',
    answer,
    '',
    `Canonical page: <${canonical}>`
  ]
}

/**
 * How the default rider rides the Ride, as the rider note says it: the
 * Applied draft mode, which is the default's own unless the Ride's Race
 * format rules the draft out.
 */
function draftWords(rider: AppliedRiderInputs): string {
  switch (rider.draftMode) {
    case 'solo': return 'riding solo'
    case 'ttt': return `riding in a ${rider.tttRiders}-rider TTT paceline`
    case 'race': return 'riding in a race bunch'
  }
}

/**
 * The frame kinds the category line names, in the order it names them, as a
 * sentence says each. Hand cycles are not named in the list, which has never
 * named them.
 */
/** A route twin's "Elevation data" line, by the coverage rule's approximation. */
const ELEVATION_DATA: Record<CourseApproximation, string> = {
  'measured': 'real measured GPS profile',
  'named-climbs': 'named climbs plus a synthesized remainder',
  'aggregate': 'synthesized from aggregate distance and elevation'
}

const CATEGORY_LINE_ORDER: readonly BikeCategory[] = ['standard', 'tt', 'gravel', 'funbike']
const FRAME_KIND_WORDS: Record<BikeCategory, string> = { ...BIKE_CATEGORY_WORDS, funbike: 'fun' }

/** "a, b and c". */
function listWords(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** The category the ranking was drawn from - the default's, made legal for the Ride. */
function categoryAssumption(category: BikeCategory | 'all'): string {
  if (category === 'all') return '- Every bike category the ride allows.'
  const word = BIKE_CATEGORY_WORDS[category]
  const others = CATEGORY_LINE_ORDER.filter(other => other !== category).map(other => FRAME_KIND_WORDS[other])
  return `- ${word.charAt(0).toUpperCase()}${word.slice(1)} bikes only (the site's default category); ${listWords(others)} frames are ranked when asked for explicitly.`
}

/**
 * Filters and assumptions the ranking was produced under, as bullets. Every
 * one of them narrows what "fastest" means, and a model relaying the answer
 * without them would overstate it - the same reasoning that puts these on
 * the page as the recommendation's small print.
 *
 * Each line follows `DEFAULT_RIDER_INPUTS` - the category and draft through
 * the Applied rider, which is those defaults made legal for the Ride - so a
 * changed default changes what the document says it ranked. The one line
 * that does not is "one row per bike": that cap is `buildRecommendQuery`'s
 * own, sent with every request, not a rider default.
 */
function rankingAssumptions(rider: AppliedRiderInputs, extra: string[]): string[] {
  const { defaultUnownedLevel: stage, verifiedOnly, includeHaloBikes } = DEFAULT_RIDER_INPUTS
  return [
    '',
    categoryAssumption(rider.category),
    verifiedOnly
      ? '- Verified equipment only: frames and wheels whose numbers come from real ZwiftInsider bot tests.'
      : '- Verified and estimated equipment: frames and wheels with no bot-test data are ranked on heuristic estimates.',
    `- Every frame assumed at Zwift upgrade stage ${stage} of ${MAX_UPGRADE_STAGE}${stage === MAX_UPGRADE_STAGE ? ' (fully upgraded)' : stage === 0 ? ' (stock, as bought)' : ''}${includeHaloBikes ? ', with the purchasable Halo frames included' : ', and unowned Halo frames excluded'}.`,
    '- One row per bike, paired with its own fastest wheelset for this ride; a frame Zwift sells in several paints is one row, the other paints named beside it.',
    ...extra,
    '',
    defaultRiderNote(rider)
  ]
}

/**
 * The Fact row as the page sets it under its heading: a line a cell, the
 * surface cell, then the notes beneath it - each in the statement's words.
 */
function factRowLines(statement: RideStatement, notes: (string | undefined)[]): string[] {
  const { surface } = statement
  return [
    ...statement.facts.map(fact => `- ${fact.value} ${fact.label}`),
    ...(surface ? [surface.allTarmac ? '- All tarmac' : `- Surface: ${surface.key.map(entry => entry.text).join(', ')}`] : []),
    '',
    ...facts(notes).flatMap(note => [note, ''])
  ]
}

/** `- **Distance**: 12.4 km` and friends, dropping the ones with nothing to say. */
function facts(entries: (string | undefined)[]): string[] {
  return entries.filter((entry): entry is string => Boolean(entry))
}

/**
 * The ranking itself, identical on every ranking document - which is the
 * point: a rider who learns to read one of these can read all three, the
 * same bargain `RideResults` strikes for the pages (see **Ranking results**
 * in CONTEXT.md). Only the extra assumption lines differ, because only the
 * ride does.
 */
function rankingSection(
  ranking: { combos: ComboScore[], pagination: RouteRanking['pagination'] } | undefined,
  unavailable: string,
  rider: AppliedRiderInputs,
  extraAssumptions: (string | undefined)[],
  origin: string
): string[] {
  const heading = '## Fastest bike and wheel combinations'
  if (!ranking) return [heading, '', unavailable, '']
  return [
    heading,
    ...rankingAssumptions(rider, facts(extraAssumptions)),
    '',
    formatComboTable(ranking.combos, ranking.pagination.offset + 1),
    '',
    depthNote(ranking.pagination, origin),
    CONFIDENCE_NOTE,
    ''
  ]
}

/**
 * What the times rest on, in the endpoint's own words. Absent with no
 * ranking, because a note explaining a computation nobody made is noise.
 */
function physicsSection(ranking: { physics?: { note: string } } | undefined): string[] {
  return ranking?.physics ? ['## How these times were computed', '', ranking.physics.note, ''] : []
}

async function renderRouteDocument(slug: string, context: MarkdownRenderContext): Promise<string> {
  const { origin, siteUrl } = context
  const route = getRouteBySlug(slug)
  if (!route) throw createError({ statusCode: 404, statusMessage: `Route "${slug}" not found` })
  const canonical = `${siteUrl}/routes/${route.slug}`
  // The page's Ride (`app/pages/routes/[slug].vue`): one lap is what its lap
  // picker starts on and therefore what its prerendered ranking is for -
  // resolved once, as the page resolves it for its hero and its statement.
  // Its totals add the lead-in, which is ridden once and is the difference
  // between the route's published distance and the distance actually raced.
  const ride: Ride = { course: { kind: 'route', slug: route.slug }, laps: 1 }
  const rider = riderInputsForRide(DEFAULT_RIDER_INPUTS, ride)
  const resolvedRide = rideForRoute(route, 1)
  const totals = resolvedRide.totals
  const statement = routeStatement({ ride: resolvedRide, siteUrl })

  // A ranking is the point of the page but not a precondition for the
  // document: the kill switch can pause recommendations and a rider who
  // cannot hold the grade makes the simulator refuse. Either way the route's
  // own facts are still worth serving, and an agent gets an honest "not
  // right now" instead of a 5xx.
  const result = await rankAsThePage({ kind: 'route', route }, ride, context)
  const ranking = 'ranking' in result ? result.ranking : undefined

  const unavailable = rankingUnavailable(result)
  const lines = [
    ...rankingHeader(statement.question, (ranking && answerLine(ranking, ride, { rideName: statement.rideName, distanceKm: totals.distanceKm })) ?? unavailable, canonical),
    '',
    ...factRowLines(statement, [statement.coverageNote])
  ]

  lines.push(...rankingSection(ranking, unavailable, rider, ['- One lap, including the lead-in once.'], origin))

  lines.push(
    '## The route',
    '',
    ...facts([
      `- **Slug**: \`${route.slug}\` (the id the API takes)`,
      `- **World**: ${worldLink(route.world, route.worldName, origin)}`,
      `- **One lap**: ${route.distance.toFixed(1)} km, ${Math.round(route.elevation)} m`,
      route.leadInDistance ? `- **Lead-in** (ridden once): ${route.leadInDistance.toFixed(1)} km, ${Math.round(route.leadInElevation ?? 0)} m` : undefined,
      `- **Lappable**: ${route.lap ? `yes, up to ${maxLapsForRoute(route)} laps on this site` : 'no - point to point, ridden once'}`,
      `- **Terrain**: ${route.terrain.category}`,
      `- **Surface**: ${formatSurface(route.surface)}`,
      `- **Event only**: ${route.eventOnly ? 'yes - it can only be ridden in an event' : 'no - it can be free-ridden as well as raced'}`,
      // Which of the three geometry sources the physics model got, by the
      // coverage rule `get_route` and the ranking's note read too.
      `- **Elevation data**: ${ELEVATION_DATA[courseCoverage(route).approximation]}`
    ]),
    ''
  )

  if (route.terrain.climbs.length > 0) {
    lines.push(
      '### Named climbs',
      '',
      '| Climb | Length | Elevation | Avg grade | Category |',
      '| --- | --- | --- | --- | --- |',
      ...route.terrain.climbs.map(climb =>
        `| ${climb.name} | ${climb.lengthKm.toFixed(1)} km | ${Math.round(climb.elevationM)} m | ${climb.avgGradePercent.toFixed(1)}% | ${climb.climbType ?? '-'} |`),
      ''
    )
  }

  lines.push(...physicsSection(ranking))

  return [...lines, ...nextSteps(origin), ''].join('\n')
}

async function renderSegmentDocument(slug: string, context: MarkdownRenderContext): Promise<string> {
  const { origin, siteUrl } = context
  const segment = getSegmentSummary(slug)
  if (!segment) throw createError({ statusCode: 404, statusMessage: `Segment "${slug}" not found` })
  // The synthetic segment-as-route is where a climb's surface mix lives.
  const course = routeWithMetaForSegment(segment)
  const canonical = `${siteUrl}/segments/${segment.slug}`
  // The page's Ride (`app/pages/segments/[slug].vue`), with no Race format -
  // a clean link has no `?rules=`. A sprint is ridden at the rider's sprint
  // power, never at race pace (`ridePowerW`), which is why a sprint document
  // quotes a different W figure from a climb's.
  const ride: Ride = { course: { kind: 'segment', slug: segment.slug }, power: segment.type === 'sprint' ? 'sprint' : 'race' }
  const rider = riderInputsForRide(DEFAULT_RIDER_INPUTS, ride)
  const statement = segmentStatement({ segment, resolvedRide: rideForSegment(course), ride, siteUrl })

  const result = await rankAsThePage({ kind: 'segment', segment }, ride, context)
  const ranking = 'ranking' in result ? result.ranking : undefined

  const unavailable = rankingUnavailable(result)
  const lines = [
    ...rankingHeader(statement.question, (ranking && answerLine(ranking, ride, { rideName: statement.rideName, distanceKm: segment.lengthKm })) ?? unavailable, canonical),
    '',
    ...factRowLines(statement, [
      statement.timingNote,
      // The host routes, placed or not, each linked on the request's origin.
      statement.hostRoutes.length ? `Also on ${statement.hostRoutes.map(host => `[${host.name}](${origin}${host.to})`).join(', ')}.` : undefined,
      statement.placementNote
    ])
  ]

  lines.push(...rankingSection(ranking, unavailable, rider, [
    '- The timed segment only, excluding any warm-up: it is simulated after a flat run-up so it is entered at racing speed rather than from a standstill, which is how a Zwift or Strava segment is actually ridden.',
    segment.type === 'sprint' ? '- Ridden at sprint power, not race pace - a sprint is a different effort from a route.' : undefined
  ], origin))

  lines.push(
    '## The segment',
    '',
    ...facts([
      `- **Slug**: \`${segment.slug}\` (the id the API takes)`,
      `- **Type**: ${segment.type}${segment.climbType ? `, climb category ${segment.climbType}` : ''}`,
      `- **World**: ${worldLink(segment.world, segment.worldName, origin)}`,
      `- **Surface**: ${formatSurface(course.surface)}`
    ]),
    ''
  )

  lines.push(...physicsSection(ranking))

  return [...lines, ...nextSteps(origin), ''].join('\n')
}

/**
 * What a run race's page says above its title (`runRaceNotice`, which the
 * page renders too), as a blockquote: the notice's title, then its three
 * parts, each link on the request's origin as every link here is.
 */
function runRaceNoticeLines(notice: RunRaceNotice, origin: string): string[] {
  const link = ({ lead, label, to }: NoticeLink) => `> ${lead} [${label}](${origin}${to})`
  return [
    `> **${notice.title}**`,
    '>',
    `> ${notice.ranOn}`,
    '>',
    link(notice.next),
    ...(notice.route ? ['>', link(notice.route)] : []),
    ''
  ]
}

/**
 * Where the points are for the ranked group, as the page's scoring table
 * lists them: one row a segment in ride order, each scored pass counted,
 * and where along the ride each pass falls when the route data says.
 */
function scoringLines(statement: RaceStatement, origin: string): string[] {
  const { rows } = statement.scoring
  if (!rows.length) return []
  const positioned = rows.some(row => row.positionsKm.length)
  const count = (times: number) => (times ? `${times}x` : '-')
  return [
    '### Where the points are',
    '',
    `| Segment | FAL | FTS |${positioned ? ' Comes at |' : ''}`,
    `| --- | --- | --- |${positioned ? ' --- |' : ''}`,
    ...rows.map(row =>
      `| ${row.slug ? `[${row.name}](${origin}/segments/${row.slug}?rules=${statement.rules.format})` : row.name} | ${count(row.fal)} | ${count(row.fts)} |`
      + (positioned ? ` ${row.positionsKm.length ? row.positionsKm.map(km => formatDistance(km)).join(', ') : '-'} |` : '')),
    '',
    statement.rules.segmentLinkNote,
    ''
  ]
}

/**
 * One race, which is the ranking page a route page cannot stand in for: the
 * organiser's format decides what may be STARTED on, and a recommendation
 * that ignored it would put an illegal bike at the top of the list. That is
 * also why this document exists at all - "what bike for ZRL round 1 week 3"
 * is exactly the question the site is trying to be the answer to, and it is
 * not answerable from `/routes/{slug}`.
 *
 * Ranked for the FIRST Category group, which is the page's own default
 * (`categoryGroup`, and the `?group=` a clean link omits). A group is the
 * race's, never the rider's, and the laps come with it - so a document for
 * one group is a complete answer for the riders in it, and the others are
 * listed beside it with their own courses and lap counts.
 */
async function renderRaceDocument(seasonSlug: string, raceSlug: string, context: MarkdownRenderContext): Promise<RenderedMarkdown> {
  const { origin, siteUrl, today } = context
  const season = getSeasonBySlug(seasonSlug)
  const race = season ? getRaceBySlug(seasonSlug, raceSlug) : undefined
  // The same gate the prerender list and the sitemap use: a race the
  // organiser has not published details for has no page, so it has no twin.
  if (!season || !race || !isRacePublishable(race)) {
    throw createError({ statusCode: 404, statusMessage: `Race "${raceSlug}" not found in season "${seasonSlug}"` })
  }

  const round = getRoundForRace(season, race)
  const canonical = `${siteUrl}/events/${season.slug}/${race.slug}`
  // The page's Ride (`app/pages/events/[season]/[race].vue`): the first
  // group's course and laps, and every rule the Race format fixes - the
  // TT-frame bar AND the draft. `buildRecommendQuery` makes the default rider
  // legal for them exactly as it does for the page's own request, so a format
  // with no draft is ranked solo whatever the default draft mode is. A group
  // whose course the catalog does not have (ZRL runs C/D on an unlisted
  // "exclusive" route in week 6) can still be described, just not ranked.
  const ride = raceRide(race, 0)
  const course = ride ? getRouteBySlug(ride.course.slug) : undefined
  // Resolved once, for the statement and the totals alike, as the page does.
  const resolvedRide = course && ride ? rideForRoute(course, ride.laps, ride.ttFramesAllowed === false) : undefined
  const rider = riderInputsForRide(DEFAULT_RIDER_INPUTS, ride)
  // The page's own statement for its first group, on the day it is read.
  const statement = raceStatement({ season, race, groupIndex: 0, resolvedRide, today, siteUrl })

  const result = course && ride ? await rankAsThePage({ kind: 'route', route: course }, ride, context) : undefined
  const ranking = result && 'ranking' in result ? result.ranking : undefined

  const totals = resolvedRide?.totals
  const unavailable = result
    ? rankingUnavailable(result)
    : '_This group races a route the catalog does not carry, so no ranking can be computed for it._'

  const lines = [
    ...rankingHeader(statement.question, (ranking && ride && answerLine(ranking, ride, { rideName: statement.rideName, distanceKm: totals?.distanceKm })) ?? unavailable, canonical),
    '',
    ...factRowLines(statement, [statement.coverageNote, statement.rules.alert, statement.rules.soloNote, statement.officialFiguresNote])
  ]

  lines.push(...rankingSection(ranking, unavailable, rider, [
    `- ${statement.groupLabel}, ${statement.fixedLaps.label}.`
  ], origin))

  lines.push(
    '## The race',
    '',
    ...facts([
      `- **Series**: ${raceContextLabel(season, round)}`,
      `- **Date**: ${statement.dateLabel}`,
      `- **Format**: ${statement.rules.label}`
    ]),
    '',
    '### Category groups',
    '',
    `${statement.groupsCaption}:`,
    '',
    '| Group | Course | Laps | Distance | Elevation |',
    '| --- | --- | --- | --- | --- |',
    ...statement.groups.map((entry, index) =>
      `| ${entry.label}${index === 0 ? ' (ranked above)' : ''} | ${entry.routeSlug ? `[${entry.routeName}](${origin}/routes/${entry.routeSlug})` : entry.routeName} | ${entry.laps} | ${entry.distance} | ${entry.elevation} |`),
    ''
  )

  if (statement.coursesDiffer) {
    lines.push(
      `The ranking above is for ${statement.groupLabel}. `
      + 'Another group racing a different course or lap count gets a different answer - rank it from the route it rides, or with the API below.',
      ''
    )
  }

  lines.push(...scoringLines(statement, origin), ...facts([statement.powerupsLine]).flatMap(line => [line, '']))

  lines.push(...physicsSection(ranking))

  // A race run by the day this is rendered for is what its page is on that
  // day: the notice above the title, and noindex. Everything from the title
  // down is the live twin's, since the page's ranking still holds.
  return {
    markdown: [...(statement.runNotice ? runRaceNoticeLines(statement.runNotice, origin) : []), ...lines, ...nextSteps(origin), ''].join('\n'),
    noindex: statement.hasRun
  }
}

/**
 * A world's name as a twin says it: a link to its World page (#58), on the
 * request's origin. See **World page** in CONTEXT.md - wherever the site
 * names a world, the name leads to its page.
 */
function worldLink(slug: string, name: string, origin: string): string {
  return `[${name}](${origin}/worlds/${slug})`
}

/** `| Slug | Name | ... |` for the route catalog, as the homepage lists it. */
function routeTable(routes: RouteSummary[], origin: string): string[] {
  return [
    '| Route | Slug | World | Distance/lap | Elevation/lap | Terrain | Surface |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...routes.map(route =>
      `| [${route.name}](${origin}/routes/${route.slug}) | \`${route.slug}\` | ${route.worldName} | ${route.distance.toFixed(1)} km | ${Math.round(route.elevation)} m | ${route.terrain.category} | ${formatSurface(route.surface)} |`)
  ]
}

/** `| Segment | Slug | ... |` for a list of climbs and sprints, as the segments index lists them. */
function segmentTable(segments: SegmentSummary[], origin: string): string[] {
  return [
    '| Segment | Slug | Type | World | Length | Elevation | Avg grade |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...segments.map(segment =>
      `| [${segment.name}](${origin}/segments/${segment.slug}) | \`${segment.slug}\` | ${segment.type}${segment.climbType ? ` (${segment.climbType})` : ''} | ${segment.worldName} | ${segment.lengthKm.toFixed(1)} km | ${Math.round(segment.measuredElevationM ?? segment.elevationM)} m | ${(segment.measuredAvgGradePercent ?? segment.avgGradePercent).toFixed(1)}% |`)
  ]
}

async function renderHomeDocument({ origin, siteUrl }: MarkdownRenderContext): Promise<string> {
  // What `/api/routes` lists with no filters: every route, by name.
  const routes = getRoutesWithMeta().map(toRouteSummary).sort((a, b) => a.name.localeCompare(b.name))
  return [
    '# ZwiftBikes - the fastest bike and wheelset for any Zwift route',
    '',
    'ZwiftBikes ranks every Zwift bike frame and wheelset by the finish time a specific rider would get on a specific route, segment or race. '
    + 'Frame and wheel performance is solved from ZwiftInsider\'s published bot-test data and fed to a physics model that simulates the ride over the route\'s real elevation profile, '
    + 'so a recommendation is a predicted time rather than a reputation.',
    '',
    `Canonical page: <${siteUrl}/>`,
    '',
    '## How to get an answer',
    '',
    `- **One route**: fetch \`${origin}/routes/{slug}\` with \`Accept: text/markdown\` for that route's ranking, or take the slug from the table below.`,
    `- **One climb or sprint**: \`${origin}/segments/{slug}\`, and \`${origin}/segments\` for the index of all of them.`,
    `- **For a named rider**: the JSON API at \`${origin}/api/recommend/{slug}?weightKg=&heightCm=&powerW=\`. It takes the rider's weight, height and sustained power, which every predicted time scales with.`,
    `- **Everything at once**: \`${origin}/llms.txt\`.`,
    '',
    '## What the answer rests on',
    '',
    `- ${CONFIDENCE_NOTE} Gravel and fun bikes have no bot-test data at all, so they are absent from a verified-only ranking.`,
    '- Zwift frames upgrade through five stages, and the stage changes which frame wins, not just the times.',
    '- Zwift only lets gravel frames take gravel or mountain wheels, and road or TT frames take road wheels, so a category filter also changes which wheelsets can appear.',
    '- Race formats decide what may be started on: points races, scratch races and WTRL\'s Race of Truth all bar TT frames, and the Race of Truth has no draft at all.',
    '',
    `## Every route (${routes.length})`,
    '',
    ...routeTable(routes, origin),
    '',
    ...nextSteps(origin),
    ''
  ].join('\n')
}

async function renderSegmentsDiscoveryDocument({ origin, siteUrl }: MarkdownRenderContext): Promise<string> {
  const segments = getAllSegmentSummaries()
  return [
    '# Zwift climbs and sprints',
    '',
    'The named climbs and sprints that can be ranked on their own, rather than as part of a whole route. '
    + 'A climb is ridden at race pace and a sprint at sprint power; both are simulated after a flat run-up, so the timed part is entered at racing speed rather than from a standstill.',
    '',
    `Canonical page: <${siteUrl}/segments>`,
    '',
    `## Every climb and sprint (${segments.length})`,
    '',
    ...segmentTable(segments, origin),
    '',
    ...nextSteps(origin),
    ''
  ].join('\n')
}

/**
 * A World page's twin (#58): the world's routes in the homepage twin's
 * table and its climbs and sprints in the segments twin's, in the order the
 * page lists them - both read from `worldListing`, the page's own source.
 * A world with no segments has no segments section, as its page has none.
 */
async function renderWorldDocument(slug: string, { origin, siteUrl }: MarkdownRenderContext): Promise<string> {
  const listing = worldListing(slug)
  if (!listing) throw createError({ statusCode: 404, statusMessage: `World "${slug}" not found` })
  const { world, segments } = listing
  // The table takes the summary the homepage twin's does; the listing's
  // cards say which routes and in what order.
  const summaries = new Map(getRoutesWithMeta().filter(route => route.world === world.slug).map(route => [route.slug, toRouteSummary(route)]))
  const routes = listing.routes.map(card => summaries.get(card.slug)!)
  return [
    `# Every Zwift route in ${world.name}`,
    '',
    `Every cycling route in Zwift's ${world.name}${segments.length ? ', then its named climbs and sprints' : ''}, each linked to its own page, which ranks every frame and wheelset in the game by the finish time it gives a rider there. `
    + `This is the whole world at once: \`${origin}/\` lists the routes of every world, and \`${origin}/segments\` every climb and sprint.`,
    '',
    `Canonical page: <${siteUrl}/worlds/${world.slug}>`,
    '',
    `## Routes (${routes.length})`,
    '',
    ...routeTable(routes, origin),
    '',
    ...(segments.length ? [`## Climbs and sprints (${segments.length})`, '', ...segmentTable(segments, origin), ''] : []),
    ...nextSteps(origin),
    ''
  ].join('\n')
}

/**
 * Which pages have a markdown twin, and how a request path maps onto one.
 *
 * Every Ranking page - route, segment and race, the three that show an
 * Applied Ranking - plus the Discovery pages that lead to them: the
 * homepage, the segments index and the twelve World pages (see the terms in
 * CONTEXT.md). Nothing else: a page whose whole content is
 * hand-written prose (`/about`) would need its text copied into a second
 * place, and the two copies would drift; a page that renders only from the
 * rider's own browser (`/profile`, `/garage`) has no content to serve at
 * all. The season page (`/events/{season}`) is a Discovery page whose races
 * each carry their own document, so it is the one gap left on purpose.
 *
 * Deliberately exact matching, with no trailing-slash tolerance: the site's
 * canonical form is the bare path (`trailingSlash: 'never'`), and the assets
 * layer already redirects the slashed form onto it. Letting that redirect
 * happen keeps one canonical URL per document instead of two that answer.
 */
export function markdownDocumentFor(path: string): MarkdownDocument | undefined {
  if (path === '/') return async context => indexed(await renderHomeDocument(context))
  if (path === '/segments') return async context => indexed(await renderSegmentsDiscoveryDocument(context))

  const world = /^\/worlds\/([^/]+)$/.exec(path)
  if (world?.[1]) {
    const slug = decodeURIComponent(world[1])
    return async context => indexed(await renderWorldDocument(slug, context))
  }

  const route = /^\/routes\/([^/]+)$/.exec(path)
  if (route?.[1]) {
    const slug = decodeURIComponent(route[1])
    return async context => indexed(await renderRouteDocument(slug, context))
  }
  const segment = /^\/segments\/([^/]+)$/.exec(path)
  if (segment?.[1]) {
    const slug = decodeURIComponent(segment[1])
    return async context => indexed(await renderSegmentDocument(slug, context))
  }
  const race = /^\/events\/([^/]+)\/([^/]+)$/.exec(path)
  if (race?.[1] && race[2]) {
    const [, season, raceSlug] = race
    return context => renderRaceDocument(decodeURIComponent(season), decodeURIComponent(raceSlug), context)
  }
  return undefined
}

/**
 * The same set of paths written as Cloudflare static-routing rules - what
 * `assets.run_worker_first` in wrangler.jsonc must contain, exactly.
 *
 * This is the load-bearing half of the feature and the half with no runtime
 * symptom when it is wrong. Cloudflare's asset layer answers a prerendered
 * page BEFORE the Worker runs (see public/_headers), so a path the rules
 * miss never reaches the negotiation middleware at all: the page keeps
 * working, the markdown twin simply never appears, and nothing fails. Hence
 * the list lives here next to the resolver it has to agree with, and
 * `documents.test.ts` reads wrangler.jsonc and fails when the two drift.
 *
 * A rule is an exact path, or a prefix ending in `*`.
 */
export const MARKDOWN_WORKER_FIRST_RULES = ['/', '/events/*', '/routes/*', '/segments', '/segments/*', '/worlds/*'] as const

/**
 * Whether Cloudflare hands this path to the Worker ahead of the asset, under
 * the rules above - evaluated the way the asset router evaluates them: an
 * exact path, or a prefix where the rule ends in `*`.
 *
 * The middleware needs this as well as `markdownDocumentFor`, because the
 * two sets are NOT the same. `/events/*` has to cover
 * `/events/{season}/{race}`, and a prefix rule is the only shape available,
 * so it sweeps in `/events/{season}` - a season page with no twin. Those
 * still arrive at the Worker and still have to be handed back to the asset
 * binding; letting them fall into Nitro instead would re-render a
 * prerendered page on every request, which is the one cost this whole
 * arrangement exists to avoid.
 */
export function isWorkerFirstPath(path: string): boolean {
  return MARKDOWN_WORKER_FIRST_RULES.some(rule =>
    rule.endsWith('*') ? path.startsWith(rule.slice(0, -1)) : path === rule)
}
