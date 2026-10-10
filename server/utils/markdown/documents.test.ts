import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteSimulationStallError, simulateRoute } from '../../../shared/utils/physics/simulator'
import { getRouteBySlug, getRoutesWithMeta } from '../../../shared/utils/catalog'
import { getRaceBySlug, getSeasonBySlug } from '../../../shared/utils/events'
import { buildRecommendQuery, DEFAULT_RIDER_INPUTS, rideRulesForFormat, type RecommendQuery, type Ride } from '../../../shared/utils/recommendQuery'
import { rideForRoute, rideForSegment } from '../../../shared/utils/recommendRide'
import { raceRide, raceStatement, routeStatement, segmentStatement, type RaceWithFormat, type RideStatement } from '../../../shared/utils/rideStatement'
import { getSegmentSummary, routeWithMetaForSegment } from '../../../shared/utils/routeSegments'
import { DEFAULT_SITE_FLAGS } from '../../../shared/utils/siteFlags'
import { isWorkerFirstPath, markdownDocumentFor, MARKDOWN_WORKER_FIRST_RULES } from './documents'

/**
 * The documents rank through the Ride ranking module in process
 * (`server/utils/rankRide.ts`) and read the catalog directly, so these tests
 * run the real ranking against the real catalog with no `$fetch` anywhere:
 * Nitro's `$fetch` does not exist in this plain-node suite (see
 * vitest.config.ts), so a document that still reached for it would throw.
 *
 * The simulator is wrapped, not replaced - the same arrangement as
 * `server/utils/mcp/tools.test.ts`: every test runs the real physics except
 * the ones that need the ranking to fail.
 */
vi.mock('../../../shared/utils/physics/simulator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/utils/physics/simulator')>()
  return { ...actual, simulateRoute: vi.fn(actual.simulateRoute) }
})

afterEach(() => {
  // Back to the real physics the mock was created around.
  vi.mocked(simulateRoute).mockReset()
  vi.unstubAllGlobals()
})

/**
 * The day the documents below are rendered for, unless a test says otherwise:
 * before every curated race, so each race document is a live one.
 */
const BEFORE_ANY_RACE = '2026-09-01'

/**
 * A preview Worker: links are built from the host that served the request,
 * the canonical from the public site URL. The two differ here on purpose -
 * with one value they would agree by accident.
 */
const CONTEXT = { origin: 'https://zwift-bikes-pr-1.workers.dev', siteUrl: 'https://zwiftbikes.com', killSwitches: DEFAULT_SITE_FLAGS.killSwitches, today: BEFORE_ANY_RACE }
const PAUSED = { ...CONTEXT, killSwitches: { ...DEFAULT_SITE_FLAGS.killSwitches, recommend: true } }

/** A short route with a lead-in, so a full ranking stays quick. */
const ROUTE_PAGE = '/routes/hilly-route'

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
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)).markdown

    // The same question the page publishes as FAQ structured data, so a
    // model and a crawler come away with one answer.
    expect(markdown.startsWith('# What\'s the fastest bike for Watopia Hilly Route?')).toBe(true)
    expect(markdown).toMatch(/ZwiftBikes predicts the .+ is the best bike and wheels for Watopia Hilly Route in Watopia: the fastest road setup for a 75 kg rider at 225 W, finishing in \d+:\d\d/)
    expect(markdown).toContain('Canonical page: <https://zwiftbikes.com/routes/hilly-route>')
    // Links stay on the host that served it, the way the HTML's are relative.
    expect(markdown).toContain('https://zwift-bikes-pr-1.workers.dev/api/recommend/')
    // The MCP endpoint is gated at the edge, so a document must never send
    // an anonymous reader to it - the open JSON API is the only way in.
    expect(markdown).not.toContain('/api/mcp')
  })

  it('answers in the page\'s own words, runner-up and assumptions included', async () => {
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)).markdown

    // One builder with the page (`buildRecommendationAnswer`), so the
    // visible answer, the FAQ structured data and this line are one text.
    expect(markdown).toMatch(/finishing in \d+:\d\d \(~[\d.]+ km\/h\)\. The .+ is [\d.]+ s behind\./)
    expect(markdown).toContain('75 kg / 175 cm / 225 W / solo; 1 lap, including any lead-in once. Standard (Road); verified only; unowned Halo bikes excluded.')
    expect(markdown).not.toMatch(/Our model|current filters/)
  })

  it('lists a frame sold in two paints once, with the other paint named beside it (#266)', async () => {
    const markdown = (await markdownDocumentFor('/routes/libby-hill-after-party')!(CONTEXT)).markdown
    expect(markdown).toContain('| Canyon Aeroad CFR - CANYON//SRAM (same frame in another paint: Canyon Aeroad CFR Alpecin Premier-Tech) |')
    expect(markdown).not.toContain('| Canyon Aeroad CFR Alpecin Premier-Tech |')
    expect(markdown).toContain('- One row per bike, paired with its own fastest wheelset for this ride; a frame Zwift sells in several paints is one row, the other paints named beside it.')
  })

  it('ranks the rider the prerendered HTML was rendered for, and says whose times they are', async () => {
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)).markdown
    expect(markdown).toContain('75 kg, 175 cm, 225 W (3.00 W/kg)')
    expect(markdown).toContain('## How these times were computed')
  })

  it('quotes the ride actually raced, lead-in included', async () => {
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)).markdown
    // 9.2 km + a 0.5 km lead-in, 109 m + 1 m: the page's Fact row for one lap.
    expect(markdown).toContain('- 9.7 km with the 0.5 km lead-in\n- 110 m of climbing\n')
    expect(markdown).toContain('**Lead-in** (ridden once): 0.5 km, 1 m')
  })

  it('still serves the route when the ranking fails, and logs why', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(simulateRoute).mockImplementation(() => {
      throw new Error('simulator refused')
    })
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)).markdown
    expect(markdown).toContain('The ranking could not be computed')
    expect(markdown).toContain('## The route')
    expect(markdown).toContain('`hilly-route`')
    expect(markdown).not.toContain('## How these times were computed')

    // The note cannot tell a fault from a stall; the log line can.
    expect(log).toHaveBeenCalledTimes(1)
    const line = JSON.parse(log.mock.calls[0]![0] as string)
    expect(line).toMatchObject({ evt: 'markdown-ranking-error', course: 'route', slug: 'hilly-route', message: 'simulator refused' })
    log.mockRestore()
  })

  it('still serves the route when the rider stalls', async () => {
    // A stall is an outcome of the module, not a throw; the document says
    // the same thing it says for any ranking it could not compute.
    vi.mocked(simulateRoute).mockImplementation(() => {
      throw new RouteSimulationStallError({ weightKg: 75, heightCm: 175, powerW: 225 }, 0.25, 1234, 5000)
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)).markdown
    expect(markdown).toContain('The ranking could not be computed')
    expect(markdown).toContain('## The route')
    // A fact about the rider, not a fault: nothing to log.
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('does not rank at all while recommendations are paused', async () => {
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(PAUSED)).markdown

    // The module checks the switch before any ranking work - and before the
    // cache, so a stored ranking cannot slip out of this side door either.
    expect(simulateRoute).not.toHaveBeenCalled()
    expect(markdown).toContain('temporarily paused for maintenance')
    expect(markdown).toContain('## The route')
  })

  it('404s a route the catalog does not have', async () => {
    await expect(markdownDocumentFor('/routes/no-such-route')!(CONTEXT)).rejects.toMatchObject({ statusCode: 404 })
  })
})

/**
 * The anti-cloaking contract (docs/markdown-for-agents.md): a document shows
 * the Ranking its prerendered page shows, from the same cache entry. The
 * page's Ranking is what the browser asks the recommend endpoint for once it
 * loads, before any stored profile, so these tests put a document and that
 * request side by side against one cache and compare the keys each reached.
 */
describe('a document and its page share one cache entry', () => {
  /** In-memory `caches.default`, recording every key read and written. */
  function fakeCaches() {
    const store = new Map<string, string>()
    const reads: string[] = []
    vi.stubGlobal('caches', {
      default: {
        match: async (key: string) => {
          reads.push(key)
          return store.has(key) ? { text: async () => store.get(key)! } : undefined
        },
        put: async (key: string, response: Response) => void store.set(key, await response.text())
      }
    })
    return { store, reads }
  }

  const setResponseHeader = vi.fn()

  beforeEach(() => {
    setResponseHeader.mockClear()
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { buildSha: 'abc1234' } }))
    // The Nitro auto-imports the recommend endpoint leans on, as
    // `recommendHttp.test.ts` stands them in.
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRouterParam', (event: H3Event) => /\/api\/recommend\/([^?/]+)/.exec(event.path)?.[1])
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('setResponseHeader', setResponseHeader)
  })

  /**
   * The URL the browser's `$fetch(endpoint, { query })` requests: ofetch
   * appends the query with undefined keys dropped, in the builder's key order.
   */
  function browserUrl(endpoint: string, query: RecommendQuery): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.append(key, String(value))
    }
    return `${endpoint}?${params}`
  }

  /** The real route endpoint, answering the browser's request. */
  async function askAsTheBrowser(url: string) {
    const handler = (await import('../../api/recommend/[slug].get')).default as unknown as (event: H3Event) => Promise<unknown>
    await handler({ path: url, context: {} } as unknown as H3Event)
    return setResponseHeader.mock.calls.find(([, name]) => name === 'X-Recommend-Cache')?.[2]
  }

  it('a route document reaches the entry of the route page\'s request for the default rider', async () => {
    // `app/pages/routes/[slug].vue`: the route at one lap, the lap picker's start.
    const ride: Ride = { course: { kind: 'route', slug: 'hilly-route' }, laps: 1 }
    const url = browserUrl('/api/recommend/hilly-route', buildRecommendQuery(DEFAULT_RIDER_INPUTS, ride))
    // Written out, so a change to the page's default request is a change here too.
    expect(url).toBe('/api/recommend/hilly-route?category=standard&limit=9&maxWheelsetsPerFrame=1&offset=0&verifiedOnly=true&includeHalo=false&defaultUnownedLevel=5&weightKg=75&heightCm=175&powerW=225&laps=1')

    const { store, reads } = fakeCaches()
    await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)
    expect(store.size).toBe(1)
    const documentKey = [...store.keys()][0]

    expect(await askAsTheBrowser(url)).toBe('hit')
    expect(reads.at(-1)).toBe(documentKey)
    expect(store.size).toBe(1)
  })

  it('a race document reaches the entry of the race page\'s request, and ranks a format with no draft solo', async () => {
    // `app/pages/events/[season]/[race].vue`: the first Category group's
    // course and laps, with the Race format's rules - a Race of Truth bars
    // TT frames and turns drafting off.
    const ride: Ride = { course: { kind: 'route', slug: 'montmartre-mixer' }, laps: 1, ...rideRulesForFormat('rot') }
    const url = browserUrl('/api/recommend/montmartre-mixer', buildRecommendQuery({ ...DEFAULT_RIDER_INPUTS, draftMode: 'race' }, ride))
    // Even a rider whose own draft mode is the bunch is asked for solo here:
    // no `draftMode` key at all, which is what solo is on the wire.
    expect(url).toBe('/api/recommend/montmartre-mixer?category=standard&limit=9&maxWheelsetsPerFrame=1&offset=0&verifiedOnly=true&includeHalo=false&defaultUnownedLevel=5&weightKg=75&heightCm=175&powerW=225&laps=1&excludeTT=true')

    const { store, reads } = fakeCaches()
    const markdown = (await markdownDocumentFor('/events/zrl-2026-27/round-1-week-1')!(CONTEXT)).markdown
    expect(store.size).toBe(1)
    const documentKey = [...store.keys()][0]!
    expect(JSON.parse(new URL(documentKey).searchParams.get('input')!).options.draft).toEqual({ mode: 'solo' })
    expect(markdown).toContain('75 kg / 175 cm / 225 W / solo;')
    expect(markdown).not.toMatch(/bunch|paceline/i)

    expect(await askAsTheBrowser(url)).toBe('hit')
    expect(reads.at(-1)).toBe(documentKey)
    expect(store.size).toBe(1)
  })
})

describe('the segment document', () => {
  it('ranks a sprint at sprint power and a climb at race pace', async () => {
    const climb = (await markdownDocumentFor('/segments/titans-grove-kom')!(CONTEXT)).markdown
    expect(climb).toMatch(/the best bike and wheels for the Titans Grove KOM climb in Watopia: the fastest road setup for a 75 kg rider at 225 W/)
    expect(climb).not.toContain('Ridden at sprint power')

    const sprint = (await markdownDocumentFor('/segments/alley-sprint')!(CONTEXT)).markdown
    expect(sprint).toContain('Ridden at sprint power')
    expect(sprint).toMatch(/the best bike and wheels for the Alley Sprint sprint in .+: the fastest road setup for a 75 kg rider at 600 W/)
  })

  it('links the routes the segment is ridden on', async () => {
    const markdown = (await markdownDocumentFor('/segments/titans-grove-kom')!(PAUSED)).markdown
    expect(markdown).toMatch(/Also on \[.+\]\(https:\/\/zwift-bikes-pr-1\.workers\.dev\/routes\/[a-z0-9-]+\)/)
  })

  it('links every host route, placed or not - the dictionary\'s and the ones zwift-data never placed (#273)', async () => {
    const pave = (await markdownDocumentFor('/segments/pave-sprint')!(PAUSED)).markdown
    expect(pave).toContain('[Sacre Bleu](https://zwift-bikes-pr-1.workers.dev/routes/sacre-bleu)')
    expect(pave).toContain('[Knights of the Roundabout](https://zwift-bikes-pr-1.workers.dev/routes/knights-of-the-roundabout)')
    const titans = (await markdownDocumentFor('/segments/titans-grove-kom')!(PAUSED)).markdown
    expect(titans).toContain('[Canopies and Coastlines](https://zwift-bikes-pr-1.workers.dev/routes/canopies-and-coastlines)')
  })

  it('404s a segment the catalog does not have', async () => {
    await expect(markdownDocumentFor('/segments/no-such-segment')!(CONTEXT)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('the race document', () => {
  // Real curated data (shared/utils/events.ts), not a fixture: the whole
  // point of this document is the organiser's rules, and a fixture would
  // only ever prove that the fixture is shaped the way the test expects.
  const ROT = '/events/zrl-2026-27/round-1-week-1' // Race of Truth: no TT frames, no draft
  const POINTS = '/events/zrl-2026-27/round-1-week-3' // points race, two groups on different courses

  it('bars TT frames where the format does, and says so', async () => {
    const markdown = (await markdownDocumentFor(ROT)!(CONTEXT)).markdown

    // The page's own notes under its Fact row, in the one wording.
    expect(markdown).toContain('\nWTRL bans TT frames from a Race of Truth, so this is raced on road bikes, and they are the only thing ranked below.\n')
    expect(markdown).toContain('\nWTRL turns the draft off for a Race of Truth, so the ranking is ridden solo; your saved draft setting still applies everywhere else.\n')
    // The page's own rules line leads the answer here too.
    expect(markdown).toMatch(/WTRL bans TT frames from a Race of Truth\. WTRL turns the draft off for a Race of Truth, so the time is for riding solo\. ZwiftBikes predicts the .+ is the best bike and wheels for /)
    // MCP's own header is written for a model; a twin says what its page says.
    expect(markdown).not.toContain('- Race format:')
  })

  it('ranks the first category group and names the others', async () => {
    // Paused: what is under test is the groups, which the document lists
    // whether or not there is a ranking to print above them.
    const markdown = (await markdownDocumentFor(POINTS)!(PAUSED)).markdown

    expect(markdown).toContain('What bike should I ride for')
    expect(markdown).toContain('A/B (ranked above)')
    expect(markdown).toContain('C/D')
    // A group on another course gets a different answer; saying so is the
    // difference between a useful document and a misleading one.
    expect(markdown).toContain('Another group racing a different course or lap count gets a different answer')
  })

  it('states the ranked group\'s lap count once in the answer, as the page does, and again in its Fact row', async () => {
    // A/B: 4 laps of Innsbruckring.
    const markdown = (await markdownDocumentFor('/events/zrl-2026-27/round-1-week-2')!(CONTEXT)).markdown
    const answer = markdown.split('\n\nCanonical page:')[0]!.split('\n\n').slice(1).join('\n\n')

    expect(answer).toMatch(/is the best bike and wheels for Innsbruckring in Innsbruck: /)
    expect(answer).toContain('4 laps, including any lead-in once')
    expect(answer.match(/4 laps/g)).toHaveLength(1)
    // The Fact row is the page's statement, not the answer, and keeps it.
    expect(markdown).toContain('\n- 4 laps\n')
  })

  it('404s a race the organiser has not published', async () => {
    await expect(markdownDocumentFor('/events/zrl-2026-27/not-a-race')!(CONTEXT)).rejects.toMatchObject({ statusCode: 404 })
  })
})

/**
 * A twin is the page (see **Twin** in CONTEXT.md), and what a page says about
 * its Ride on its own is its Ride statement (issue #318). So for each kind of
 * Ranking page, the statement the page would build for its default Ride is
 * built here independently of the twin, and every string in it the page
 * prints must be in the twin: the ride name, the question, every Fact row
 * cell and note, and each of a race's own facts.
 */
describe('a twin says everything its page\'s Ride statement says', () => {
  const SITE = CONTEXT.siteUrl
  const ORIGIN = CONTEXT.origin

  /** The strings every kind of page prints from its statement. */
  function pageStrings(statement: RideStatement): string[] {
    return [
      `# ${statement.question}`,
      statement.rideName,
      ...statement.facts.map(fact => `${fact.value} ${fact.label}`),
      ...(statement.surface?.allTarmac ? ['All tarmac'] : statement.surface?.key.map(entry => entry.text) ?? [])
    ]
  }

  function expectTwinSays(markdown: string, strings: (string | undefined)[]) {
    const said = strings.filter((text): text is string => Boolean(text))
    expect(said.length).toBeGreaterThan(4)
    for (const text of said) expect(markdown, text).toContain(text)
  }

  it('on a route page', async () => {
    const statement = routeStatement({ ride: rideForRoute(getRouteBySlug('hilly-route')!, 1), siteUrl: SITE })
    const markdown = (await markdownDocumentFor(ROUTE_PAGE)!(CONTEXT)).markdown
    expectTwinSays(markdown, [...pageStrings(statement), statement.coverageNote])
  })

  it('on a segment page, whose question names the segment by its kind', async () => {
    // A membership sprint with host routes the dictionary added: every note
    // the segment page has.
    const segment = getSegmentSummary('pave-sprint')!
    const ride: Ride = { course: { kind: 'segment', slug: 'pave-sprint' }, power: 'sprint' }
    const statement = segmentStatement({ segment, resolvedRide: rideForSegment(routeWithMetaForSegment(segment)), ride, siteUrl: SITE })
    const markdown = (await markdownDocumentFor('/segments/pave-sprint')!(CONTEXT)).markdown
    expect(statement.question).toBe('What\'s the fastest bike for the Pavé Sprint sprint?')
    expectTwinSays(markdown, [
      ...pageStrings(statement),
      statement.timingNote,
      statement.placementNote,
      ...statement.hostRoutes.map(host => `[${host.name}](${ORIGIN}${host.to})`)
    ])
  })

  describe('on a race page', () => {
    const season = getSeasonBySlug('zrl-2026-27')!

    function raceStrings(statement: ReturnType<typeof raceStatement>): (string | undefined)[] {
      return [
        ...pageStrings(statement),
        statement.coverageNote,
        statement.rules.alert,
        statement.rules.soloNote,
        statement.officialFiguresNote,
        statement.powerupsLine,
        statement.runNotice?.title,
        // The per-group table, with the organiser's own figures.
        statement.groupsCaption,
        ...statement.groups.map(group => `| ${group.laps} | ${group.distance} | ${group.elevation} |`),
        ...(statement.scoring.rows.length ? [statement.rules.segmentLinkNote] : []),
        ...statement.scoring.rows.map(row => `${row.name}](${ORIGIN}/segments/${row.slug}?rules=${statement.rules.format}) | ${row.fal || '-'}${row.fal ? 'x' : ''} | ${row.fts || '-'}${row.fts ? 'x' : ''} |`),
        ...statement.scoring.rows.flatMap(row => row.positionsKm.map(km => `${km.toFixed(1)} km`))
      ]
    }

    function statementFor(seasonSlug: string, raceSlug: string, today = CONTEXT.today) {
      const race = getRaceBySlug(seasonSlug, raceSlug) as RaceWithFormat
      const ride = raceRide(race, 0)!
      return raceStatement({ season: getSeasonBySlug(seasonSlug)!, race, groupIndex: 0, resolvedRide: rideForRoute(getRouteBySlug(ride.course.slug)!, ride.laps), today, siteUrl: SITE })
    }

    it('a Race of Truth, with its scoring passes along the ride', async () => {
      const statement = statementFor(season.slug, 'round-1-week-1')
      expect(statement.scoring.rows.some(row => row.positionsKm.length > 1)).toBe(true)
      const markdown = (await markdownDocumentFor('/events/zrl-2026-27/round-1-week-1')!(CONTEXT)).markdown
      expectTwinSays(markdown, raceStrings(statement))
    })

    it('a points race whose groups ride different courses', async () => {
      const statement = statementFor(season.slug, 'round-1-week-3')
      expect(statement.coursesDiffer).toBe(true)
      const markdown = (await markdownDocumentFor('/events/zrl-2026-27/round-1-week-3')!(CONTEXT)).markdown
      expectTwinSays(markdown, [...raceStrings(statement), `The ranking above is for ${statement.groupLabel}.`])
    })

    it('a race the organiser publishes other figures for, run by the day it is read', async () => {
      // August's stage 4 closed on Sun 6 Sep.
      const statement = statementFor('zracing-2026', 'stage-4', '2026-09-07')
      expect(statement.officialFiguresNote).toBeDefined()
      expect(statement.hasRun).toBe(true)
      const markdown = (await markdownDocumentFor('/events/zracing-2026/stage-4')!({ ...CONTEXT, today: '2026-09-07' })).markdown
      expectTwinSays(markdown, raceStrings(statement))
    })
  })
})

/**
 * A twin is the page (see **Twin** in CONTEXT.md): once its race has been
 * run, the page says so above its title and is noindex, so the twin says the
 * same words above its own and reports the noindex for the middleware to
 * send (issue #281). "Run" is decided on the day the document is rendered
 * for, which the render context carries so these tests can hold it.
 */
describe('the twin of a race that has been run', () => {
  const ORIGIN = 'https://zwift-bikes-pr-1.workers.dev'
  // Round 1 Week 1, a Race of Truth on Montmartre Mixer, raced on Tue 22 Sep.
  const WEEK_1 = '/events/zrl-2026-27/round-1-week-1'
  const onDay = (today: string) => ({ ...CONTEXT, today })

  it('is the live twin on race day, with nothing above its title and nothing to hide', async () => {
    const live = await markdownDocumentFor(WEEK_1)!(onDay('2026-09-22'))
    expect(live.noindex).toBe(false)
    expect(live.markdown.startsWith('# What bike should I ride for Zwift Racing League 2026/27')).toBe(true)
    expect(live.markdown).not.toContain('This race has been run')
  })

  it('says so above its title the day after, in the page\'s words, and reports its page noindex', async () => {
    const run = await markdownDocumentFor(WEEK_1)!(onDay('2026-09-23'))
    expect(run.noindex).toBe(true)
    // The HTML notice's title and three parts, in its words and its links:
    // the raced-on date, the season's next race, and the route on its own.
    expect(run.markdown.startsWith([
      '> **This race has been run**',
      '>',
      '> Round 1 Week 1 was raced on Tue 22 Sep. The ranking below still holds for this route under Race of Truth rules.',
      '>',
      `> Next ZRL race: [Week 2, Tue 29 Sep](${ORIGIN}/events/zrl-2026-27/round-1-week-2)`,
      '>',
      `> The route on its own: [Fastest bike for Montmartre Mixer](${ORIGIN}/routes/montmartre-mixer)`,
      '',
      '# What bike should I ride for Zwift Racing League 2026/27'
    ].join('\n'))).toBe(true)
  })

  it('is the live twin from its title down, ranking and race facts included', async () => {
    const live = (await markdownDocumentFor(WEEK_1)!(onDay('2026-09-22'))).markdown
    const run = (await markdownDocumentFor(WEEK_1)!(onDay('2026-09-23'))).markdown
    expect(run.slice(run.indexOf('\n# ') + 1)).toBe(live)
    expect(live).toContain('## Fastest bike and wheel combinations')
    expect(live).toMatch(/\| 1 \|/)
    expect(live).toContain('## The race')
  })

  it('points to a next race with no page yet at its round on the season page', async () => {
    // Round 1 Week 6, on Tue 27 Oct, is on a course the catalog doesn't carry.
    const run = await markdownDocumentFor('/events/zrl-2026-27/round-1-week-5')!({ ...PAUSED, today: '2026-10-21' })
    expect(run.markdown).toContain(`> Next ZRL race: [Week 6, Tue 27 Oct](${ORIGIN}/events/zrl-2026-27#round-1)`)
  })

  it('points to the next round with nothing announced once no race is left but its season is not over', async () => {
    // The Tour of Watopia's last stage closed on Sun 8 Nov;
    // Zwift has themed nothing after it, so November is a round with no races.
    const run = await markdownDocumentFor('/events/zracing-2026/september-stage-4')!({ ...PAUSED, today: '2026-11-10' })
    expect(run.noindex).toBe(true)
    expect(run.markdown).toContain(`> Next ZRacing round: [November, not announced yet](${ORIGIN}/events/zracing-2026#round-11)`)
  })

  it('points to the events hub once its season has nothing left to run', async () => {
    const run = await markdownDocumentFor('/events/zrl-2026-27/round-1-week-5')!({ ...PAUSED, today: '2027-04-07' })
    expect(run.markdown).toContain(`> Every race this season has been run. [Races still to come](${ORIGIN}/events)`)
  })
})

describe('the twins that are not races', () => {
  it('say the same thing and nothing about the index, whatever the day', async () => {
    for (const path of ['/', '/segments', ROUTE_PAGE, '/segments/titans-grove-kom']) {
      const early = await markdownDocumentFor(path)!({ ...PAUSED, today: BEFORE_ANY_RACE })
      const late = await markdownDocumentFor(path)!({ ...PAUSED, today: '2999-12-31' })
      expect(early.noindex, path).toBe(false)
      expect(late, path).toEqual(early)
    }
  })
})

describe('the index documents', () => {
  it('lists the whole catalog with the slugs the API takes', async () => {
    const home = (await markdownDocumentFor('/')!(CONTEXT)).markdown
    // Every catalog route - the running-only ones left it in #324 (the count
    // itself is pinned in `shared/utils/catalog.test.ts`).
    expect(home).toContain(`## Every route (${getRoutesWithMeta().length})`)
    expect(home).not.toContain('lutece-express-run')
    expect(home).toContain('[Watopia Hilly Route](https://zwift-bikes-pr-1.workers.dev/routes/hilly-route)')
    expect(home).toContain('`hilly-route`')

    const segments = (await markdownDocumentFor('/segments')!(CONTEXT)).markdown
    expect(segments).toMatch(/## Every climb and sprint \(\d{2,}\)/)
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
