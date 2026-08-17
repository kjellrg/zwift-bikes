import type { ClassifiedBikeFrame, RouteSummary, RouteWithMeta, SegmentSummary, Wheelset } from '../../../shared/types/catalog'
import { DEFAULT_UNOWNED_LEVEL } from '../../../shared/utils/classifyBikeFrame'
import { clampLaps, computeRouteTotals, MAX_LAPS } from '../../../shared/utils/routeLaps'
import type { RpcContext } from './protocol'
import {
  CONFIDENCE_NOTE,
  formatComboTable,
  formatPagination,
  formatSurface,
  formatRaceAssumption,
  formatTttAssumption,
  type RecommendRouteResponse,
  type RecommendSegmentResponse
} from './format'
import { getRiderProfile, parseRiderProfile, setRiderProfile, type RiderProfile } from './session'

interface ToolResult {
  content: { type: 'text', text: string }[]
  isError?: boolean
}

interface ToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, context: RpcContext) => Promise<ToolResult> | ToolResult
}

function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] }
}

function failure(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }], isError: true }
}

/**
 * Every tool reaches the catalog and the ranking pipeline through the same
 * HTTP endpoints the web app uses, via Nitro's in-process `$fetch` (no network
 * hop). That keeps a single implementation of the recommend orchestration -
 * whose ordering is subtle enough that a second copy would drift (see the
 * comments in `server/api/recommend/[slug].get.ts` about search, capping and
 * simulated-time re-ordering) - and means a filter added to an endpoint is
 * inherited here for free.
 */
async function fetchApi<T>(path: string, query: Record<string, unknown>): Promise<T> {
  return await $fetch<T>(path, { query })
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : undefined
}

/** Turns an unknown slug into a short "did you mean" list instead of a bare 404. */
async function suggestRoutes(slug: string): Promise<string> {
  const term = slug.split('-').filter(word => word.length > 3).pop() ?? slug
  try {
    const { routes } = await fetchApi<{ routes: RouteSummary[] }>('/api/routes', { search: term })
    if (routes.length === 0) return 'Call `list_routes` to find the right slug.'
    return `Did you mean: ${routes.slice(0, 5).map(route => `\`${route.slug}\` (${route.name})`).join(', ')}?`
  } catch {
    return 'Call `list_routes` to find the right slug.'
  }
}

async function suggestSegments(slug: string): Promise<string> {
  const term = slug.split('-').filter(word => word.length > 3).pop() ?? slug
  try {
    const { segments } = await fetchApi<{ segments: SegmentSummary[] }>('/api/segments', { search: term })
    if (segments.length === 0) return 'Call `list_segments` to find the right slug.'
    return `Did you mean: ${segments.slice(0, 5).map(segment => `\`${segment.slug}\` (${segment.name})`).join(', ')}?`
  } catch {
    return 'Call `list_segments` to find the right slug.'
  }
}

const NO_PROFILE_MESSAGE = 'No rider profile is set for this session, so finish times cannot be predicted - and a ranking without them would be a much coarser guess.\n\n'
  + 'Ask the user for:\n'
  + '- their weight in kilograms\n'
  + '- their height in centimetres\n'
  + '- the sustained power they can hold for the length of this effort, in watts per kilogram (W/kg)\n\n'
  + 'Then call `set_rider_profile` once, or pass `weightKg`, `heightCm` and `wkg` directly to this tool. Do not guess these values: every predicted time scales directly with them.'

/**
 * Resolves the profile a recommend call should use. Inline arguments win over
 * the stored session profile, so a stateless caller never has to depend on
 * server-side session state surviving between requests (see `session.ts`).
 */
function resolveProfile(args: Record<string, unknown>, context: RpcContext): { profile: RiderProfile } | { error: string } {
  const hasInline = args.weightKg !== undefined || args.heightCm !== undefined || args.wkg !== undefined
  if (hasInline) {
    const parsed = parseRiderProfile(args)
    if ('error' in parsed) return { error: `${parsed.error}\n\nPass all three of \`weightKg\`, \`heightCm\` and \`wkg\` together, or set them once with \`set_rider_profile\`.` }
    return parsed
  }

  const stored = getRiderProfile(context.sessionId)
  if (stored) return { profile: stored }
  return { error: NO_PROFILE_MESSAGE }
}

/**
 * Whether this call ranks verified equipment only. Defaults to `true`: an
 * `estimated` score is a name/style heuristic, and presenting a finish time
 * built on one as a prediction overstates what is known. Opting out is one
 * argument away, and `VERIFIED_FILTER_NOTE` tells the model when it needs to.
 */
function isVerifiedOnly(args: Record<string, unknown>): boolean {
  return args.verifiedOnly !== false
}

/**
 * Carried on every verified-filtered response. Gravel and fun frames have no
 * bot-test data at all, so the default silently removes both categories
 * outright - a model that doesn't know that would report "no bikes match"
 * on an off-road route instead of widening the search.
 */
const VERIFIED_FILTER_NOTE = 'Ranking verified equipment only (real ZwiftInsider bot-test data). '
  + 'Pass `verifiedOnly: false` to include heuristic estimates - required for gravel and fun bikes, which have no bot-test data at all.'

/**
 * Returned instead of an empty table when the verified filter is what emptied
 * it. A bare "no results" would read as "no such bike exists" and end the
 * model's attempt; naming the retry keeps the answer one call away.
 */
function emptyVerifiedMessage(): string {
  return 'No verified frame/wheel combinations matched.\n\n'
    + `${VERIFIED_FILTER_NOTE}\n\n`
    + 'If the user asked about gravel, a fun bike, or a specific frame by name, retry this call with `verifiedOnly: false`.'
}

/**
 * The upgrade stage this call assumes. Clamped here as well as in the
 * endpoints - the duplication buys a header that reports the stage actually
 * used, rather than echoing an out-of-range number back at the model.
 */
function upgradeLevelFor(args: Record<string, unknown>): number {
  const level = Number(args.upgradeLevel)
  return Number.isFinite(level) ? Math.min(5, Math.max(0, level)) : DEFAULT_UNOWNED_LEVEL
}

/** Query params shared by both recommend endpoints. */
function recommendQuery(args: Record<string, unknown>, profile: RiderProfile): Record<string, unknown> {
  return {
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    wkg: profile.wkg,
    // Falls back to the shared constant, not a local 0: the assumed stage
    // changes which frame wins, so an adapter picking its own default would
    // answer the same question differently from the site.
    defaultUnownedLevel: upgradeLevelFor(args),
    // One row per frame, carrying that frame's fastest wheelset for this
    // route. The web UI can afford to show a frame's top few wheelsets side by
    // side; in a chat answer those extra rows push distinct *bikes* off the
    // page, which is the thing actually being asked about. Applied after
    // ranking, so nothing is removed from consideration - and skipped
    // entirely while searching, where every real match should surface.
    maxWheelsetsPerFrame: 1,
    category: typeof args.category === 'string' ? args.category : undefined,
    // Sent explicitly either way rather than relying on the endpoint default,
    // so this adapter's behaviour can't drift if that default changes.
    verifiedOnly: isVerifiedOnly(args) ? 'true' : 'false',
    search: typeof args.search === 'string' && args.search ? args.search : undefined,
    limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 9,
    offset: Number.isFinite(Number(args.offset)) ? Number(args.offset) : 0,
    // Omitted entirely in solo mode, matching the web pages - a solo request is
    // byte-identical to one from before draft mode existed. Race mode sends the
    // mode and nothing else; it has no parameters.
    draftMode: args.draftMode === 'ttt' ? 'ttt' : args.draftMode === 'race' ? 'race' : undefined,
    tttRiders: args.draftMode === 'ttt' && Number.isFinite(Number(args.tttRiders)) ? Number(args.tttRiders) : undefined,
    tttClimbWkg: args.draftMode === 'ttt' && Number.isFinite(Number(args.tttClimbWkg)) ? Number(args.tttClimbWkg) : undefined
  }
}

/** Shared filter/paging properties on both recommend tools' input schemas. */
const RECOMMEND_FILTER_PROPERTIES = {
  weightKg: { type: 'number', description: 'Rider weight in kilograms. Only needed to override (or stand in for) the session profile set by `set_rider_profile`.' },
  heightCm: { type: 'number', description: 'Rider height in centimetres (100-220). Affects aerodynamic drag. Pass together with weightKg and wkg.' },
  wkg: { type: 'number', description: 'Sustained power in watts per kilogram for an effort of this length. Pass together with weightKg and heightCm.' },
  upgradeLevel: { type: 'number', description: `Assume every bike is at this Zwift upgrade stage, 0-5 (0 = stock, just unlocked; 5 = fully upgraded). Defaults to ${DEFAULT_UNOWNED_LEVEL}. Frames upgrade along different per-stage schemes, so this changes which bike wins, not just the times - pass 0 if the user is asking about bikes as they come out of the drop shop.` },
  category: { type: 'string', enum: ['standard', 'tt', 'gravel', 'handbike', 'funbike'], description: 'Restrict to one Zwift garage category. Note Zwift only lets gravel frames take gravel/mountain wheels and road/TT frames take road wheels, so this also changes which wheelsets appear.' },
  verifiedOnly: { type: 'boolean', description: 'Defaults to true: rank only frames and wheels whose performance comes from real ZwiftInsider bot-test data. Set to false to also include heuristic estimates - necessary for gravel and fun bikes, which have no bot-test data and are therefore absent by default, and worth doing if the user asks about a specific bike that returns no results.' },
  search: { type: 'string', description: 'Only include combos whose frame or wheelset name matches this text. Use to answer "how fast would MY bike be" without ranking the whole catalog.' },
  limit: { type: 'number', description: 'How many combos to return, 1-9. Defaults to 9.' },
  offset: { type: 'number', description: 'Skip this many ranks, for paging past the first page of results.' },
  draftMode: { type: 'string', enum: ['solo', 'ttt', 'race'], description: 'Defaults to solo (a lone rider, no draft - how ZwiftInsider\'s bot tests ride). "ttt" models a rotating Team Time Trial paceline. The rider\'s wkg still means their OWN average over a full rotation (what they can sustain), and the group rides at the speed that combined effort produces - roughly the speed of a solo rider at 1.38x their power for an 8-rider team. The response gains a physics.ttt block with the pull/last-wheel watts and a simulated "saves vs riding this alone at the same effort" comparison. "race" models a mass-start bunch (any points/scratch race, group ride or crit) using one draft saving calibrated against thirteen real ZwiftPower race fields - it takes NO further parameters, and the rider\'s wkg still means their own MECHANICAL AVERAGE power for the whole race, not their normalised power (feeding NP in overstates the prediction by ~2%). It estimates a TYPICAL MID-PACK finish time, not a win, a breakaway or a solo effort off the front; a real bunch spreads about +/-1-2% around it. The response gains a physics.race block with the applied saving and the same "saves vs riding solo" comparison.' },
  tttRiders: { type: 'number', description: 'TTT mode only: riders in the rotation, 2-8. Defaults to 8. Bigger teams are faster for the same per-rider effort, because each rider spends a smaller share of the time on the front.' },
  tttClimbWkg: { type: 'number', description: 'TTT mode only, optional: the team\'s average W/kg on climbs over ~3.5 minutes, where the paceline breaks up (2-9). Applied instead of the rider\'s flat-effort wkg on those climbs. Omit to ride climbs at the same wkg.' }
} as const

const TOOLS: ToolDefinition[] = [
  {
    name: 'set_rider_profile',
    title: 'Set rider profile',
    description: 'Store the rider\'s weight, height and sustained power for this session so bike recommendations can be ranked by predicted finish time. '
      + 'Call this as soon as the user gives you those three values, before calling recommend_for_route or recommend_for_segment. '
      + 'If the user has not given them, ask - do not guess, and do not convert from units you are unsure about.',
    inputSchema: {
      type: 'object',
      properties: {
        weightKg: { type: 'number', description: 'Rider weight in kilograms (not pounds).' },
        heightCm: { type: 'number', description: 'Rider height in centimetres, between 100 and 220 (not inches).' },
        wkg: { type: 'number', description: 'Sustained power in watts per kilogram - e.g. 3.2, not 240. If the user gives absolute watts, divide by their weight in kg.' }
      },
      required: ['weightKg', 'heightCm', 'wkg'],
      additionalProperties: false
    },
    handler: (args, context) => {
      const parsed = parseRiderProfile(args)
      if ('error' in parsed) return failure(parsed.error)

      if (!context.sessionId) {
        return failure('This request carried no MCP session, so the profile cannot be stored. '
          + 'Pass `weightKg`, `heightCm` and `wkg` directly to `recommend_for_route` / `recommend_for_segment` instead.')
      }

      setRiderProfile(context.sessionId, parsed.profile)
      const { weightKg, heightCm, wkg } = parsed.profile
      return text(`Rider profile set: ${weightKg} kg, ${heightCm} cm, ${wkg} W/kg (${Math.round(weightKg * wkg)} W). `
        + 'It will be used by every recommendation for the rest of this session.')
    }
  },

  {
    name: 'get_rider_profile',
    title: 'Get rider profile',
    description: 'Read back the rider profile stored for this session. Call this before asking the user for their weight, height and power again - they may already have provided them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, context) => {
      const profile = getRiderProfile(context.sessionId)
      if (!profile) return text('No rider profile is set for this session. Ask the user for their weight (kg), height (cm) and sustained power (W/kg), then call `set_rider_profile`.')
      return text(`Rider profile: ${profile.weightKg} kg, ${profile.heightCm} cm, ${profile.wkg} W/kg (${Math.round(profile.weightKg * profile.wkg)} W).`)
    }
  },

  {
    name: 'list_routes',
    title: 'List Zwift routes',
    description: 'Search Zwift routes and return their slugs, distance, elevation and surface mix. '
      + 'Call this to turn a route name the user typed into the slug that recommend_for_route needs, or to find routes matching a description (e.g. long climbs in Watopia, routes with gravel).',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Match against the route name.' },
        world: { type: 'string', description: 'Restrict to one world slug, e.g. "watopia", "france", "london".' },
        surface: { type: 'string', enum: ['gravel', 'cobble'], description: 'Only routes that include this surface type.' },
        minDistance: { type: 'number', description: 'Minimum lap distance in km.' },
        maxDistance: { type: 'number', description: 'Maximum lap distance in km.' },
        minElevation: { type: 'number', description: 'Minimum lap elevation gain in m.' },
        maxElevation: { type: 'number', description: 'Maximum lap elevation gain in m.' },
        limit: { type: 'number', description: 'How many routes to return. Defaults to 40.' }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      const limit = Number.isFinite(Number(args.limit)) ? Math.min(100, Math.max(1, Number(args.limit))) : 40
      const { routes } = await fetchApi<{ routes: RouteSummary[] }>('/api/routes', {
        search: args.search,
        world: args.world,
        surface: args.surface,
        minDistance: args.minDistance,
        maxDistance: args.maxDistance,
        minElevation: args.minElevation,
        maxElevation: args.maxElevation
      })

      if (routes.length === 0) return text('No routes matched those filters.')

      const rows = routes.slice(0, limit).map(route =>
        `| \`${route.slug}\` | ${route.name} | ${route.worldName} | ${route.distance} km | ${route.elevation} m | ${route.terrain.category} | ${formatSurface(route.surface)} |`)

      const truncated = routes.length > limit ? `\n\n${routes.length - limit} more matched; narrow the search or raise \`limit\`.` : ''
      return text([
        `${routes.length} route(s) matched.`,
        '',
        '| Slug | Name | World | Distance/lap | Elevation/lap | Terrain | Surface |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows
      ].join('\n') + truncated)
    }
  },

  {
    name: 'get_route',
    title: 'Get route detail',
    description: 'Full detail for one route: distance, elevation, lead-in, whether it can be lapped, its named climbs and sprints, and its measured surface composition. '
      + 'Call this when the user asks what a route is like, or to check how many laps make sense before calling recommend_for_route.',
    inputSchema: {
      type: 'object',
      properties: { route: { type: 'string', description: 'Route slug, e.g. "watopia-big-foot-hills". Use list_routes to find it.' } },
      required: ['route'],
      additionalProperties: false
    },
    handler: async (args) => {
      const slug = String(args.route ?? '')
      let route: RouteWithMeta
      try {
        route = await fetchApi<RouteWithMeta>(`/api/routes/${encodeURIComponent(slug)}`, {})
      } catch (error) {
        if (statusOf(error) === 404) return failure(`No route with slug "${slug}". ${await suggestRoutes(slug)}`)
        throw error
      }

      const lines = [
        `# ${route.name} (${route.worldName})`,
        '',
        `- Slug: \`${route.slug}\``,
        `- Lap: ${route.distance} km, ${route.elevation} m`,
        route.leadInDistance ? `- Lead-in (ridden once): ${route.leadInDistance} km, ${route.leadInElevation ?? 0} m` : undefined,
        `- Lappable: ${route.lap ? `yes, up to ${MAX_LAPS} laps` : 'no - point to point, ridden once'}`,
        `- Terrain: ${route.terrain.category} (${Math.round(route.terrain.climbRatio)} m/km)`,
        `- Surface: ${formatSurface(route.surface)}`,
        `- Event only: ${route.eventOnly ? 'yes' : 'no'}`,
        // Which of the three geometry sources the physics model will get - the
        // same distinction `recommend_for_route` reports back in its header.
        `- Elevation data: ${route.terrain.elevationProfile ? 'real measured GPS profile' : route.terrain.climbs.length > 0 ? 'named climbs plus synthesized remainder' : 'synthesized from aggregate distance/elevation'}`
      ].filter(Boolean)

      if (route.terrain.climbs.length > 0) {
        lines.push('', '## Named climbs', '', '| Climb | Length | Elevation | Avg grade | Category |', '| --- | --- | --- | --- | --- |')
        for (const climb of route.terrain.climbs) {
          lines.push(`| ${climb.name} | ${climb.lengthKm.toFixed(1)} km | ${Math.round(climb.elevationM)} m | ${climb.avgGradePercent.toFixed(1)}% | ${climb.climbType ?? '-'} |`)
        }
      }

      return text(lines.join('\n'))
    }
  },

  {
    name: 'list_segments',
    title: 'List Zwift segments',
    description: 'Search the named climbs and sprints that can be ranked individually (e.g. Alpe du Zwift, Box Hill, the Fuego Flats sprint). '
      + 'Call this to find the slug recommend_for_segment needs when the user asks about one climb or sprint rather than a whole route.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Match against the segment name.' },
        world: { type: 'string', description: 'Restrict to one world slug, e.g. "watopia".' },
        limit: { type: 'number', description: 'How many segments to return. Defaults to 40.' }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      const limit = Number.isFinite(Number(args.limit)) ? Math.min(100, Math.max(1, Number(args.limit))) : 40
      const { segments } = await fetchApi<{ segments: SegmentSummary[] }>('/api/segments', { search: args.search, world: args.world })

      if (segments.length === 0) return text('No segments matched those filters.')

      const rows = segments.slice(0, limit).map(segment =>
        `| \`${segment.slug}\` | ${segment.name} | ${segment.type} | ${segment.worldName} | ${segment.lengthKm.toFixed(1)} km | ${Math.round(segment.elevationM)} m | ${segment.avgGradePercent.toFixed(1)}% |`)

      const truncated = segments.length > limit ? `\n\n${segments.length - limit} more matched; narrow the search or raise \`limit\`.` : ''
      return text([
        `${segments.length} segment(s) matched.`,
        '',
        '| Slug | Name | Type | World | Length | Elevation | Avg grade |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows
      ].join('\n') + truncated)
    }
  },

  {
    name: 'list_bikes',
    title: 'List bike frames',
    description: 'Search the Zwift bike frame catalog, with each frame\'s category and its aero/climb/gravel/cobble scores. '
      + 'Call this to check whether a bike the user names exists in Zwift and how it is classified. For "which bike is fastest", use recommend_for_route instead - these scores are a coarse proxy, not a predicted time.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Match against the frame name.' },
        category: { type: 'string', enum: ['standard', 'tt', 'gravel', 'handbike', 'funbike'], description: 'Restrict to one Zwift garage category.' },
        limit: { type: 'number', description: 'How many frames to return. Defaults to 40.' }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      const limit = Number.isFinite(Number(args.limit)) ? Math.min(100, Math.max(1, Number(args.limit))) : 40
      const { frames } = await fetchApi<{ frames: ClassifiedBikeFrame[] }>('/api/bikes', { search: args.search, category: args.category })

      if (frames.length === 0) return text('No frames matched those filters.')

      const rows = frames.slice(0, limit).map(frame =>
        `| ${frame.name} | ${frame.category}${frame.style ? ` / ${frame.style}` : ''} | ${frame.scores.aero} | ${frame.scores.climb} | ${frame.confidence} |`)

      const truncated = frames.length > limit ? `\n\n${frames.length - limit} more matched; narrow the search or raise \`limit\`.` : ''
      return text([
        `${frames.length} frame(s) matched. Scores are 0-100 and relative within the catalog, not times.`,
        '',
        '| Frame | Category | Aero | Climb | Data |',
        '| --- | --- | --- | --- | --- |',
        ...rows,
        '',
        CONFIDENCE_NOTE
      ].join('\n') + truncated)
    }
  },

  {
    name: 'list_wheelsets',
    title: 'List wheelsets',
    description: 'Search the Zwift wheelset catalog, with each wheelset\'s rolling-resistance class. '
      + 'Note Zwift decides gravel and cobble rolling resistance purely from this class, never from the frame, and gravel frames can only take gravel/mountain wheels.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Match against the wheelset name.' },
        limit: { type: 'number', description: 'How many wheelsets to return. Defaults to 40.' }
      },
      additionalProperties: false
    },
    handler: async (args) => {
      const limit = Number.isFinite(Number(args.limit)) ? Math.min(100, Math.max(1, Number(args.limit))) : 40
      const { wheelsets } = await fetchApi<{ wheelsets: Wheelset[] }>('/api/wheelsets', { search: args.search })

      if (wheelsets.length === 0) return text('No wheelsets matched that search.')

      const rows = wheelsets.slice(0, limit).map(wheelset =>
        `| ${wheelset.name} | ${wheelset.crrClass} | ${wheelset.scores.aero} | ${wheelset.scores.climb} | ${wheelset.confidence} |`)

      const truncated = wheelsets.length > limit ? `\n\n${wheelsets.length - limit} more matched; narrow the search or raise \`limit\`.` : ''
      return text([
        `${wheelsets.length} wheelset(s) matched. Scores are 0-100 and relative within the catalog, not times.`,
        '',
        '| Wheelset | Crr class | Aero | Climb | Data |',
        '| --- | --- | --- | --- | --- |',
        ...rows,
        '',
        CONFIDENCE_NOTE
      ].join('\n') + truncated)
    }
  },

  {
    name: 'recommend_for_route',
    title: 'Recommend bikes for a route',
    description: 'Rank Zwift bike frame + wheelset combinations by predicted finish time on a whole route, for a specific rider. '
      + 'This is the main tool - call it whenever the user asks which bike is fastest, or how much time a bike would save, on a named route. '
      + 'Needs a rider profile: either call set_rider_profile first, or pass weightKg, heightCm and wkg here.',
    inputSchema: {
      type: 'object',
      properties: {
        route: { type: 'string', description: 'Route slug, e.g. "watopia-big-foot-hills". Use list_routes to find it.' },
        laps: { type: 'number', description: `How many laps to ride, 1-${MAX_LAPS}. Defaults to 1, and is forced to 1 on point-to-point routes.` },
        ...RECOMMEND_FILTER_PROPERTIES
      },
      required: ['route'],
      additionalProperties: false
    },
    handler: async (args, context) => {
      const slug = String(args.route ?? '')
      const resolved = resolveProfile(args, context)
      if ('error' in resolved) return failure(resolved.error)

      // Fetched first so an unknown slug fails with a suggestion before any
      // ranking work, and so the header can report the lap count and totals
      // the endpoint will actually use - `RouteSummary` in its response
      // carries no `lap` flag, and a point-to-point route is forced to 1 lap.
      let route: RouteWithMeta
      try {
        route = await fetchApi<RouteWithMeta>(`/api/routes/${encodeURIComponent(slug)}`, {})
      } catch (error) {
        if (statusOf(error) === 404) return failure(`No route with slug "${slug}". ${await suggestRoutes(slug)}`)
        throw error
      }

      const laps = clampLaps(route, Number(args.laps))
      const totals = computeRouteTotals(route, laps)
      const response = await fetchApi<RecommendRouteResponse>(`/api/recommend/${encodeURIComponent(slug)}`, {
        ...recommendQuery(args, resolved.profile),
        laps
      })

      const { combos, physics, pagination } = response
      const verifiedOnly = isVerifiedOnly(args)
      if (combos.length === 0 && verifiedOnly) return failure(emptyVerifiedMessage())

      const lapNote = laps === 1 && !route.lap ? '1 lap (point-to-point route)' : `${laps} lap(s)`

      const header = [
        `# Fastest bikes on ${route.name} (${route.worldName})`,
        '',
        `- ${lapNote}: ${totals.distanceKm.toFixed(1)} km, ${Math.round(totals.elevationM)} m total (lead-in included)`,
        `- Surface: ${formatSurface(route.surface)}`,
        verifiedOnly ? '- Verified equipment only' : '- Including heuristic estimates',
        physics ? `- Rider: ${physics.rider.weightKg} kg, ${physics.rider.heightCm} cm, ${physics.rider.wkg} W/kg (${Math.round(physics.rider.weightKg * physics.rider.wkg)} W)` : undefined,
        physics ? `- Physics: ${physics.mode}, geometry ${physics.geometry}` : undefined,
        formatTttAssumption(physics),
        formatRaceAssumption(physics),
        `- All bikes assumed at upgrade stage ${upgradeLevelFor(args)}${upgradeLevelFor(args) === 5 ? ' (fully upgraded)' : upgradeLevelFor(args) === 0 ? ' (stock)' : ''}`,
        '- One row per frame, paired with its fastest wheelset for this route'
      ].filter(Boolean)

      return text([
        ...header,
        '',
        formatComboTable(combos, pagination.offset + 1),
        '',
        formatPagination(pagination),
        CONFIDENCE_NOTE,
        verifiedOnly ? VERIFIED_FILTER_NOTE : '',
        physics ? `\n${physics.note}` : ''
      ].join('\n'))
    }
  },

  {
    name: 'recommend_for_segment',
    title: 'Recommend bikes for a segment',
    description: 'Rank Zwift bike frame + wheelset combinations by predicted time on a single named climb or sprint, for a specific rider. '
      + 'Use this instead of recommend_for_route when the user asks about one segment (e.g. "fastest bike up Alpe du Zwift"). '
      + 'The segment is simulated after a flat run-up so it starts at realistic speed rather than from a standstill. '
      + 'Needs a rider profile: either call set_rider_profile first, or pass weightKg, heightCm and wkg here.',
    inputSchema: {
      type: 'object',
      properties: {
        segment: { type: 'string', description: 'Segment slug, e.g. "alpe-du-zwift". Use list_segments to find it.' },
        route: { type: 'string', description: 'Optional route slug hosting this segment, when the user cares about a particular route\'s surface data. Defaults to the first route that hosts it.' },
        ...RECOMMEND_FILTER_PROPERTIES
      },
      required: ['segment'],
      additionalProperties: false
    },
    handler: async (args, context) => {
      const slug = String(args.segment ?? '')
      const resolved = resolveProfile(args, context)
      if ('error' in resolved) return failure(resolved.error)

      let response: RecommendSegmentResponse
      try {
        response = await fetchApi<RecommendSegmentResponse>(`/api/recommend/segments/${encodeURIComponent(slug)}`, {
          ...recommendQuery(args, resolved.profile),
          route: typeof args.route === 'string' && args.route ? args.route : undefined
        })
      } catch (error) {
        if (statusOf(error) === 404) return failure(`No segment with slug "${slug}". ${await suggestSegments(slug)}`)
        throw error
      }

      const { segment, combos, physics, pagination } = response
      const verifiedOnly = isVerifiedOnly(args)
      if (combos.length === 0 && verifiedOnly) return failure(emptyVerifiedMessage())

      const header = [
        `# Fastest bikes on ${segment.name} (${segment.worldName})`,
        '',
        `- ${segment.type}: ${segment.lengthKm.toFixed(1)} km, ${Math.round(segment.elevationM)} m, ${segment.avgGradePercent.toFixed(1)}% avg${segment.climbType ? `, category ${segment.climbType}` : ''}`,
        verifiedOnly ? '- Verified equipment only' : '- Including heuristic estimates',
        physics ? `- Rider: ${physics.rider.weightKg} kg, ${physics.rider.heightCm} cm, ${physics.rider.wkg} W/kg (${Math.round(physics.rider.weightKg * physics.rider.wkg)} W)` : undefined,
        formatTttAssumption(physics),
        formatRaceAssumption(physics),
        `- All bikes assumed at upgrade stage ${upgradeLevelFor(args)}${upgradeLevelFor(args) === 5 ? ' (fully upgraded)' : upgradeLevelFor(args) === 0 ? ' (stock)' : ''}`,
        '- One row per frame, paired with its fastest wheelset for this route'
      ].filter(Boolean)

      return text([
        ...header,
        '',
        formatComboTable(combos, pagination.offset + 1),
        '',
        formatPagination(pagination),
        CONFIDENCE_NOTE,
        verifiedOnly ? VERIFIED_FILTER_NOTE : '',
        physics ? `\n${physics.note}` : ''
      ].join('\n'))
    }
  }
]

export function listTools(): Omit<ToolDefinition, 'handler'>[] {
  return TOOLS.map(({ handler, ...definition }) => definition)
}

export async function callTool(name: string, args: Record<string, unknown>, context: RpcContext): Promise<ToolResult> {
  const tool = TOOLS.find(candidate => candidate.name === name)
  if (!tool) return failure(`Unknown tool "${name}". Call \`tools/list\` for the available tools.`)
  return await tool.handler(args, context)
}
