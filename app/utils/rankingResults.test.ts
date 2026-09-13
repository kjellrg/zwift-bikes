import { describe, expect, it } from 'vitest'
import { breadcrumbScript, faqScript, hasElevationProfile, hasSurfaceLocations, isDynamicPhysics, rankingEvidence } from './rankingResults'
import type { ComboScore, RouteWithMeta } from '../../shared/types/catalog'

const course = (terrain: unknown, surface: unknown) => ({ terrain, surface } as RouteWithMeta)

/** A fully mapped course: both coverage predicates true, and cobbles to be slowed by. */
const MAPPED = course(
  { elevationProfile: [{ distanceKm: 0, elevationM: 0 }, { distanceKm: 3, elevationM: 60 }] },
  { confidence: 'measured', segments: [{ fromKm: 0, toKm: 1, surface: 'cobble' }], gravel: 0, cobble: 0.2 }
)

const comboCosting = (surfaceTimePenaltySec: number) => ({ surfaceTimePenaltySec } as ComboScore)

/**
 * How much of the course the ranking actually had to work with - the two
 * facts `limitedCourseDataNote` is phrased from, and the difference between a
 * simulated time and an approximated one.
 */
describe('course coverage', () => {
  it('reads a single elevation point as no profile at all', () => {
    // One point is a start with no shape after it: nothing the dynamic
    // physics can put a grade change at a position on.
    expect(hasElevationProfile(course({ elevationProfile: [{ distanceKm: 0, elevationM: 12 }] }, {}))).toBe(false)
    expect(hasElevationProfile(course({ elevationProfile: [{ distanceKm: 0, elevationM: 12 }, { distanceKm: 1, elevationM: 40 }] }, {}))).toBe(true)
  })

  it('has no coverage of either kind without a course', () => {
    expect(hasElevationProfile(undefined)).toBe(false)
    expect(hasSurfaceLocations(undefined)).toBe(false)
  })

  it('reads a measured surface mix with no positioned stretches as no locations', () => {
    // A measured mix says how much cobble there is, never where it is.
    expect(hasSurfaceLocations(course({}, { confidence: 'measured', segments: [] }))).toBe(false)
    expect(hasSurfaceLocations(course({}, { confidence: 'measured', segments: [{ fromKm: 0, toKm: 1, surface: 'cobble' }] }))).toBe(true)
  })
})

/**
 * The lines under the recommended time that say what the number rests on -
 * one derivation for the route, segment and race pages, which each used to
 * keep their own copy of it.
 */
describe('rankingEvidence', () => {
  it('states the rough-terrain cost, the paceline saving and the bunch saving, in that order', () => {
    const evidence = rankingEvidence({
      course: MAPPED,
      combo: comboCosting(43),
      physics: {
        mode: 'dynamic',
        ttt: { riders: 4, frontPullPowerW: 320, tttSavedSec: 95 },
        race: { savingPct: 24, raceSavedSec: 61 }
      }
    })

    expect(evidence.notes).toEqual([
      'Due to increased rolling resistance, rough terrain adds ~43s to this route with the fastest combo below.',
      'A 4-rider paceline saves ~1:35 vs riding this alone at the same effort (~320 W on your pulls).',
      'Sitting in a typical mass-start bunch saves ~1:01 vs riding this alone at the same average power (~24% less power for the same speed on the flat).'
    ])
    expect(evidence.limitedDataNote).toBeUndefined()
  })

  it('says nothing at all about a fully mapped course ridden solo with no surface cost', () => {
    const evidence = rankingEvidence({ course: MAPPED, combo: comboCosting(0), physics: { mode: 'dynamic' } })

    expect(evidence.notes).toEqual([])
    expect(evidence.limitedDataNote).toBeUndefined()
  })

  it('names whichever half of the course data is missing', () => {
    const surface = { confidence: 'measured', segments: [{ fromKm: 0, toKm: 1, surface: 'cobble' }], gravel: 0, cobble: 0.2 }
    const elevation = { elevationProfile: [{ distanceKm: 0, elevationM: 0 }, { distanceKm: 3, elevationM: 60 }] }
    const note = (terrain: unknown, surfaceEstimate: unknown) =>
      rankingEvidence({ course: course(terrain, surfaceEstimate), combo: undefined, physics: undefined }).limitedDataNote

    expect(note({}, surface)).toBe('Limited route data: elevation profile unavailable.')
    expect(note(elevation, { ...surface, segments: [] })).toBe('Limited route data: surface locations unavailable.')
    expect(note({}, { ...surface, segments: [] })).toBe('Limited route data: elevation and surface locations unavailable.')
  })

  it('says nothing about a course it has not been given', () => {
    // A race group with no catalog route, and every page's first tick before
    // its own lookup lands: there is no course to report coverage of, and a
    // "limited route data" line about no route would be a claim about nothing.
    const evidence = rankingEvidence({ course: undefined, combo: comboCosting(43), physics: undefined })

    expect(evidence.notes).toEqual([])
    expect(evidence.limitedDataNote).toBeUndefined()
  })
})

describe('isDynamicPhysics', () => {
  it('is true only for the dynamic model', () => {
    expect(isDynamicPhysics({ mode: 'dynamic' })).toBe(true)
    expect(isDynamicPhysics({ mode: 'static' })).toBe(false)
    expect(isDynamicPhysics(undefined)).toBe(false)
  })
})

/**
 * The JSON-LD a ranking page puts in its head. Checked here rather than by
 * reading three templates, because what makes it safe - the `<` escaping that
 * stops a route name closing the script tag - is invisible in the markup.
 */
describe('structured data', () => {
  it('escapes a `<` in a name so it cannot close the script element', () => {
    const script = breadcrumbScript([
      { name: 'Home', item: 'https://zwiftbikes.com' },
      { name: '</script><img src=x>', item: 'https://zwiftbikes.com/routes/x' }
    ])

    expect(script.type).toBe('application/ld+json')
    expect(script.innerHTML).not.toContain('<')
    expect(script.innerHTML).toContain('\\u003c/script>')
  })

  it('numbers the trail from one, in the order the page supplies it', () => {
    const script = breadcrumbScript([
      { name: 'Home', item: 'https://zwiftbikes.com' },
      { name: 'Segments', item: 'https://zwiftbikes.com/segments' },
      { name: 'Box Hill', item: 'https://zwiftbikes.com/segments/box-hill' }
    ])

    expect(JSON.parse(script.innerHTML)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://zwiftbikes.com' },
        { '@type': 'ListItem', 'position': 2, 'name': 'Segments', 'item': 'https://zwiftbikes.com/segments' },
        { '@type': 'ListItem', 'position': 3, 'name': 'Box Hill', 'item': 'https://zwiftbikes.com/segments/box-hill' }
      ]
    })
  })

  it('asks the page\'s own question and answers it with the text under the recommendation', () => {
    const script = faqScript('What\'s the fastest bike for Box Hill?', 'The Tarmac Pro on Zipp 858s, in 12:34.')

    expect(script && JSON.parse(script.innerHTML)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': [{
        '@type': 'Question',
        'name': 'What\'s the fastest bike for Box Hill?',
        'acceptedAnswer': { '@type': 'Answer', 'text': 'The Tarmac Pro on Zipp 858s, in 12:34.' }
      }]
    })
  })

  it('publishes no FAQ until there is an answer to publish', () => {
    // No rank 1 yet, or filters that match nothing: a Question with no
    // Answer is worse than no structured data at all.
    expect(faqScript('What\'s the fastest bike for Box Hill?', undefined)).toBeUndefined()
    expect(faqScript(undefined, 'The Tarmac Pro on Zipp 858s, in 12:34.')).toBeUndefined()
  })
})
