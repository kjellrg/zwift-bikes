// Validates the API query schemas in server/utils/apiQuerySchemas.ts against
// a table of representative inputs: the clamps and defaults the handlers have
// always applied must survive the zod migration exactly, and the newly-strict
// cases (unknown enum members, non-numeric numbers, malformed garage JSON)
// must reject rather than silently coerce. Runs as part of `npm run validate`,
// so CI and the pre-commit build both gate on it.
import { loadSharedModule } from './route-surfaces/loadShared.mjs'

const schemas = loadSharedModule('server/utils/apiQuerySchemas.ts')
const {
  bikesQuerySchema,
  routesQuerySchema,
  segmentsQuerySchema,
  wheelsetsQuerySchema,
  recommendRouteQuerySchema,
  recommendSegmentQuerySchema,
  BIKE_CATEGORIES,
  WORLD_SLUGS
} = schemas

let failures = 0

function fail(label, detail) {
  failures++
  console.error(`FAIL ${label}: ${detail}`)
}

/** Asserts `input` parses and every key in `expect` comes out with that value. */
function ok(schema, label, input, expect = {}) {
  const result = schema.safeParse(input)
  if (!result.success) {
    fail(label, `expected success, got: ${result.error.issues.map(issue => issue.message).join('; ')}`)
    return
  }
  for (const [key, expected] of Object.entries(expect)) {
    const actual = result.data[key]
    const matches = expected instanceof Set
      ? actual instanceof Set && actual.size === expected.size && [...expected].every(item => actual.has(item))
      : JSON.stringify(actual) === JSON.stringify(expected)
    if (!matches) fail(label, `expected ${key}=${JSON.stringify(expected instanceof Set ? [...expected] : expected)}, got ${JSON.stringify(actual instanceof Set ? [...actual] : actual)}`)
  }
}

/** Asserts `input` rejects, optionally with a message mentioning `mentions`. */
function bad(schema, label, input, mentions) {
  const result = schema.safeParse(input)
  if (result.success) {
    fail(label, 'expected rejection, but it parsed')
    return
  }
  if (mentions) {
    const text = result.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('; ')
    if (!text.toLowerCase().includes(mentions.toLowerCase())) fail(label, `expected message mentioning "${mentions}", got: ${text}`)
  }
}

// --- enum sources ---
if (!BIKE_CATEGORIES.includes('standard') || BIKE_CATEGORIES.length !== 5) fail('BIKE_CATEGORIES', `unexpected contents: ${BIKE_CATEGORIES}`)
if (!WORLD_SLUGS.includes('watopia')) fail('WORLD_SLUGS', 'missing watopia - zwift-data worlds not loaded')

// --- catalog endpoints ---
ok(routesQuerySchema, 'routes: empty query', {}, { search: undefined, world: undefined, eventOnly: undefined })
ok(routesQuerySchema, 'routes: full valid query',
  { world: 'watopia', sport: 'cycling', minDistance: '10', maxDistance: '40.5', surface: 'gravel', eventOnly: 'false' },
  { world: 'watopia', sport: 'cycling', minDistance: 10, maxDistance: 40.5, surface: 'gravel', eventOnly: false })
ok(routesQuerySchema, 'routes: empty string means no filter', { world: '', minDistance: '' }, { world: undefined, minDistance: undefined })
ok(routesQuerySchema, 'routes: unknown params ignored', { utm_source: 'newsletter', fbclid: 'x' }, {})
ok(routesQuerySchema, 'routes: search normalized', { search: '  Alpe ' }, { search: 'alpe' })
bad(routesQuerySchema, 'routes: unknown world', { world: 'narnia' }, 'world')
bad(routesQuerySchema, 'routes: unknown sport', { sport: 'swimming' }, 'sport')
bad(routesQuerySchema, 'routes: unknown surface', { surface: 'tarmac' }, 'surface')
bad(routesQuerySchema, 'routes: non-numeric minDistance', { minDistance: 'abc' }, 'minDistance')
bad(routesQuerySchema, 'routes: Infinity rejected', { maxElevation: 'Infinity' }, 'maxElevation')
bad(routesQuerySchema, 'routes: repeated param rejected', { minDistance: ['1', '2'] }, 'minDistance')
bad(routesQuerySchema, 'routes: non-boolean eventOnly', { eventOnly: 'maybe' }, 'eventOnly')

ok(bikesQuerySchema, 'bikes: valid category', { category: 'tt' }, { category: 'tt' })
bad(bikesQuerySchema, 'bikes: unknown category', { category: 'road' }, 'category')

ok(segmentsQuerySchema, 'segments: valid world', { world: 'france' }, { world: 'france' })
bad(segmentsQuerySchema, 'segments: unknown world', { world: 'narnia' }, 'world')

ok(wheelsetsQuerySchema, 'wheelsets: search only', { search: 'Zipp' }, { search: 'zipp' })

// --- recommend endpoints: defaults must match the handlers' historic ones ---
ok(recommendRouteQuerySchema, 'recommend: defaults', {}, {
  limit: 9,
  offset: 0,
  verifiedOnly: true,
  includeHalo: true,
  ownedOnly: false,
  excludeTT: false,
  physics: 'dynamic',
  draftMode: 'solo',
  tttRiders: 8,
  defaultUnownedLevel: 5,
  maxWheelsetsPerFrame: undefined,
  owned: {},
  ownedWheels: new Set(),
  weightKg: undefined
})

// --- documented ranges: in-range accepted, out-of-range is a 400 ---
ok(recommendRouteQuerySchema, 'recommend: limit in range', { limit: '5' }, { limit: 5 })
bad(recommendRouteQuerySchema, 'recommend: limit above range', { limit: '99' }, 'limit')
bad(recommendRouteQuerySchema, 'recommend: limit below range', { limit: '0' }, 'limit')
ok(recommendRouteQuerySchema, 'recommend: offset in range', { offset: '40' }, { offset: 40 })
bad(recommendRouteQuerySchema, 'recommend: negative offset', { offset: '-5' }, 'offset')
bad(recommendRouteQuerySchema, 'recommend: offset above range', { offset: '999999' }, 'offset')
ok(recommendRouteQuerySchema, 'recommend: laps in range', { laps: '15' }, { laps: 15 })
bad(recommendRouteQuerySchema, 'recommend: laps above range', { laps: '999' }, 'laps')
bad(recommendRouteQuerySchema, 'recommend: laps below range', { laps: '0' }, 'laps')
ok(recommendRouteQuerySchema, 'recommend: defaultUnownedLevel in range', { defaultUnownedLevel: '3' }, { defaultUnownedLevel: 3 })
bad(recommendRouteQuerySchema, 'recommend: defaultUnownedLevel above range', { defaultUnownedLevel: '9' }, 'defaultUnownedLevel')
ok(recommendRouteQuerySchema, 'recommend: tttRiders in range', { tttRiders: '6' }, { tttRiders: 6 })
bad(recommendRouteQuerySchema, 'recommend: tttRiders above range', { tttRiders: '20' }, 'tttRiders')
ok(recommendRouteQuerySchema, 'recommend: tttClimbWkg snaps to 0.1', { tttClimbWkg: '4.300000000000001' }, { tttClimbWkg: 4.3 })
bad(recommendRouteQuerySchema, 'recommend: tttClimbWkg below range', { tttClimbWkg: '1' }, 'tttClimbWkg')
bad(recommendRouteQuerySchema, 'recommend: maxWheelsetsPerFrame below range', { maxWheelsetsPerFrame: '0' }, 'maxWheelsetsPerFrame')
ok(recommendRouteQuerySchema, 'recommend: flags parse', { verifiedOnly: 'false', includeHalo: 'false', ownedOnly: 'true', excludeTT: 'true' },
  { verifiedOnly: false, includeHalo: false, ownedOnly: true, excludeTT: true })

// --- garage JSON: strict on shape, lenient inside it ---
ok(recommendRouteQuerySchema, 'recommend: owned parses', { owned: '{"6":3}' }, { owned: { 6: 3 } })
ok(recommendRouteQuerySchema, 'recommend: owned level clamps', { owned: '{"6":9}' }, { owned: { 6: 5 } })
ok(recommendRouteQuerySchema, 'recommend: ownedWheels parses', { ownedWheels: '["zipp-808","enve-78"]' }, { ownedWheels: new Set(['zipp-808', 'enve-78']) })
bad(recommendRouteQuerySchema, 'recommend: owned malformed JSON', { owned: 'notjson' }, 'owned')
bad(recommendRouteQuerySchema, 'recommend: owned is an array', { owned: '[1,2]' }, 'owned')
bad(recommendRouteQuerySchema, 'recommend: owned level not a number', { owned: '{"6":"three"}' }, 'owned')
bad(recommendRouteQuerySchema, 'recommend: ownedWheels not an array', { ownedWheels: '{"a":1}' }, 'ownedWheels')
bad(recommendRouteQuerySchema, 'recommend: ownedWheels non-string entry', { ownedWheels: '[1]' }, 'ownedWheels')

// --- rider profile: all-or-nothing, bounded ---
ok(recommendRouteQuerySchema, 'recommend: full profile', { weightKg: '75', heightCm: '183', powerW: '250' },
  { weightKg: 75, heightCm: 183, powerW: 250 })
ok(recommendRouteQuerySchema, 'recommend: legacy wkg alias converts to watts', { weightKg: '75', heightCm: '183', wkg: '3.2' },
  { weightKg: 75, heightCm: 183, powerW: 240 })
bad(recommendRouteQuerySchema, 'recommend: partial profile', { weightKg: '75' }, 'together')
bad(recommendRouteQuerySchema, 'recommend: non-numeric weight', { weightKg: 'abc', heightCm: '183', powerW: '250' }, 'weightKg')
bad(recommendRouteQuerySchema, 'recommend: absurd weight', { weightKg: '1e9', heightCm: '183', powerW: '250' }, 'weightKg')
bad(recommendRouteQuerySchema, 'recommend: height below bound', { weightKg: '75', heightCm: '95', powerW: '250' }, 'heightCm')
bad(recommendRouteQuerySchema, 'recommend: absurd powerW', { weightKg: '75', heightCm: '183', powerW: '99999' }, 'powerW')
bad(recommendRouteQuerySchema, 'recommend: absurd wkg', { weightKg: '75', heightCm: '183', wkg: '99' }, 'wkg')

// --- modes: strict where the old code silently defaulted ---
bad(recommendRouteQuerySchema, 'recommend: unknown physics mode', { physics: 'quantum' }, 'physics')
bad(recommendRouteQuerySchema, 'recommend: unknown draft mode', { draftMode: 'peloton' }, 'draftMode')
bad(recommendRouteQuerySchema, 'recommend: non-boolean verifiedOnly', { verifiedOnly: 'banana' }, 'verifiedOnly')
bad(recommendRouteQuerySchema, 'recommend: non-numeric limit', { limit: 'abc' }, 'limit')

// --- segment variant ---
// The removed `route` param (old crawled URLs still send it) must fall
// through the ignore-unknown-keys contract, never 400 or reach the handler.
ok(recommendSegmentQuerySchema, 'segment recommend: legacy route param is ignored', { route: 'not-a-real-route' }, { route: undefined })
bad(recommendSegmentQuerySchema, 'segment recommend: partial profile', { powerW: '250' }, 'together')

if (failures > 0) {
  console.error(`\napi-schemas: ${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('api-schemas: all assertions passed')
