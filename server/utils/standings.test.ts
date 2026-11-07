import { gzipSync } from 'node:zlib'
import { stringify } from 'devalue'
import { describe, expect, it } from 'vitest'
import generated from '../../shared/data/standings.generated.json'
import generatedRace from '../../shared/data/standings.race.generated.json'
import type { StandingsProfile } from '../../shared/types/standings'
import { STANDINGS_CATEGORIES, STANDINGS_PROFILES } from '../../shared/types/standings'
import { getRouteBySlug } from '../../shared/utils/catalog'
import { buildRecommendQuery } from '../../shared/utils/recommendQuery'
import { STANDINGS_RIDERS } from '../../shared/utils/standingsRiders'
import { DEFAULT_SITE_FLAGS } from '../../shared/utils/siteFlags'
import { recommendRouteQuerySchema } from './apiQuerySchemas'
import { rankRideForQuery } from './rankRide'
import { standingsData, standingsProfileFromQuery } from './standings'

interface Table {
  frames: { id: number }[]
  wheels: { key: string }[]
  routes: { slug: string, frameSec: (number | null)[], wheels: Record<string, { frameId: number, sec: (number | null)[] }> }[]
}
const tables: Record<StandingsProfile, Table> = { default: generated as Table, race: generatedRace as Table }
const table = tables.default

const round1 = (seconds: number) => Math.round(seconds * 10) / 10

describe('standingsData', () => {
  // Each page prerenders its data into its payload and averages it in the
  // browser, as the homepage does its route cards - under the same budget.
  // The race rider's table is fetched on demand, but is held to the same size.
  it.each(['bikes', 'wheels'] as const)('fits the page payload budget: %s under 100 KB gzip, serialised the way a payload is', (kind) => {
    for (const profile of STANDINGS_PROFILES) {
      const bytes = gzipSync(stringify(standingsData(kind, profile))).length
      expect(bytes, `${kind} for ${profile}`).toBeLessThan(100 * 1024)
    }
  })

  it.each(['bikes', 'wheels'] as const)('puts each route\'s fastest %s at a gap of zero in each category', (kind) => {
    for (const route of [...standingsData(kind).routes, ...standingsData(kind, 'race').routes]) {
      for (const category of STANDINGS_CATEGORIES) {
        const times = route.times[category]
        if (!times) continue
        expect(Math.min(...times.gapTenths.split(',').filter(gap => gap !== '').map(Number))).toBe(0)
      }
    }
  })

  it('lists wheels that time identically once, under the plainest name, with the others beside it', () => {
    const wake = standingsData('wheels').entries.standard.filter(entry => entry.name.startsWith('Princeton Wake 6560'))
    expect(wake).toEqual([{ id: 'Princeton Wake 6560 Lava', name: 'Princeton Wake 6560 Lava', sameTimes: ['Princeton Wake 6560 White'] }])
  })

  it('splits the bikes by category, every frame in exactly one', () => {
    const { entries } = standingsData('bikes')
    expect(entries.standard.length + entries.tt.length).toBe(table.frames.length)
    expect(entries.standard.some(entry => entries.tt.some(other => other.id === entry.id))).toBe(false)
  })

  it('is built once per instance and reused, for each rider', () => {
    expect(standingsData('bikes')).toBe(standingsData('bikes'))
    expect(standingsData('bikes', 'race')).toBe(standingsData('bikes', 'race'))
    expect(standingsData('bikes', 'race')).not.toBe(standingsData('bikes'))
  })

  it('times the race rider as 80 kg at 280 W in a race bunch, and the default one solo', () => {
    expect(standingsData('bikes', 'race')).toMatchObject({ profile: 'race', rider: { weightKg: 80, powerW: 280, draftMode: 'race' } })
    expect(standingsData('bikes')).toMatchObject({ profile: 'default', rider: { draftMode: 'solo' } })
  })

  it('reads ?rider= as the default rider when absent and rejects anything else', () => {
    expect(standingsProfileFromQuery(undefined)).toBe('default')
    expect(standingsProfileFromQuery('race')).toBe('race')
    expect(() => standingsProfileFromQuery('heavy')).toThrow()
    expect(() => standingsProfileFromQuery(['race'])).toThrow()
  })
})

// The standings are meant to be what a route page shows for each table's
// rider, averaged. These check the committed table still is: a change to the
// physics or the ranking that moves a time, made without rerunning
// `npm run standings:compute`, fails here. A flat route and a climb, so a
// change that only moves one kind of time is caught too.
describe.each(STANDINGS_PROFILES)('the committed standings table for the %s rider', (profile) => {
  const table = tables[profile]
  it.each(['tempus-fugit', 'road-to-sky'])('times %s exactly as its route page ranks it', async (slug) => {
    const route = getRouteBySlug(slug)!
    const query = recommendRouteQuerySchema.parse(buildRecommendQuery(STANDINGS_RIDERS[profile], { course: { kind: 'route', slug } }))
    const page = await rankRideForQuery({ kind: 'route', route }, query, { killSwitches: DEFAULT_SITE_FLAGS.killSwitches })
    if (page.status !== 'answer') throw new Error(`ranking ${slug} did not answer: ${page.status}`)
    const entry = table.routes.find(candidate => candidate.slug === slug)!

    for (const row of page.ranking.combos) {
      const index = table.frames.findIndex(frame => frame.id === row.frame.id)
      expect(entry.frameSec[index]).toBe(round1(row.finishTimeSec!))
    }

    for (const category of STANDINGS_CATEGORIES) {
      const wheelList = entry.wheels[category]
      if (!wheelList) continue
      const wheels = await rankRideForQuery({ kind: 'route', route }, { ...query, wheelsForFrame: wheelList.frameId }, { killSwitches: DEFAULT_SITE_FLAGS.killSwitches })
      if (wheels.status !== 'answer') throw new Error(`${category} wheel alternatives on ${slug} did not answer: ${wheels.status}`)
      for (const row of wheels.ranking.combos) {
        const index = table.wheels.findIndex(wheel => wheel.key === row.wheelset!.key)
        expect(wheelList.sec[index]).toBe(round1(row.finishTimeSec!))
      }
    }
  })
})
