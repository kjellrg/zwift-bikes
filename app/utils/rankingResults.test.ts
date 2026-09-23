import { describe, expect, it } from 'vitest'
import { activeFiltersLabel, breadcrumbScript, comboPhysicsDelta, courseNote, faqScript, formatSignedDelta, hasElevationProfile, hasSurfaceLocations, isDynamicPhysics, rankingEvidence } from './rankingResults'
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
      'Rough surfaces cost this setup about 43 seconds here',
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

/**
 * Which course an equipment view's scope line names - only when it is not the
 * one the rider has selected, which on a race page is the window between a
 * group change and its ranking landing.
 */
describe('courseNote', () => {
  const makuri = { slug: 'makuri-40', name: 'Makuri 40' } as RouteWithMeta
  const urumaze = { slug: 'urumaze', name: 'Urumaze' } as RouteWithMeta

  it('names the applied course only while it is not the selected one', () => {
    expect(courseNote(urumaze, makuri)).toBe(' on Makuri 40')
    expect(courseNote(makuri, makuri)).toBe('')
  })

  it('names nothing when the applied course is not known yet', () => {
    // The view says so on its own line; a scope line about no course would
    // be a claim about nothing.
    expect(courseNote(urumaze, undefined)).toBe('')
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

describe('comboPhysicsDelta', () => {
  const delta = (cdaDeltaM2: number, bikeMassDeltaKg: number, crrDelta = 0) => ({ cdaDeltaM2, bikeMassDeltaKg, crrDelta })

  it('adds the wheels\' deltas to the frame\'s, both against the same stock bike', () => {
    const combo = { frame: { physics: delta(-0.02, -1, -0.0003), hasFixedWheels: false }, wheelset: { physics: delta(-0.013, -1.15) } } as unknown as ComboScore
    const total = comboPhysicsDelta(combo)!
    expect(total.cdaDeltaM2).toBeCloseTo(-0.033)
    expect(total.bikeMassDeltaKg).toBeCloseTo(-2.15)
    expect(total.crrDelta).toBeCloseTo(-0.0003)
  })

  it('has no delta when a part was never solved, rather than half of one', () => {
    expect(comboPhysicsDelta({ frame: { physics: delta(-0.02, -1), hasFixedWheels: false }, wheelset: {} } as unknown as ComboScore)).toBeUndefined()
    expect(comboPhysicsDelta({ frame: { hasFixedWheels: false }, wheelset: { physics: delta(0, 0) } } as unknown as ComboScore)).toBeUndefined()
  })

  it('reads a fixed-wheel frame\'s delta as the whole setup\'s', () => {
    expect(comboPhysicsDelta({ frame: { physics: delta(-0.05, 1), hasFixedWheels: true } } as unknown as ComboScore)).toEqual(delta(-0.05, 1))
  })
})

describe('formatSignedDelta', () => {
  it('signs every non-zero value with a true minus, and prints zero unsigned', () => {
    expect(formatSignedDelta(-0.0331, 3)).toBe('\u22120.033')
    expect(formatSignedDelta(0.5, 2)).toBe('+0.50')
    expect(formatSignedDelta(-0.00001, 3)).toBe('0.000')
  })
})

describe('activeFiltersLabel', () => {
  const restrictions = { verifiedOnly: true, includeHaloBikes: false, myBikesOnly: false, search: '' }

  it('names the category, the data rule and the Halo rule the pool was drawn under', () => {
    expect(activeFiltersLabel(restrictions, 'standard')).toBe('Standard (Road) · verified data only · Halo bikes hidden')
    expect(activeFiltersLabel({ ...restrictions, verifiedOnly: false, includeHaloBikes: true, myBikesOnly: true }, 'all'))
      .toBe('All categories · estimates included · your garage')
  })

  it('names a directed search instead of a Halo rule it lifts', () => {
    expect(activeFiltersLabel({ ...restrictions, search: ' tarmac ' }, 'standard')).toBe('Standard (Road) · verified data only · search "tarmac"')
  })
})
