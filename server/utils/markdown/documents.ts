import type { ComboScore, RouteSummary, RouteWithMeta, SegmentSummary } from '../../../shared/types/catalog'
import { formatDuration } from '../../../shared/utils/duration'
import {
  categoryGroup,
  draftingAllowed,
  formatCategoryGroup,
  getRaceBySlug,
  getRoundForRace,
  getSeasonBySlug,
  isRacePublishable,
  RACE_FORMAT_LABELS,
  lapsForCategoryGroup,
  raceContextLabel,
  raceDisplayName,
  ttBikesAllowed
} from '../../../shared/utils/events'
import { RECOMMEND_MAX_LIMIT } from '../../../shared/utils/recommendLimits'
import { DEFAULT_HEIGHT_CM, DEFAULT_POWER_W, DEFAULT_SPRINT_POWER_W, DEFAULT_WEIGHT_KG } from '../../../shared/utils/riderBounds'
import { computeRouteTotals, maxLapsForRoute } from '../../../shared/utils/routeLaps'
import { DEFAULT_UNOWNED_LEVEL, MAX_UPGRADE_STAGE } from '../../../shared/utils/upgradeStage'
import {
  CONFIDENCE_NOTE,
  formatComboTable,
  formatRaceFormatAssumption,
  formatSurface,
  type RecommendPagination,
  type RecommendRouteResponse,
  type RecommendSegmentResponse
} from '../mcp/format'

/**
 * The markdown representation of the site's pages - what a caller that sent
 * `Accept: text/markdown` gets instead of the HTML, at the same URL.
 *
 * Two rules shape every document here.
 *
 * **It is the page, not a summary of it.** A markdown twin that answered a
 * different question from the HTML would be cloaking, and the numbers on a
 * ranking page are the answer. So each ranking document is built from the
 * same endpoints, with the same query, for the same phantom default rider
 * (`shared/utils/riderBounds.ts`) that the prerendered HTML is rendered for -
 * see `defaultRankingQuery`. What a rider reads and what an agent reads are
 * the same ranking.
 *
 * **It is written for a model deciding what to say next.** The table, the
 * confidence column and the "measured vs estimated" note are the MCP
 * server's (`server/utils/mcp/format.ts`), reused wholesale rather than
 * re-derived: the two surfaces answer the same question for the same kind of
 * reader, and one formatter means a fix to either lands in both.
 *
 * Reaching the catalog and the ranking through Nitro's in-process `$fetch`
 * is deliberate and mirrors the MCP adapter: the recommend orchestration has
 * exactly one implementation, and a ranking fetched this way rides the
 * endpoint's own edge cache (`server/utils/recommendCache.ts`), so the
 * expensive part of a markdown request is paid once per route per deploy.
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
   * Whether the recommend kill switch is on (`killSwitches.recommend` in
   * `server/utils/siteFlags.ts`). Passed in rather than read here for the
   * same reason the MCP tools take it on their `RpcContext`: this module
   * reaches the ranking through Nitro's in-process `$fetch`, and an internal
   * event carries no KV binding, so `site-flags-gate.ts` never fires for it.
   * A data incident is exactly when a ranking must not slip out of a side
   * door, and this is that door.
   */
  recommendPaused: boolean
}

/**
 * One page's markdown twin. Just the renderer: the path it was resolved from
 * is the caller's already, and handing it back would only invite the two to
 * disagree.
 */
export type MarkdownDocument = (context: MarkdownRenderContext) => Promise<string>

/**
 * The query the prerendered HTML of a ranking page was rendered with:
 * `buildRecommendQuery` in `app/utils/recommendRequest.ts` applied to the
 * composable defaults, with no garage and no stored preferences, because
 * neither exists until the browser hydrates.
 *
 * Kept as its own function with this comment attached because the values are
 * a contract with the client, not choices: `category: 'standard'` and
 * `verifiedOnly` are `usePreferences`' seeds, `maxWheelsetsPerFrame: 1` and
 * `limit` are what one page of results is, and a change to any of them on
 * the client silently makes this document a ranking no rider is shown.
 */
interface RankingQuery {
  category: string
  limit: number
  maxWheelsetsPerFrame: number
  offset: number
  verifiedOnly: 'true' | 'false'
  includeHalo: 'true' | 'false'
  defaultUnownedLevel: number
  weightKg: number
  heightCm: number
  powerW: number
  /** Routes and races only; a segment is ridden once from its timed start. */
  laps?: number
  /** A LEGALITY filter a race format fixes, never a display trim - see `ttBikesAllowed`. */
  excludeTT?: 'true'
}

function defaultRankingQuery(powerW: number): RankingQuery {
  return {
    category: 'standard',
    limit: RECOMMEND_MAX_LIMIT,
    maxWheelsetsPerFrame: 1,
    offset: 0,
    verifiedOnly: 'true',
    includeHalo: 'false',
    defaultUnownedLevel: DEFAULT_UNOWNED_LEVEL,
    weightKg: DEFAULT_WEIGHT_KG,
    heightCm: DEFAULT_HEIGHT_CM,
    powerW
  }
}

/**
 * The one line every ranking document needs and no rider-facing page has to
 * say: these times are for a rider nobody chose. The HTML says it too (the
 * pages carry a "set a profile" notice until one is stored), but a model
 * quoting a finish time has to be able to attribute it, or it will present
 * the default rider's time as the reader's.
 */
function defaultRiderNote(powerW: number): string {
  const wkg = (powerW / DEFAULT_WEIGHT_KG).toFixed(2)
  return `Ranked for the site's default rider - ${DEFAULT_WEIGHT_KG} kg, ${DEFAULT_HEIGHT_CM} cm, ${powerW} W (${wkg} W/kg), riding solo - because a request carries no profile. `
    + 'Every time below scales with those three numbers, so quote them alongside any time you repeat, and rank the reader\'s own with the API described at the end.'
}

/** `12.4 km/h`, the same one-decimal readout the pages show beside a time. */
function formatSpeed(distanceKm: number, seconds: number): string | undefined {
  if (seconds <= 0) return undefined
  return `${(distanceKm / (seconds / 3600)).toFixed(1)} km/h`
}

/**
 * The answer sentence, from rank 1 of the ranking - the same fact the page
 * prints under its recommendation and publishes as FAQ structured data
 * (`faqScript` in `app/utils/rankingResults.ts`), so an agent reading this
 * document and a crawler reading the HTML come away with one answer.
 */
function answerLine(combos: ComboScore[], rideName: string, distanceKm: number | undefined): string | undefined {
  const best = combos[0]
  if (!best || best.finishTimeSec === undefined) return undefined
  const equipment = best.wheelset ? `${best.frame.name} with ${best.wheelset.name}` : `${best.frame.name} (fixed wheels)`
  const speed = distanceKm === undefined ? undefined : formatSpeed(distanceKm, best.finishTimeSec)
  return `Our model puts the **${equipment}** fastest on ${rideName}: **${formatDuration(best.finishTimeSec)}**${speed ? ` (~${speed})` : ''}, under the assumptions below.`
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
    `- Every route, segment and race page answers in markdown when the request sends \`Accept: text/markdown\`, as this one did - as do \`${origin}/\` and \`${origin}/segments\`.`
  ]
}

/**
 * What stands in for the table when there is no ranking to print. The two
 * causes are worth telling apart: a paused ranking is an operational state
 * that will end, while a failed one may be this particular ride refusing to
 * be simulated (a rider who cannot hold the grade at that power), and an
 * agent that cannot distinguish them will retry the wrong one.
 */
function rankingUnavailable(rankingAnswered: boolean, recommendPaused: boolean): string {
  if (recommendPaused) return '_Rankings are temporarily paused for maintenance. The facts below are current; try again shortly._'
  if (rankingAnswered) return '_No verified frame and wheel combination matched. Gravel and fun bikes have no bot-test data, so a verified-only ranking excludes them._'
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
function depthNote(pagination: RecommendPagination, origin: string): string {
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
 * Filters and assumptions the ranking was produced under, as bullets. Every
 * one of them narrows what "fastest" means, and a model relaying the answer
 * without them would overstate it - the same reasoning that puts these on
 * the page as the recommendation's small print.
 */
function rankingAssumptions(powerW: number, extra: string[]): string[] {
  return [
    '',
    '- Road bikes only (the site\'s default category); TT, gravel and fun frames are ranked when asked for explicitly.',
    '- Verified equipment only: frames and wheels whose numbers come from real ZwiftInsider bot tests.',
    `- Every frame assumed at Zwift upgrade stage ${DEFAULT_UNOWNED_LEVEL} of ${MAX_UPGRADE_STAGE}${DEFAULT_UNOWNED_LEVEL === MAX_UPGRADE_STAGE ? ' (fully upgraded)' : DEFAULT_UNOWNED_LEVEL === 0 ? ' (stock, as bought)' : ''}, and unowned Halo frames excluded.`,
    '- One row per frame, paired with its own fastest wheelset for this ride.',
    ...extra,
    '',
    defaultRiderNote(powerW)
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
  ranking: { combos: ComboScore[], pagination: RecommendPagination } | undefined,
  unavailable: string,
  powerW: number,
  extraAssumptions: (string | undefined)[],
  origin: string
): string[] {
  const heading = '## Fastest bike and wheel combinations'
  if (!ranking) return [heading, '', unavailable, '']
  return [
    heading,
    ...rankingAssumptions(powerW, facts(extraAssumptions)),
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

async function renderRouteDocument(slug: string, { origin, siteUrl, recommendPaused }: MarkdownRenderContext): Promise<string> {
  const route = await $fetch<RouteWithMeta>(`/api/routes/${encodeURIComponent(slug)}`)
  const canonical = `${siteUrl}/routes/${route.slug}`
  // One lap is what the page's lap picker starts on and therefore what its
  // prerendered ranking is for; `computeRouteTotals` adds the lead-in, which
  // is ridden once and is the difference between the route's published
  // distance and the distance actually raced.
  const totals = computeRouteTotals(route, 1)
  const question = `What's the fastest bike for ${route.name}?`

  // A ranking is the point of the page but not a precondition for the
  // document: the kill switch can pause recommendations
  // (`server/middleware/site-flags-gate.ts`) and a rider who cannot hold the
  // grade makes the simulator refuse (422). Either way the route's own facts
  // are still worth serving, and an agent gets an honest "not right now"
  // instead of a 5xx.
  const ranking = recommendPaused
    ? undefined
    : await $fetch<RecommendRouteResponse>(`/api/recommend/${encodeURIComponent(route.slug)}`, {
        query: { ...defaultRankingQuery(DEFAULT_POWER_W), laps: 1 }
      }).catch(() => undefined)

  const unavailable = rankingUnavailable(ranking !== undefined, recommendPaused)
  const lines = [
    ...rankingHeader(question, (ranking && answerLine(ranking.combos, route.name, totals.distanceKm)) ?? unavailable, canonical),
    '',
    `${route.name} is a ${route.terrain.category} route in ${route.worldName}: ${totals.distanceKm.toFixed(1)} km and ${Math.round(totals.elevationM)} m of climbing for one lap, lead-in included.`,
    ''
  ]

  lines.push(...rankingSection(ranking, unavailable, DEFAULT_POWER_W, ['- One lap, including the lead-in once.'], origin))

  lines.push(
    '## The route',
    '',
    ...facts([
      `- **Slug**: \`${route.slug}\` (the id the API takes)`,
      `- **World**: ${route.worldName}`,
      `- **One lap**: ${route.distance.toFixed(1)} km, ${Math.round(route.elevation)} m`,
      route.leadInDistance ? `- **Lead-in** (ridden once): ${route.leadInDistance.toFixed(1)} km, ${Math.round(route.leadInElevation ?? 0)} m` : undefined,
      `- **Lappable**: ${route.lap ? `yes, up to ${maxLapsForRoute(route)} laps on this site` : 'no - point to point, ridden once'}`,
      `- **Terrain**: ${route.terrain.category}, ${Math.round(route.terrain.climbRatio)} m of climbing per km`,
      `- **Surface**: ${formatSurface(route.surface)}`,
      `- **Event only**: ${route.eventOnly ? 'yes - it can only be ridden in an event' : 'no - it can be free-ridden as well as raced'}`,
      // Which of the three geometry sources the physics model got, said the
      // same way `get_route` says it to an MCP client.
      `- **Elevation data**: ${route.terrain.elevationProfile ? 'real measured GPS profile' : route.terrain.climbs.length > 0 ? 'named climbs plus a synthesized remainder' : 'synthesized from aggregate distance and elevation'}`
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

async function renderSegmentDocument(slug: string, { origin, siteUrl, recommendPaused }: MarkdownRenderContext): Promise<string> {
  // The segment endpoint carries the synthetic segment-as-route alongside the
  // summary, which is where a climb's surface mix and terrain live.
  const segment = await $fetch<SegmentSummary & { route: RouteWithMeta }>(`/api/segments/${encodeURIComponent(slug)}`)
  const canonical = `${siteUrl}/segments/${segment.slug}`
  // A sprint is ridden at the rider's sprint power, never at race pace - the
  // same substitution `ridePowerW` makes for the page, and the reason a
  // sprint document quotes a different W figure from a climb's.
  const powerW = segment.type === 'sprint' ? DEFAULT_SPRINT_POWER_W : DEFAULT_POWER_W
  const question = `What's the fastest bike for ${segment.name}?`

  const ranking = recommendPaused
    ? undefined
    : await $fetch<RecommendSegmentResponse>(`/api/recommend/segments/${encodeURIComponent(segment.slug)}`, {
        query: defaultRankingQuery(powerW)
      }).catch(() => undefined)

  const elevationM = Math.round(segment.measuredElevationM ?? segment.elevationM)
  const gradePercent = (segment.measuredAvgGradePercent ?? segment.avgGradePercent).toFixed(1)

  const unavailable = rankingUnavailable(ranking !== undefined, recommendPaused)
  const lines = [
    ...rankingHeader(question, (ranking && answerLine(ranking.combos, segment.name, segment.lengthKm)) ?? unavailable, canonical),
    '',
    `${segment.name} is a ${segment.type} in ${segment.worldName}: ${segment.lengthKm.toFixed(1)} km at ${gradePercent}% average grade, ${elevationM} m of elevation.`,
    ''
  ]

  lines.push(...rankingSection(ranking, unavailable, powerW, [
    '- The timed segment only, excluding any warm-up: it is simulated after a flat run-up so it is entered at racing speed rather than from a standstill, which is how a Zwift or Strava segment is actually ridden.',
    segment.type === 'sprint' ? '- Ridden at sprint power, not race pace - a sprint is a different effort from a route.' : undefined
  ], origin))

  lines.push(
    '## The segment',
    '',
    ...facts([
      `- **Slug**: \`${segment.slug}\` (the id the API takes)`,
      `- **Type**: ${segment.type}${segment.climbType ? `, climb category ${segment.climbType}` : ''}`,
      `- **World**: ${segment.worldName}`,
      `- **Length**: ${segment.lengthKm.toFixed(1)} km`,
      `- **Elevation**: ${elevationM} m at ${gradePercent}% average`,
      `- **Surface**: ${formatSurface(segment.route.surface)}`,
      // `membership` means no host route publishes where along itself the
      // segment sits, so its length and grade come from the segment's own
      // record - the page captions the ranking the same way rather than
      // implying a placement it does not have.
      segment.placement === 'membership'
        ? '- **Placement**: no route publishes where this segment sits along it, so its length and grade come from the segment\'s own record rather than from a measured slice of a route.'
        : undefined
    ]),
    ''
  )

  if (segment.hostRoutes.length > 0) {
    lines.push(
      '### Routes this segment appears on',
      '',
      ...segment.hostRoutes.map(host => `- [${host.name}](${origin}/routes/${host.slug})`),
      ''
    )
  }

  lines.push(...physicsSection(ranking))

  return [...lines, ...nextSteps(origin), ''].join('\n')
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
async function renderRaceDocument(seasonSlug: string, raceSlug: string, { origin, siteUrl, recommendPaused }: MarkdownRenderContext): Promise<string> {
  const season = getSeasonBySlug(seasonSlug)
  const race = season ? getRaceBySlug(seasonSlug, raceSlug) : undefined
  // The same gate the prerender list and the sitemap use: a race the
  // organiser has not published details for has no page, so it has no twin.
  if (!season || !race || !isRacePublishable(race)) {
    throw createError({ statusCode: 404, statusMessage: `Race "${raceSlug}" not found in season "${seasonSlug}"` })
  }

  const round = getRoundForRace(season, race)
  const title = `${raceContextLabel(season, round)} ${raceDisplayName(race)}`
  const canonical = `${siteUrl}/events/${season.slug}/${race.slug}`
  // The page's own question, not the route pages' - a rider reaching a race
  // is asking what they may start on as much as what is quickest.
  const question = `What bike should I ride for ${title}?`

  const group = categoryGroup(race)
  const laps = lapsForCategoryGroup(race)
  const courseSlug = group?.routeSlug
  // A group whose course the catalog does not have (ZRL runs C/D on an
  // unlisted "exclusive" route in week 6) can still be described, just not
  // ranked - the page makes the same distinction.
  const course = courseSlug
    ? await $fetch<RouteWithMeta>(`/api/routes/${encodeURIComponent(courseSlug)}`).catch(() => undefined)
    : undefined

  const ranking = recommendPaused || !course
    ? undefined
    : await $fetch<RecommendRouteResponse>(`/api/recommend/${encodeURIComponent(course.slug)}`, {
        query: {
          ...defaultRankingQuery(DEFAULT_POWER_W),
          laps,
          // Not a display trim: `category` cannot express "road AND gravel
          // but never TT", which is what a points or scratch race allows.
          excludeTT: ttBikesAllowed(race.format) ? undefined : 'true'
        }
      }).catch(() => undefined)

  const totals = course ? computeRouteTotals(course, laps) : undefined
  const rideName = course ? `${laps} lap${laps === 1 ? '' : 's'} of ${course.name}` : (group?.routeName ?? 'this race')
  const unavailable = course
    ? rankingUnavailable(ranking !== undefined, recommendPaused)
    : '_This group races a route the catalog does not carry, so no ranking can be computed for it._'

  const lines = [
    ...rankingHeader(question, (ranking && answerLine(ranking.combos, rideName, totals?.distanceKm)) ?? unavailable, canonical),
    '',
    `${title} is a ${RACE_FORMAT_LABELS[race.format].toLowerCase()} on ${race.date}${course ? `, over ${rideName} in ${course.worldName}` : ''}.`,
    ''
  ]

  lines.push(...rankingSection(ranking, unavailable, DEFAULT_POWER_W, [
    `- ${formatCategoryGroup(group ?? { cats: [], label: 'the first group' })}: ${laps} lap${laps === 1 ? '' : 's'}${totals ? `, ${totals.distanceKm.toFixed(1)} km and ${Math.round(totals.elevationM)} m` : ''}.`,
    // The format's consequence spelled out, from the same wording the MCP
    // tools give a model - an override a reader cannot see is one they will
    // confidently misreport (issue #225).
    formatRaceFormatAssumption(race.format, undefined)
  ], origin))

  lines.push(
    '## The race',
    '',
    ...facts([
      `- **Series**: ${raceContextLabel(season, round)}`,
      `- **Date**: ${race.date}${race.endDate && race.endDate !== race.date ? ` to ${race.endDate}` : ''}`,
      `- **Format**: ${RACE_FORMAT_LABELS[race.format]}`,
      `- **TT frames**: ${ttBikesAllowed(race.format) ? 'allowed - Zwift enables them, with draft, for a team time trial' : 'barred - none are ranked above'}`,
      `- **Drafting**: ${draftingAllowed(race.format) ? 'yes' : 'no - ridden solo'}`
    ]),
    '',
    '### Category groups',
    '',
    '| Group | Laps | Course |',
    '| --- | --- | --- |',
    ...race.categories.map((entry, index) =>
      `| ${formatCategoryGroup(entry)}${index === 0 ? ' (ranked above)' : ''} | ${entry.laps} | ${entry.routeSlug ? `[${entry.routeName ?? entry.routeSlug}](${origin}/routes/${entry.routeSlug})` : (entry.routeName ?? 'to be confirmed')} |`),
    ''
  )

  if (race.categories.length > 1) {
    lines.push(
      `The ranking above is for ${formatCategoryGroup(race.categories[0]!)}. `
      + 'Another group racing a different course or lap count gets a different answer - rank it from the route it rides, or with the API below.',
      ''
    )
  }

  lines.push(...physicsSection(ranking))

  return [...lines, ...nextSteps(origin), ''].join('\n')
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

async function renderHomeDocument({ origin, siteUrl }: MarkdownRenderContext): Promise<string> {
  const { routes } = await $fetch<{ routes: RouteSummary[] }>('/api/routes')
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
  const { segments } = await $fetch<{ segments: SegmentSummary[] }>('/api/segments')
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
    '| Segment | Slug | Type | World | Length | Elevation | Avg grade |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...segments.map(segment =>
      `| [${segment.name}](${origin}/segments/${segment.slug}) | \`${segment.slug}\` | ${segment.type}${segment.climbType ? ` (${segment.climbType})` : ''} | ${segment.worldName} | ${segment.lengthKm.toFixed(1)} km | ${Math.round(segment.measuredElevationM ?? segment.elevationM)} m | ${(segment.measuredAvgGradePercent ?? segment.avgGradePercent).toFixed(1)}% |`),
    '',
    ...nextSteps(origin),
    ''
  ].join('\n')
}

/**
 * Which pages have a markdown twin, and how a request path maps onto one.
 *
 * Every Ranking page - route, segment and race, the three that show an
 * Applied Ranking - plus the two Discovery pages that lead to them (see both
 * terms in CONTEXT.md). Nothing else: a page whose whole content is
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
  if (path === '/') return renderHomeDocument
  if (path === '/segments') return renderSegmentsDiscoveryDocument

  const route = /^\/routes\/([^/]+)$/.exec(path)
  if (route?.[1]) {
    const slug = decodeURIComponent(route[1])
    return context => renderRouteDocument(slug, context)
  }
  const segment = /^\/segments\/([^/]+)$/.exec(path)
  if (segment?.[1]) {
    const slug = decodeURIComponent(segment[1])
    return context => renderSegmentDocument(slug, context)
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
export const MARKDOWN_WORKER_FIRST_RULES = ['/', '/events/*', '/routes/*', '/segments', '/segments/*'] as const

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
