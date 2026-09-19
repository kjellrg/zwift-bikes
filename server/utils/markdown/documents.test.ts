import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComboScore } from '../../../shared/types/catalog'
import { isWorkerFirstPath, markdownDocumentFor, MARKDOWN_WORKER_FIRST_RULES } from './documents'

/**
 * The documents reach the catalog and the ranking through Nitro's `$fetch`,
 * which does not exist in this plain-node suite (see vitest.config.ts), so
 * every test installs its own stub as a global - the same arrangement
 * `server/utils/mcp/tools.test.ts` uses.
 */
type FetchStub = (path: string, options?: { query?: Record<string, unknown> }) => unknown

function stubFetch(handler: FetchStub) {
  // Wrapped in an async function so the stub returns a real promise: the
  // documents lean on `$fetch(...).catch(...)` to degrade when a ranking
  // cannot be computed, and a bare value has no `.catch`.
  const spy = vi.fn(async (path: string, options?: { query?: Record<string, unknown> }) => handler(path, options))
  Reflect.set(globalThis, '$fetch', spy)
  return spy
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '$fetch')
  vi.restoreAllMocks()
})

const ROUTE = {
  id: 1,
  slug: 'watopia-hilly-route',
  name: 'Hilly Route',
  world: 'watopia',
  worldName: 'Watopia',
  distance: 9.1,
  elevation: 105,
  leadInDistance: 1.4,
  leadInElevation: 8,
  lap: true,
  eventOnly: false,
  sports: ['cycling'],
  supportsTT: true,
  terrain: { category: 'rolling', climbRatio: 11.5, climbs: [], elevationProfile: [[0, 10], [1, 20]] },
  surface: { road: 100, gravel: 0, cobble: 0, confidence: 'measured' }
}

const SEGMENT = {
  slug: 'alpe-du-zwift',
  name: 'Alpe du Zwift',
  type: 'climb',
  climbType: 'HC',
  world: 'watopia',
  worldName: 'Watopia',
  lengthKm: 12.2,
  elevationM: 1035,
  avgGradePercent: 8.5,
  placement: 'positional',
  hostRoutes: [{ slug: 'road-to-sky', name: 'Road to Sky' }],
  route: { surface: { road: 100, gravel: 0, cobble: 0, confidence: 'measured' } }
}

const COMBO = {
  frame: { id: 7, name: 'Tron', level: 5, category: 'standard', confidence: 'measured' },
  wheelset: { key: 'tron', name: 'Tron wheels', confidence: 'measured' },
  score: 100,
  finishTimeSec: 900
} as unknown as ComboScore

function rankingResponse(combos: ComboScore[] = [COMBO]) {
  return {
    route: ROUTE,
    segment: SEGMENT,
    combos,
    physics: { mode: 'dynamic', rider: { weightKg: 75, heightCm: 175, powerW: 225 }, note: 'Dynamic physics is active.' },
    pagination: { offset: 0, limit: 9, returned: combos.length, hasMore: false }
  }
}

/**
 * A preview Worker: links are built from the host that served the request,
 * the canonical from the public site URL. The two differ here on purpose -
 * with one value they would agree by accident.
 */
const CONTEXT = { origin: 'https://zwift-bikes-pr-1.workers.dev', siteUrl: 'https://zwiftbikes.com', recommendPaused: false }

describe('which paths have a markdown twin', () => {
  it('resolves every ranking page and the two discovery pages that lead to them', () => {
    for (const path of ['/', '/segments', '/routes/watopia-hilly-route', '/segments/alpe-du-zwift', '/events/zrl-2026-27/round-1-week-1']) {
      expect(markdownDocumentFor(path), path).toBeTypeOf('function')
    }
  })

  it('leaves every other page alone', () => {
    // `/about` is hand-written prose, `/profile` and `/garage` render only
    // from the rider's own browser, and a season page is a discovery page
    // whose races each carry their own document. All must fall through to
    // the HTML rather than 404 as markdown.
    for (const path of ['/about', '/profile', '/garage', '/report', '/events', '/events/zrl-2026-27', '/routes', '/api/routes']) {
      expect(markdownDocumentFor(path), path).toBeUndefined()
    }
  })

  it('does not answer the slashed form, which the asset layer redirects', () => {
    // `trailingSlash: 'never'` plus `html_handling: drop-trailing-slash`
    // means one canonical URL per page; answering both would make two.
    expect(markdownDocumentFor('/routes/watopia-hilly-route/')).toBeUndefined()
    expect(markdownDocumentFor('/segments/')).toBeUndefined()
    expect(markdownDocumentFor('/events/zrl-2026-27/round-1-week-1/')).toBeUndefined()
  })

  it('does not read a slug as a path', () => {
    expect(markdownDocumentFor('/routes/a/b')).toBeUndefined()
  })
})

describe('the route document', () => {
  it('leads with the question the page asks and answers it from rank 1', async () => {
    stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : ROUTE))
    const markdown = await markdownDocumentFor('/routes/watopia-hilly-route')!(CONTEXT)

    // The same question the page publishes as FAQ structured data, so a
    // model and a crawler come away with one answer.
    expect(markdown.startsWith('# What\'s the fastest bike for Hilly Route?')).toBe(true)
    expect(markdown).toContain('Our model puts the **Tron with Tron wheels** fastest on Hilly Route: **15:00**')
    expect(markdown).toContain('Canonical page: <https://zwiftbikes.com/routes/watopia-hilly-route>')
    // Links stay on the host that served it, the way the HTML's are relative.
    expect(markdown).toContain('https://zwift-bikes-pr-1.workers.dev/api/mcp')
  })

  it('ranks the rider the prerendered HTML was rendered for', async () => {
    const fetchSpy = stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : ROUTE))
    const markdown = await markdownDocumentFor('/routes/watopia-hilly-route')!(CONTEXT)

    // A different query here would be a ranking no rider is ever shown -
    // see `defaultRankingQuery` and `buildRecommendQuery` on the client.
    const query = fetchSpy.mock.calls.find(([path]) => path.startsWith('/api/recommend/'))?.[1]?.query
    expect(query).toMatchObject({
      category: 'standard',
      verifiedOnly: 'true',
      includeHalo: 'false',
      maxWheelsetsPerFrame: 1,
      weightKg: 75,
      heightCm: 175,
      powerW: 225,
      laps: 1
    })
    expect(markdown).toContain('75 kg, 175 cm, 225 W (3.00 W/kg)')
  })

  it('quotes the ride actually raced, lead-in included', async () => {
    stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : ROUTE))
    const markdown = await markdownDocumentFor('/routes/watopia-hilly-route')!(CONTEXT)
    // 9.1 km + a 1.4 km lead-in, 105 m + 8 m.
    expect(markdown).toContain('10.5 km and 113 m of climbing for one lap')
    expect(markdown).toContain('**Lead-in** (ridden once): 1.4 km, 8 m')
  })

  it('still serves the route when the ranking fails', async () => {
    stubFetch((path) => {
      if (path.startsWith('/api/recommend/')) throw new Error('simulator refused')
      return ROUTE
    })
    const markdown = await markdownDocumentFor('/routes/watopia-hilly-route')!(CONTEXT)
    expect(markdown).toContain('The ranking could not be computed')
    expect(markdown).toContain('## The route')
    expect(markdown).toContain('`watopia-hilly-route`')
  })

  it('does not rank at all while recommendations are paused', async () => {
    const fetchSpy = stubFetch(() => ROUTE)
    const markdown = await markdownDocumentFor('/routes/watopia-hilly-route')!({ ...CONTEXT, recommendPaused: true })

    // The kill switch is blind to this path's in-process fetches, so the
    // document must refuse before making one - not after.
    expect(fetchSpy.mock.calls.some(([path]) => path.startsWith('/api/recommend/'))).toBe(false)
    expect(markdown).toContain('temporarily paused for maintenance')
  })
})

describe('the segment document', () => {
  it('ranks a sprint at sprint power and a climb at race pace', async () => {
    const climbSpy = stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : SEGMENT))
    await markdownDocumentFor('/segments/alpe-du-zwift')!(CONTEXT)
    expect(climbSpy.mock.calls.find(([path]) => path.startsWith('/api/recommend/'))?.[1]?.query).toMatchObject({ powerW: 225 })

    const sprintSpy = stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : { ...SEGMENT, type: 'sprint', climbType: undefined }))
    const markdown = await markdownDocumentFor('/segments/alpe-du-zwift')!(CONTEXT)
    expect(sprintSpy.mock.calls.find(([path]) => path.startsWith('/api/recommend/'))?.[1]?.query).toMatchObject({ powerW: 600 })
    expect(markdown).toContain('Ridden at sprint power')
  })

  it('links the routes the segment is ridden on', async () => {
    stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : SEGMENT))
    const markdown = await markdownDocumentFor('/segments/alpe-du-zwift')!(CONTEXT)
    expect(markdown).toContain('- [Road to Sky](https://zwift-bikes-pr-1.workers.dev/routes/road-to-sky)')
  })
})

describe('the race document', () => {
  // Real curated data (shared/utils/events.ts), not a fixture: the whole
  // point of this document is the organiser's rules, and a fixture would
  // only ever prove that the fixture is shaped the way the test expects.
  const ROT = '/events/zrl-2026-27/round-1-week-1' // Race of Truth: no TT frames, no draft
  const POINTS = '/events/zrl-2026-27/round-1-week-3' // points race, two groups on different courses

  it('bars TT frames where the format does, and says so', async () => {
    const fetchSpy = stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : ROUTE))
    const markdown = await markdownDocumentFor(ROT)!(CONTEXT)

    // A legality filter, not a display trim - a ranking without it would put
    // a bike the rider cannot start on at the top.
    expect(fetchSpy.mock.calls.find(([path]) => path.startsWith('/api/recommend/'))?.[1]?.query)
      .toMatchObject({ excludeTT: 'true' })
    expect(markdown).toContain('**TT frames**: barred')
    expect(markdown).toContain('**Drafting**: no - ridden solo')
  })

  it('ranks the first category group and names the others', async () => {
    stubFetch(path => (path.startsWith('/api/recommend/') ? rankingResponse() : ROUTE))
    const markdown = await markdownDocumentFor(POINTS)!(CONTEXT)

    expect(markdown).toContain('What bike should I ride for')
    expect(markdown).toContain('A/B (ranked above)')
    expect(markdown).toContain('C/D')
    // A group on another course gets a different answer; saying so is the
    // difference between a useful document and a misleading one.
    expect(markdown).toContain('Another group racing a different course or lap count gets a different answer')
  })

  it('404s a race the organiser has not published', async () => {
    stubFetch(() => ROUTE)
    await expect(markdownDocumentFor('/events/zrl-2026-27/not-a-race')!(CONTEXT)).rejects.toThrow()
  })
})

describe('the index documents', () => {
  it('lists the whole catalog with the slugs the API takes', async () => {
    stubFetch(path => (path === '/api/routes'
      ? { routes: [{ ...ROUTE }] }
      : { segments: [SEGMENT] }))

    const home = await markdownDocumentFor('/')!(CONTEXT)
    expect(home).toContain('## Every route (1)')
    expect(home).toContain('[Hilly Route](https://zwift-bikes-pr-1.workers.dev/routes/watopia-hilly-route)')
    expect(home).toContain('`watopia-hilly-route`')

    const segments = await markdownDocumentFor('/segments')!(CONTEXT)
    expect(segments).toContain('## Every climb and sprint (1)')
    expect(segments).toContain('[Alpe du Zwift](https://zwift-bikes-pr-1.workers.dev/segments/alpe-du-zwift)')
  })
})

/**
 * The silent half of the feature. Cloudflare's asset layer answers a
 * prerendered page before the Worker runs, so a page this module can render
 * but `assets.run_worker_first` does not route to the Worker simply never
 * negotiates - no error, no log, just HTML forever. Nothing else in the
 * build compares the two lists, so this does.
 */
describe('the wrangler routing that lets any of this run', () => {
  const wranglerPath = fileURLToPath(new URL('../../../wrangler.jsonc', import.meta.url))

  /**
   * wrangler.jsonc is JSON with comments, and every comment in it is on a
   * line of its own - so dropping those lines is enough, and is far less
   * machinery than a JSONC parser for one field. A comment style this does
   * not handle shows up as a parse failure here, not as a wrong answer.
   */
  function readWranglerConfig(): { assets: { run_worker_first: string[] } } {
    const source = readFileSync(wranglerPath, 'utf8')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n')
    return JSON.parse(source)
  }

  it('routes exactly the paths this module claims', () => {
    expect(readWranglerConfig().assets.run_worker_first).toEqual([...MARKDOWN_WORKER_FIRST_RULES])
  })

  it('covers every path the resolver answers', () => {
    for (const path of ['/', '/segments', '/routes/watopia-hilly-route', '/segments/alpe-du-zwift', '/events/zrl-2026-27/round-1-week-1']) {
      expect(markdownDocumentFor(path), path).toBeDefined()
      expect(isWorkerFirstPath(path), `${path} is not routed to the Worker`).toBe(true)
    }
  })

  /**
   * The smoke script is the only place the deployed behaviour is ever
   * checked (nothing local can see the asset routing), so a rule it does not
   * exercise is a rule nobody verifies. It is plain ESM and cannot import
   * this module, so its list is read as text - the same trick the wrangler
   * check above uses, and for the same reason.
   */
  it('is exercised end to end by the smoke script, rule for rule', () => {
    const smoke = readFileSync(fileURLToPath(new URL('../../../scripts/site-smoke/smoke.mjs', import.meta.url)), 'utf8')
    const list = /const MARKDOWN_PAGES = \[([^\]]*)\]/.exec(smoke)?.[1]
    expect(list, 'MARKDOWN_PAGES not found in smoke.mjs').toBeDefined()
    const smoked = [...list!.matchAll(/'([^']+)'/g)].map(match => match[1]!)

    for (const rule of MARKDOWN_WORKER_FIRST_RULES) {
      const covered = smoked.some(path => (rule.endsWith('*') ? path.startsWith(rule.slice(0, -1)) : path === rule))
      expect(covered, `no smoke page exercises the '${rule}' rule`).toBe(true)
    }
    // And nothing in the smoke list is a path the Worker never sees.
    for (const path of smoked) expect(isWorkerFirstPath(path), `${path} is not routed to the Worker`).toBe(true)
  })
})
