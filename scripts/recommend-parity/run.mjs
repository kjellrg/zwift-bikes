// Runs the REAL route and segment recommend handlers out of one checkout over
// a fixed matrix of rides and query variants, and writes one sorted-key JSON
// file per case. Run it against two checkouts and diff the two directories
// (`compare.mjs` does exactly that): any behavioural change shows up as a
// diff - the ranking, every finish time, the error status, and the `sims` /
// `combos` counts pulled out of the request's timing meta, so a change that
// keeps the numbers but does the work differently shows up too.
//
// Usage: node scripts/recommend-parity/run.mjs <outDir> [repoRoot]
//
// `repoRoot` defaults to this checkout. Pass another one (a `git worktree` of
// the baseline commit, with `node_modules` symlinked in) to capture the
// "before" side - this script itself always runs from the current tree, only
// the code under test comes from `repoRoot`.
//
// Modules load through jiti (Nuxt's own TypeScript loader, present in
// node_modules as one of its dependencies) rather than the esbuild bundling
// `scripts/route-surfaces/loadShared.mjs` uses. The difference matters here:
// jiti loads each module ONCE, so the handlers and `server/utils/timing.ts`
// share the same module instance and the same `WeakMap` of request timings -
// which is what lets this script read the `sims` count a handler wrote.
// Bundling each entry point separately would give every import its own copy.
//
// Nitro's auto-imported globals are stubbed just enough for a handler to run
// without a server: `getRouterParam` returns the slug of the case being run,
// `useRuntimeConfig` returns no build SHA (so the edge-cache wrapper falls
// through to the handler), and there is no `caches.default`, so `markPhase`
// degrades to a macrotask hop. Nothing in the ranking path is stubbed.
import { createJiti } from 'jiti'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = process.argv[2]
const repoRoot = path.resolve(process.argv[3] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'))
if (!outDir) {
  console.error('usage: node scripts/recommend-parity/run.mjs <outDir> [repoRoot]')
  process.exit(1)
}
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// ---------------------------------------------------------------- nitro stubs
let currentSlug = ''
globalThis.defineEventHandler = handler => handler
globalThis.getRouterParam = () => currentSlug
globalThis.createError = init => Object.assign(new Error(init.message || init.statusMessage), init)
globalThis.useRuntimeConfig = () => ({ public: {} })
globalThis.setResponseHeader = () => {}

const jiti = createJiti(import.meta.url)
const load = specifier => jiti.import(path.join(repoRoot, specifier))

const routeHandler = (await load('server/api/recommend/[slug].get.ts')).default
const segmentHandler = (await load('server/api/recommend/segments/[slug].get.ts')).default
const routeInfoHandler = (await load('server/api/routes/[slug].get.ts')).default
const timing = await load('server/utils/timing.ts')
const catalog = await load('shared/utils/catalog.ts')
const routeSegments = await load('shared/utils/routeSegments.ts')
const mcpTools = await load('server/utils/mcp/tools.ts')

// h3's `getQuery` reads `event.path`, and `markPhase`/`addTimingMeta` key off
// the event object's identity - a plain object is all either needs.
const fakeEvent = eventPath => ({ path: eventPath, context: {} })

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key])
    return out
  }
  return value
}

function write(name, payload) {
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(sortValue(payload), null, 2) + '\n')
}

/** Runs one handler call and records the response (or the error) plus the timing meta. */
async function runCase(name, kind, slug, queryString) {
  currentSlug = slug
  const base = kind === 'route' ? '/api/recommend/' : '/api/recommend/segments/'
  const event = fakeEvent(`${base}${slug}${queryString ? `?${queryString}` : ''}`)
  timing.startRequestTiming(event)
  const handler = kind === 'route' ? routeHandler : segmentHandler
  let record
  try {
    const response = await handler(event)
    record = { ok: true, response }
  } catch (error) {
    record = {
      ok: false,
      error: {
        statusCode: error.statusCode ?? null,
        statusMessage: error.statusMessage ?? null,
        message: error.message ?? null
      }
    }
  }
  // Durations are wall-clock noise; the counts are the behavioural part.
  record.timingMeta = timing.getRequestTiming(event)?.meta ?? null
  record.case = { name, kind, slug, query: queryString }
  write(name, record)
  return record
}

// ------------------------------------------------------------------- the rides
// One route per archetype, resolved from the live catalog so a renamed slug
// is reported rather than silently skipped; then the three geometry branches
// the route endpoint's `physics.geometry` field distinguishes.
const routes = catalog.getRoutesWithMeta()
const bySlug = slug => routes.find(route => route.slug === slug)
const cyclingRoutes = routes
  .filter(route => route.sports.includes('cycling'))
  .slice()
  .sort((a, b) => a.slug.localeCompare(b.slug))

const preferredRoutes = ['tempus-fugit', 'road-to-sky', 'cobbled-climbs', 'jungle-circuit', 'big-foot-hills']
const rides = []
for (const slug of preferredRoutes) {
  const route = bySlug(slug)
  if (route) rides.push({ kind: 'route', slug, powerW: 225, note: 'archetype' })
  else console.warn(`route "${slug}" not in the catalog - skipped`)
}
// A point-to-point route: `clampLaps` forces it to 1 lap whatever is asked.
const pointToPoint = cyclingRoutes.find(route => !route.lap && !preferredRoutes.includes(route.slug) && route.terrain.elevationProfile)
if (pointToPoint) rides.push({ kind: 'route', slug: pointToPoint.slug, powerW: 225, note: 'point-to-point' })
// No measured profile and no named climbs: the `aggregate-compatibility` branch.
const aggregateRoute = cyclingRoutes.find(route => !route.terrain.elevationProfile && route.terrain.climbs.length === 0)
if (aggregateRoute) rides.push({ kind: 'route', slug: aggregateRoute.slug, powerW: 225, note: 'aggregate-compatibility' })
// Named climbs but no measured profile: the `known-climbs-compatibility` branch.
const knownClimbsRoute = cyclingRoutes.find(route => !route.terrain.elevationProfile && route.terrain.climbs.length > 0)
if (knownClimbsRoute) rides.push({ kind: 'route', slug: knownClimbsRoute.slug, powerW: 225, note: 'known-climbs-compatibility' })

const segments = routeSegments.getAllSegmentSummaries().slice().sort((a, b) => a.slug.localeCompare(b.slug))
const segmentSurface = summary => routeSegments.routeWithMetaForSegment(summary).surface
// The sprint runs at the site's default sprint power, like the segment page.
const sprint = segments.find(s => s.type === 'sprint' && s.measuredElevationM !== undefined)
  ?? segments.find(s => s.type === 'sprint')
if (sprint) rides.push({ kind: 'segment', slug: sprint.slug, powerW: 600, note: 'sprint (sprint power)' })
if (segments.some(s => s.slug === 'alpe-du-zwift')) rides.push({ kind: 'segment', slug: 'alpe-du-zwift', powerW: 225, note: 'long measured climb' })
const flatLineClimb = segments.find(s => s.type === 'climb' && s.measuredElevationM === undefined)
if (flatLineClimb) rides.push({ kind: 'segment', slug: flatLineClimb.slug, powerW: 225, note: 'climb with no measured profile (2-point line)' })
const offRoadSegment = segments.find((s) => {
  if (s.slug === 'alpe-du-zwift' || s.slug === sprint?.slug || s.slug === flatLineClimb?.slug) return false
  const surface = segmentSurface(s)
  return surface.gravel > 10 || surface.cobble > 10
})
if (offRoadSegment) rides.push({ kind: 'segment', slug: offRoadSegment.slug, powerW: 225, note: 'off-road segment' })

console.log(`tree: ${repoRoot}`)
console.log('rides:')
for (const ride of rides) console.log(`  ${ride.kind.padEnd(7)} ${ride.slug.padEnd(32)} ${ride.powerW} W  (${ride.note})`)

// --------------------------------------------------------------- the variants
// The site's default rider (see `useRiderProfile`) and the query the route and
// segment pages send by default.
const PROFILE = powerW => `weightKg=75&heightCm=175&powerW=${powerW}`
const SITE_DEFAULTS = 'category=standard&includeHalo=false&verifiedOnly=true&maxWheelsetsPerFrame=1'

function variantsFor(ride) {
  const profile = PROFILE(ride.powerW)
  const list = [
    ['no-profile', ''],
    ['site-default-offset0', `${profile}&${SITE_DEFAULTS}&offset=0`],
    ['site-default-offset9', `${profile}&${SITE_DEFAULTS}&offset=9`],
    ['legacy', `${profile}&physics=legacy`],
    ['compare', `${profile}&physics=compare`],
    ['ttt-dynamic', `${profile}&draftMode=ttt&tttRiders=6&tttClimbWkg=3.5`],
    ['ttt-legacy', `${profile}&draftMode=ttt&tttRiders=6&tttClimbWkg=3.5&physics=legacy`],
    ['race', `${profile}&draftMode=race`],
    ['search-zipp', `${profile}&search=zipp`],
    ['no-category-halo', `${profile}&includeHalo=true`],
    ['category-tt', `${profile}&category=tt&includeHalo=false`],
    ['unverified', `${profile}&verifiedOnly=false`],
    ['level0', `${profile}&defaultUnownedLevel=0`],
    ['level5', `${profile}&defaultUnownedLevel=5`],
    ['err-limit-50', `${profile}&limit=50`],
    ['power-150w', 'weightKg=75&heightCm=175&powerW=150']
  ]
  if (ride.kind === 'route') {
    list.push(['exclude-tt', `${profile}&excludeTT=true`])
    list.push(['laps-2', `${profile}&laps=2`])
  }
  return list
}

// ------------------------------------------------------------------- run them
let cases = 0
let minSims = Infinity
let maxSims = 0
function noteSims(record) {
  const sims = record.timingMeta?.sims
  if (typeof sims === 'number') {
    minSims = Math.min(minSims, sims)
    maxSims = Math.max(maxSims, sims)
  }
}

for (const ride of rides) {
  const prefix = `${ride.kind}--${ride.slug}`
  for (const [name, query] of variantsFor(ride)) {
    noteSims(await runCase(`${prefix}--${name}`, ride.kind, ride.slug, query))
    cases++
  }

  // The drill-down and ownership variants need real ids, taken from the
  // site-default page above - the same way the UI builds them from a card.
  const seed = await runCase(`${prefix}--seed`, ride.kind, ride.slug, `${PROFILE(ride.powerW)}&${SITE_DEFAULTS}&offset=0`)
  cases++
  const combos = seed.ok ? seed.response.combos : []
  if (combos.length) {
    const frameId = combos[0].frame.id
    const owned = JSON.stringify({ [String(frameId)]: 3, [String(combos[Math.min(1, combos.length - 1)].frame.id)]: 5 })
    const ownedWheels = JSON.stringify([...new Set(combos.map(c => c.wheelset?.key).filter(Boolean))].slice(0, 3))
    const extras = [
      ['drill-down', `${PROFILE(ride.powerW)}&${SITE_DEFAULTS}&wheelsForFrame=${frameId}&limit=6`],
      ['drill-down-legacy', `${PROFILE(ride.powerW)}&${SITE_DEFAULTS}&wheelsForFrame=${frameId}&limit=6&physics=legacy`],
      ['owned-only', `${PROFILE(ride.powerW)}&ownedOnly=true&owned=${encodeURIComponent(owned)}&ownedWheels=${encodeURIComponent(ownedWheels)}`]
    ]
    for (const [name, query] of extras) {
      noteSims(await runCase(`${prefix}--${name}`, ride.kind, ride.slug, query))
      cases++
    }
  }
}

// Unknown slugs: the 404 branch on both endpoints.
await runCase('route--unknown-slug', 'route', 'no-such-route-at-all', PROFILE(225))
await runCase('segment--unknown-slug', 'segment', 'no-such-segment-at-all', PROFILE(225))
cases += 2

// A rider who cannot hold the grade: `RouteSimulationStallError` -> 422.
const STALLING_RIDER = 'weightKg=200&heightCm=220&powerW=9'
await runCase('route--stall-422', 'route', 'road-to-sky', STALLING_RIDER)
await runCase('segment--stall-422', 'segment', 'alpe-du-zwift', STALLING_RIDER)
cases += 2

// ------------------------------------------------------------- the MCP tools
// The MCP adapter reaches both endpoints over Nitro's in-process `$fetch`, so
// dispatching that stub at the same handlers exercises the tools' formatting
// against this tree's pipeline.
globalThis.$fetch = async (fetchPath, options = {}) => {
  const query = options.query ?? {}
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(key, String(value))
  }
  const qs = search.toString()
  const event = fakeEvent(`${fetchPath}${qs ? `?${qs}` : ''}`)
  if (fetchPath.startsWith('/api/recommend/segments/')) {
    currentSlug = decodeURIComponent(fetchPath.slice('/api/recommend/segments/'.length))
    return segmentHandler(event)
  }
  if (fetchPath.startsWith('/api/recommend/')) {
    currentSlug = decodeURIComponent(fetchPath.slice('/api/recommend/'.length))
    return routeHandler(event)
  }
  if (fetchPath.startsWith('/api/routes/')) {
    currentSlug = decodeURIComponent(fetchPath.slice('/api/routes/'.length))
    return routeInfoHandler(event)
  }
  throw new Error(`unstubbed $fetch: ${fetchPath}`)
}

const firstRoute = rides.find(r => r.kind === 'route')?.slug
const firstSegment = rides.find(r => r.kind === 'segment')?.slug
const mcpCases = [
  ['mcp--recommend_for_route', 'recommend_for_route', { route: firstRoute, weightKg: 75, heightCm: 175, wkg: 3 }],
  ['mcp--recommend_for_route-ttt', 'recommend_for_route', { route: firstRoute, weightKg: 75, heightCm: 175, wkg: 3, draftMode: 'ttt', tttRiders: 6, tttClimbWkg: 3.5 }],
  ['mcp--recommend_for_segment', 'recommend_for_segment', { segment: firstSegment, weightKg: 75, heightCm: 175, wkg: 8 }],
  ['mcp--recommend_for_segment-race', 'recommend_for_segment', { segment: firstSegment, weightKg: 75, heightCm: 175, wkg: 8, draftMode: 'race' }]
]
for (const [name, tool, args] of mcpCases) {
  const result = await mcpTools.callTool(tool, args, {})
  write(name, { tool, args, result })
  cases++
}

console.log(`cases: ${cases}`)
console.log(`sims range: ${minSims === Infinity ? 'n/a' : minSims} .. ${maxSims}`)
