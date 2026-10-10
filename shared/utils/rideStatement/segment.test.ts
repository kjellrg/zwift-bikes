import { describe, expect, it } from 'vitest'
import { RACE_FORMATS, getRaceBySlug, getSeasonBySlug } from '../events'
import { rideRulesForFormat, type Ride } from '../recommendQuery'
import { rideForSegment } from '../recommendRide'
import { getSegmentSummary, routeWithMetaForSegment } from '../routeSegments'
import { raceStatement } from './race'
import { segmentStatement } from './segment'

const SITE = 'https://zwiftbikes.com'
const alpe = getSegmentSummary('alpe-du-zwift')!
const fuego = getSegmentSummary('fuego-flats')!
const climbRide: Ride = { course: { kind: 'segment', slug: 'alpe-du-zwift' }, power: 'race' }
const sprintRide: Ride = { course: { kind: 'segment', slug: 'fuego-flats' }, power: 'sprint' }
const statementFor = (segment = alpe, ride = climbRide) => segmentStatement({ segment, resolvedRide: rideForSegment(routeWithMetaForSegment(segment)), ride, siteUrl: SITE })

describe('segmentStatement', () => {
  it('names the segment by its kind, in the question as in the title', () => {
    const statement = statementFor()
    expect(statement.rideName).toBe('the Alpe du Zwift climb in Watopia')
    expect(statement.question).toBe('What\'s the fastest bike for the Alpe du Zwift climb?')
    expect(statement.title).toBe('Fastest bike for the Alpe du Zwift climb | ZwiftBikes')
    expect(statement.ogTitle).toBe('Fastest bike for the Alpe du Zwift climb')
    expect(statementFor(fuego, sprintRide).question).toBe('What\'s the fastest bike for the Fuego Flats sprint?')
  })

  it('heads the page under the segments hub, with the climb\'s category', () => {
    const statement = statementFor()
    expect(statement.heading).toEqual({
      name: 'Alpe du Zwift',
      crumbs: [{ label: 'All segments', to: '/segments' }, { label: 'Watopia' }, { label: 'Climb, HC' }]
    })
    expect(statementFor(fuego, sprintRide).heading.crumbs.at(-1)).toEqual({ label: 'Sprint' })
    expect(statement.breadcrumbs).toEqual([
      { name: 'Home', item: SITE },
      { name: 'Segments', item: `${SITE}/segments` },
      { name: 'Alpe du Zwift', item: `${SITE}/segments/alpe-du-zwift` }
    ])
  })

  it('leads a report with the kind of segment the Ride is ridden as', () => {
    expect(statementFor().reportSubject).toBe('Climbing segment')
    expect(statementFor(fuego, sprintRide).reportSubject).toBe('Sprint segment')
    expect(statementFor().reportItem).toBe('Alpe du Zwift')
  })

  it('describes the segment with the numbers searchers scan for', () => {
    expect(statementFor().description).toBe('The best bike and wheels for the Alpe du Zwift climb (12.2 km at 8.5%, 1036 m of climbing), ranked by predicted finish time for your weight and power.')
    // A near-flat sprint has no climbing worth quoting.
    expect(statementFor(fuego, sprintRide).description).toBe('The best bike and wheels for the Fuego Flats sprint in Watopia (0.5 km at 0.2%), ranked by predicted finish time for your weight and power.')
    expect(statementFor().ogDescription).toBe(statementFor().description)
  })

  it('builds the Fact row and its notes from the segment itself', () => {
    const statement = statementFor()
    expect(statement.facts).toEqual([
      { value: '12.2 km', label: 'long' },
      { value: '1036 m', label: 'of climbing' },
      { value: '8.5%', label: 'average grade' }
    ])
    expect(statement.surface).toEqual({ parts: [], key: [], allTarmac: true })
    expect(statement.timingNote).toBe('Timed from the segment\'s start and ridden once; the flying-start warm-up is not counted.')
    expect(statement.hostRoutes.map(host => host.name)).toContain('Road to Sky')
    expect(statement.hostRoutes.find(host => host.name === 'Road to Sky')).toEqual({ name: 'Road to Sky', to: '/routes/road-to-sky' })
    expect(statement.placementNote).toBeUndefined()
    expect(segmentStatement({ segment: { ...alpe, placement: 'membership' }, resolvedRide: rideForSegment(routeWithMetaForSegment(alpe)), ride: climbRide, siteUrl: SITE }).placementNote)
      .toBe('The exact position of this segment along its host routes isn\'t in our route data, so length and grade come from the segment\'s own record, and the surface estimate is borrowed from the host route\'s overall mix.')
  })

  it('gives the share card the climb\'s category and figures', () => {
    expect(statementFor().shareCard).toEqual({
      props: { title: 'Alpe du Zwift', kind: 'HC climb', world: 'Watopia', length: '12.2 km', elevation: '1036 m', grade: '8.5%' },
      alt: 'Fastest bike for the Alpe du Zwift climb in Watopia: segment profile and the fastest bike and wheel setup'
    })
    expect(statementFor(fuego, sprintRide).shareCard.props.kind).toBe('sprint')
  })

  it('carries no rules until the Ride is told a format', () => {
    expect(statementFor().rules).toBeUndefined()
  })

  it('words every format\'s rules exactly as a race page in that format does', () => {
    const season = getSeasonBySlug('zrl-2026-27')!
    const race = getRaceBySlug('zrl-2026-27', 'round-1-week-3')!
    for (const format of RACE_FORMATS) {
      const segment = statementFor(alpe, { ...climbRide, ...rideRulesForFormat(format) })
      const raced = raceStatement({ season, race: { ...race, format }, groupIndex: 0, resolvedRide: undefined, today: '2026-09-01', siteUrl: SITE })
      expect(segment.rules, format).toEqual(raced.rules)
      expect(segment.rules?.format).toBe(format)
    }
  })
})
