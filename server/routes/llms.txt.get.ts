import type { RouteSummary, SegmentSummary } from '../../shared/types/catalog'

/**
 * `/llms.txt` - the site index written for a model rather than a crawler
 * (llmstxt.org), and the one URL an agent can be pointed at to discover
 * everything else.
 *
 * It exists because the markdown negotiation it advertises is invisible: an
 * agent that fetches a page as HTML has no way to learn that the same URL
 * would have answered in markdown, and no way to enumerate the 300-odd
 * routes without crawling. This file is both - the contract, and the list.
 *
 * Served from the Worker rather than prerendered, unlike robots.txt and the
 * sitemap: every link in it is absolute, the absolute origin is the
 * request's own, and a build-time render would bake `localhost` into the
 * preview Workers and the production file alike. The content is a catalog
 * read and some string building - no physics, no ranking - so the Worker
 * cost is trivial, and the cache header below spares the repeat.
 */

/**
 * Longer than the catalog endpoints' 300s and for the same reason it can be:
 * this file changes only when the route or segment catalog does, which is a
 * deploy. Left as a browser/proxy-level hint rather than an edge cache,
 * matching the `routeRules` in nuxt.config.ts.
 */
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400'

/**
 * A slug for the example API links below, taken from the catalog that was
 * just fetched rather than written into this file: a hardcoded example is a
 * link that 404s the first time Zwift retires the route it names (this one
 * shipped pointing at `watopia-flat-route`, which no longer exists). The
 * preferred slug is used when it is still there, so the example stays a
 * route a reader recognises, and the first of the catalog otherwise.
 */
function exampleSlug(slugs: string[], preferred: string): string {
  return slugs.includes(preferred) ? preferred : (slugs[0] ?? preferred)
}

export default defineEventHandler(async (event) => {
  const origin = getRequestURL(event).origin
  // The same endpoints the pages themselves list from, so the index cannot
  // describe a catalog the site does not serve.
  const [{ routes }, { segments }] = await Promise.all([
    $fetch<{ routes: RouteSummary[] }>('/api/routes'),
    $fetch<{ segments: SegmentSummary[] }>('/api/segments')
  ])

  const exampleRoute = exampleSlug(routes.map(route => route.slug), 'hilly-route')
  const exampleSegment = exampleSlug(segments.map(segment => segment.slug), 'alpe-du-zwift')

  const body = [
    '# ZwiftBikes',
    '',
    '> Ranks every Zwift bike frame and wheelset by the finish time a specific rider would get on a specific route, climb, sprint or race.',
    '',
    'Frame and wheel performance is solved from ZwiftInsider\'s published bot-test data and fed to a physics model that simulates the ride over the route\'s real elevation profile, '
    + 'so a recommendation is a predicted time rather than a reputation. Every predicted time scales with the rider\'s weight, height and sustained power, so ask for those before quoting one.',
    '',
    'Every page listed below also answers in markdown: send `Accept: text/markdown` and the same URL returns `text/markdown` instead of HTML, with an `x-markdown-tokens` header estimating what it costs to read.',
    '',
    '## Start here',
    '',
    `- [All routes](${origin}/): the route catalog, and what the site is.`,
    `- [Climbs and sprints](${origin}/segments): the named segments that can be ranked on their own.`,
    `- [Races](${origin}/events): organiser calendars, with the format rules each race fixes.`,
    `- [About](${origin}/about): where the data comes from, and what the model does and does not claim.`,
    '',
    '## Ranking for a named rider',
    '',
    `- [MCP server](${origin}/api/mcp): streamable HTTP, no auth. \`set_rider_profile\`, then \`recommend_for_route\` or \`recommend_for_segment\`. The best fit for a conversation.`,
    `- [Route ranking API](${origin}/api/recommend/${exampleRoute}?weightKg=75&heightCm=175&powerW=225): \`GET /api/recommend/{routeSlug}\`, JSON.`,
    `- [Segment ranking API](${origin}/api/recommend/segments/${exampleSegment}?weightKg=75&heightCm=175&powerW=225): \`GET /api/recommend/segments/{segmentSlug}\`, JSON.`,
    `- [Route catalog API](${origin}/api/routes) and [segment catalog API](${origin}/api/segments): slugs, distances, elevation and surface mix.`,
    '',
    '## What a ranking rests on',
    '',
    '- `measured` equipment has real ZwiftInsider bot-test numbers behind it; `estimated` equipment is a name-and-style heuristic and should be quoted as a rough guide. Gravel and fun bikes have no bot-test data at all.',
    '- Zwift frames upgrade through five stages, and the stage assumed changes which frame wins, not only the times.',
    '- Zwift only lets gravel frames take gravel or mountain wheels, and road or TT frames take road wheels.',
    '- Race formats decide what may be started on: points races, scratch races and WTRL\'s Race of Truth all bar TT frames, and the Race of Truth has no draft at all.',
    '',
    `## Routes (${routes.length})`,
    '',
    ...routes.map(route =>
      `- [${route.name}](${origin}/routes/${route.slug}): ${route.worldName}, ${route.distance.toFixed(1)} km, ${Math.round(route.elevation)} m, ${route.terrain.category}.`),
    '',
    `## Climbs and sprints (${segments.length})`,
    '',
    ...segments.map(segment =>
      `- [${segment.name}](${origin}/segments/${segment.slug}): ${segment.worldName}, ${segment.type}, ${segment.lengthKm.toFixed(1)} km at ${(segment.measuredAvgGradePercent ?? segment.avgGradePercent).toFixed(1)}%.`),
    ''
  ].join('\n')

  setResponseHeaders(event, {
    // `text/plain` rather than `text/markdown`, which is the convention for
    // this file and what every published llms.txt serves: it is fetched by
    // name rather than negotiated, and a browser opening the URL should
    // read it rather than download it.
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': CACHE_CONTROL
  })
  return body
})
